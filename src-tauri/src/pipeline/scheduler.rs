//! Pipeline Orchestrator (V2 section 3.1). Schedules Flow Steps in dependency
//! order, persists after each transition, emits events through `EventSink`,
//! and updates the StoryPlan as steps produce output. The Tauri adapter
//! (commands.rs) wraps this testable core.

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::{Mutex, Notify};

use crate::agents::{AgentContext, AgentError, AgentOutput, AgentRegistry, SceneScript};
use crate::pipeline::dsl::{FlowRecipe, StepKind};
use crate::pipeline::events::{EventSink, PipelineEvent};
use crate::pipeline::state::{Clock, RunState, RunStatus, StepRunHistory, StepStatus};
use crate::pipeline::store;
use crate::story_plan::{self, StoryPlan};
use crate::story_plan::types::PipelineRunSummary;

/// Shared, lockable handle to a running (or paused) run. The scheduler and
/// the pause/resume/retry/skip commands all reach the run through this.
pub struct RunHandle {
    pub state: Arc<Mutex<RunState>>,
    notify: Arc<Notify>,
    pause_after_step: AtomicBool,
}

impl RunHandle {
    pub async fn stop(
        &self,
        project_path: &Path,
        sink: &dyn EventSink,
        clock: &dyn Clock,
    ) -> Result<(), PipelineError> {
        let mut state = self.state.lock().await;
        if state.status.is_terminal() {
            return Ok(());
        }
        let previous = state.clone();
        let stopped_at = clock.now_ms();
        for step in &mut state.steps {
            if step.status == StepStatus::Running {
                step.status = StepStatus::Pending;
                step.started_at = None;
                step.finished_at = None;
                if let Some(attempt) = step.history.last_mut() {
                    attempt.error = Some("cancelled before completion".to_string());
                    attempt.finished_at = Some(stopped_at);
                    attempt.duration_ms = Some(stopped_at.saturating_sub(attempt.started_at));
                }
            }
        }
        state.status = RunStatus::Cancelled;
        state.updated_at = stopped_at;
        let run_id = state.run_id.clone();
        if let Err(error) = store::save_run_state(project_path, &state) {
            *state = previous;
            return Err(PipelineError::Store(error));
        }
        drop(state);
        self.pause_after_step.store(false, Ordering::SeqCst);
        self.notify.notify_one();
        sink.emit(PipelineEvent::RunStopped { run_id });
        Ok(())
    }

    pub fn state(&self) -> &Arc<Mutex<RunState>> {
        &self.state
    }
}

enum Action {
    /// Run the step with this id, kind, and resolved prompt.
    Run {
        id: String,
        kind: StepKind,
        prompt: String,
    },
    /// Nothing left to do this iteration.
    Idle,
}

/// The testable orchestrator core.
pub struct Pipeline {
    agents: AgentRegistry,
}

impl Pipeline {
    pub fn new(agents: AgentRegistry) -> Self {
        Pipeline { agents }
    }

    pub fn with_default_agents() -> Self {
        Self::new(AgentRegistry::with_defaults())
    }

    /// Create + persist a run, emit `RunStarted`, return a handle set to
    /// `Running`. Ensures a StoryPlan exists. Does NOT execute.
    pub fn create_run(
        &self,
        project_path: &Path,
        run_id: &str,
        prompt: &str,
        recipe: &FlowRecipe,
        clock: &dyn Clock,
        sink: &dyn EventSink,
    ) -> Result<Arc<RunHandle>, PipelineError> {
        recipe.validate().map_err(PipelineError::RecipeInvalid)?;
        // Validate or create the IR before writing any run state. An invalid
        // plan must not leave an orphan run that later bypasses validation.
        if story_plan::load_plan(project_path).map_err(PipelineError::Plan)?.is_none() {
            let plan = StoryPlan::new(prompt);
            story_plan::save_plan(project_path, &plan).map_err(PipelineError::Plan)?;
        }
        let mut state = RunState::new(run_id, project_path, prompt, recipe, clock.now_ms());
        state.status = RunStatus::Running;
        store::save_run_state(project_path, &state).map_err(PipelineError::Store)?;

        sink.emit(PipelineEvent::RunStarted {
            run_id: run_id.to_string(),
        });
        Ok(Arc::new(RunHandle {
            state: Arc::new(Mutex::new(state)),
            notify: Arc::new(Notify::new()),
            pause_after_step: AtomicBool::new(false),
        }))
    }

    /// Resume a run from its persisted state (after a crash or app restart).
    /// Loads the run, marks it `Running`, emits `RunResumed`. The caller then
    /// calls `execute`. Already-succeeded steps are not re-run.
    pub fn resume_run(
        &self,
        project_path: &Path,
        run_id: &str,
        sink: &dyn EventSink,
        clock: &dyn Clock,
    ) -> Result<Arc<RunHandle>, PipelineError> {
        if story_plan::load_plan(project_path)
            .map_err(PipelineError::Plan)?
            .is_none()
        {
            return Err(PipelineError::PlanMissing);
        }
        let mut state = store::load_run_state(project_path, run_id)
            .map_err(PipelineError::Store)?
            .ok_or(PipelineError::RunNotFound(run_id.to_string()))?;
        if state.status.is_terminal() {
            return Err(PipelineError::InvalidRunTransition(
                run_id.to_string(),
                "terminal runs cannot be resumed".to_string(),
            ));
        }
        // Crash recovery: a step left `Running` when the process died did not
        // complete, so reset it to `Pending` to be re-run. `Succeeded` steps
        // are never re-run.
        for step in &mut state.steps {
            if step.status == StepStatus::Running {
                let interrupted_at = clock.now_ms();
                if let Some(attempt) = step.history.last_mut() {
                    attempt.error = Some("interrupted before completion".to_string());
                    attempt.finished_at = Some(interrupted_at);
                    attempt.duration_ms = Some(interrupted_at.saturating_sub(attempt.started_at));
                }
                step.status = StepStatus::Pending;
                step.started_at = None;
                step.output = None;
            }
        }
        state.status = RunStatus::Running;
        state.updated_at = clock.now_ms();
        store::save_run_state(project_path, &state).map_err(PipelineError::Store)?;
        sink.emit(PipelineEvent::RunResumed {
            run_id: run_id.to_string(),
        });
        Ok(Arc::new(RunHandle {
            state: Arc::new(Mutex::new(state)),
            notify: Arc::new(Notify::new()),
            pause_after_step: AtomicBool::new(false),
        }))
    }

    /// Attach a persisted run without changing or driving it. Commands use
    /// this after an app restart when the user wants to retry a completed or
    /// failed step.
    pub fn attach_run(
        &self,
        project_path: &Path,
        run_id: &str,
    ) -> Result<Arc<RunHandle>, PipelineError> {
        if story_plan::load_plan(project_path)
            .map_err(PipelineError::Plan)?
            .is_none()
        {
            return Err(PipelineError::PlanMissing);
        }
        let state = store::load_run_state(project_path, run_id)
            .map_err(PipelineError::Store)?
            .ok_or(PipelineError::RunNotFound(run_id.to_string()))?;
        Ok(Arc::new(RunHandle {
            state: Arc::new(Mutex::new(state)),
            notify: Arc::new(Notify::new()),
            pause_after_step: AtomicBool::new(false),
        }))
    }

    /// Drive the run: pick ready steps in dependency order, run their agent,
    /// update state + plan, persist after each transition, emit events.
    /// Returns when the run is `Completed`, `Failed`, or `Paused`.
    pub async fn execute(
        &self,
        project_path: &Path,
        handle: Arc<RunHandle>,
        sink: &dyn EventSink,
        clock: &dyn Clock,
    ) {
        loop {
            // Wait here while paused, until resume() notifies.
            {
                let state = handle.state.lock().await;
                if state.status.is_terminal() {
                    return;
                }
                if state.status == RunStatus::Paused {
                    drop(state);
                    handle.notify.notified().await;
                    continue;
                }
            }

            let action = self.next_action(project_path, &handle, sink, clock).await;
            match action {
                // `Idle` means either terminal (the run completed/failed) or a
                // transient pause observed between the top-of-loop check and
                // the lock. Either way, loop: the top check returns on terminal
                // and waits on pause.
                Action::Idle => continue,
                Action::Run { id, kind, prompt } => {
                    self.run_step(project_path, &handle, sink, clock, id, kind, prompt)
                        .await;
                    if handle.pause_after_step.swap(false, Ordering::SeqCst) {
                        let should_pause = {
                            let state = handle.state.lock().await;
                            !state.status.is_terminal() && !state.is_complete()
                        };
                        if should_pause {
                            if let Err(error) = handle.pause(project_path, sink, clock).await {
                                let mut state = handle.state.lock().await;
                                state.status = RunStatus::Failed;
                                state.updated_at = clock.now_ms();
                                let run_id = state.run_id.clone();
                                let _ = store::save_run_state(project_path, &state);
                                drop(state);
                                sink.emit(PipelineEvent::RunFailed {
                                    run_id,
                                    error: format!("failed to persist single-step pause: {}", error),
                                });
                                return;
                            }
                        }
                    }
                }
            }
        }
    }

    async fn next_action(
        &self,
        project_path: &Path,
        handle: &Arc<RunHandle>,
        sink: &dyn EventSink,
        clock: &dyn Clock,
    ) -> Action {
        let mut state = handle.state.lock().await;
        if state.status.is_terminal() || state.status == RunStatus::Paused {
            return Action::Idle;
        }
        match state.next_ready_step_id() {
            Some(id) => {
                // Capture run-scoped fields before the mutable step borrow.
                let run_id = state.run_id.clone();
                let run_prompt = state.prompt.clone();
                let (kind, prompt) = {
                    let step = state.find_step_mut(&id).expect("ready step exists");
                    let prompt = if step.def.prompt.trim().is_empty() {
                        run_prompt
                    } else {
                        step.def.prompt.clone()
                    };
                    let started_at = clock.now_ms();
                    step.status = StepStatus::Running;
                    step.attempt += 1;
                    step.started_at = Some(started_at);
                    step.finished_at = None;
                    step.history.push(StepRunHistory {
                        attempt: step.attempt,
                        input_snapshot: prompt.clone(),
                        output: None,
                        error: None,
                        started_at,
                        finished_at: None,
                        duration_ms: None,
                        diff: None,
                        cost: None,
                        warnings: Vec::new(),
                        downgrade: None,
                    });
                    (step.def.kind, prompt)
                };
                state.updated_at = clock.now_ms();
                if let Err(err) = store::save_run_state(project_path, &state) {
                    let error = format!("failed to persist step transition: {}", err);
                    if let Some(step) = state.find_step_mut(&id) {
                        let finished_at = clock.now_ms();
                        step.status = StepStatus::Failed;
                        step.error = Some(error.clone());
                        step.finished_at = Some(finished_at);
                        if let Some(attempt) = step.history.last_mut() {
                            attempt.error = Some(error.clone());
                            attempt.finished_at = Some(finished_at);
                            attempt.duration_ms =
                                Some(finished_at.saturating_sub(attempt.started_at));
                        }
                    }
                    state.status = RunStatus::Failed;
                    let run_id = state.run_id.clone();
                    drop(state);
                    sink.emit(PipelineEvent::RunFailed {
                        run_id,
                        error,
                    });
                    return Action::Idle;
                }
                drop(state);
                sink.emit(PipelineEvent::StepStarted {
                    run_id: run_id.clone(),
                    step_id: id.clone(),
                    kind: kind.as_str().to_string(),
                });
                Action::Run { id, kind, prompt }
            }
            None => {
                if state.is_complete() {
                    state.status = RunStatus::Completed;
                    state.updated_at = clock.now_ms();
                    let run_id = state.run_id.clone();
                    if let Err(err) = store::save_run_state(project_path, &state) {
                        state.status = RunStatus::Failed;
                        let run_id = state.run_id.clone();
                        drop(state);
                        sink.emit(PipelineEvent::RunFailed {
                            run_id,
                            error: format!("failed to persist run completion: {}", err),
                        });
                        return Action::Idle;
                    }
                    drop(state);
                    sink.emit(PipelineEvent::RunCompleted {
                        run_id: run_id.clone(),
                    });
                    let _ = self.record_run_summary(project_path, &run_id, clock);
                    Action::Idle
                } else {
                    let error = "flow blocked: a dependency failed or is missing".to_string();
                    state.status = RunStatus::Failed;
                    state.updated_at = clock.now_ms();
                    let run_id = state.run_id.clone();
                    let _ = store::save_run_state(project_path, &state);
                    drop(state);
                    sink.emit(PipelineEvent::RunFailed {
                        run_id,
                        error: error.clone(),
                    });
                    Action::Idle
                }
            }
        }
    }

    async fn run_step(
        &self,
        project_path: &Path,
        handle: &Arc<RunHandle>,
        sink: &dyn EventSink,
        clock: &dyn Clock,
        id: String,
        kind: StepKind,
        prompt: String,
    ) {
        // Load the plan to build the agent context.
        let mut plan = match story_plan::load_plan(project_path) {
            Ok(Some(plan)) => plan,
            Ok(None) => {
                self.fail_step(
                    project_path,
                    handle,
                    sink,
                    clock,
                    id,
                    "StoryPlan is missing".to_string(),
                )
                .await;
                return;
            }
            Err(error) => {
                self.fail_step(
                    project_path,
                    handle,
                    sink,
                    clock,
                    id,
                    format!("failed to load StoryPlan: {}", error),
                )
                .await;
                return;
            }
        };

        let input_snapshot = serde_json::json!({
            "prompt": &prompt,
            "synopsis": &plan.synopsis,
            "chapters": &plan.chapters,
            "worldbook": &plan.memory.worldbook,
        })
        .to_string();
        let snapshot_result = {
            let mut state = handle.state.lock().await;
            if let Some(attempt) = state
                .find_step_mut(&id)
                .and_then(|step| step.history.last_mut())
            {
                attempt.input_snapshot = input_snapshot;
            }
            state.updated_at = clock.now_ms();
            store::save_run_state(project_path, &state)
        };
        if let Err(error) = snapshot_result {
            self.fail_step(
                project_path,
                handle,
                sink,
                clock,
                id,
                format!("failed to persist step input snapshot: {}", error),
            )
            .await;
            return;
        }

        let ctx = AgentContext {
            prompt: &prompt,
            synopsis: &plan.synopsis,
            chapters: &plan.chapters,
            worldbook: &plan.memory.worldbook,
        };
        let result = match self.agents.get(kind) {
            Some(agent) => agent.run(&ctx).await,
            None => Err(AgentError(format!(
                "no agent registered for step kind '{}'",
                kind.as_str()
            ))),
        };
        match result {
            Ok(out) => {
                // Crash-safety order: apply output to the plan and persist it
                // BEFORE marking the step Succeeded. If the process dies between
                // these two writes, the step is left Running and reset to Pending
                // on resume, then re-run. P0 stub agents are deterministic, so
                // re-applying is idempotent. P1 LLM agents need reconciliation
                // (e.g. output versioning) to avoid double-applying - see ADR 0054.
                let mut state = handle.state.lock().await;
                if state.status == RunStatus::Cancelled {
                    return;
                }
                // Keep stop() outside the two durable writes: cancellation
                // takes effect either before output or after a full commit.
                apply_output(&mut plan, kind, &out);
                let persist_result = if let Some(scene) = out.scene.as_ref() {
                    write_scene_file(project_path, scene).map_err(|e| {
                        AgentError(format!("failed to write scene '{}': {}", scene.name, e))
                    })
                } else {
                    Ok(())
                }
                .and_then(|_| {
                    story_plan::save_plan(project_path, &plan)
                        .map_err(|e| AgentError(format!("failed to save StoryPlan: {}", e)))
                });
                if let Err(error) = persist_result {
                    drop(state);
                    self.fail_step(project_path, handle, sink, clock, id, error.0)
                        .await;
                    return;
                }
                {
                    let step = state.find_step_mut(&id).expect("step exists");
                    let finished_at = clock.now_ms();
                    let output = serialize_output(&out);
                    step.status = StepStatus::Succeeded;
                    step.finished_at = Some(finished_at);
                    step.output = Some(output.clone());
                    if let Some(attempt) = step.history.last_mut() {
                        attempt.output = Some(output);
                        attempt.finished_at = Some(finished_at);
                        attempt.duration_ms = Some(finished_at.saturating_sub(attempt.started_at));
                    }
                }
                state.updated_at = clock.now_ms();
                let run_id = state.run_id.clone();
                let output_ref = state.find_step(&id).expect("step exists").output.clone();
                if let Err(err) = store::save_run_state(project_path, &state) {
                    let error = format!("failed to persist step success: {}", err);
                    if let Some(step) = state.find_step_mut(&id) {
                        step.status = StepStatus::Failed;
                        step.error = Some(error.clone());
                        if let Some(attempt) = step.history.last_mut() {
                            attempt.error = Some(error.clone());
                        }
                    }
                    state.status = RunStatus::Failed;
                    let run_id = state.run_id.clone();
                    drop(state);
                    sink.emit(PipelineEvent::StepFailed {
                        run_id: run_id.clone(),
                        step_id: id,
                        error: error.clone(),
                    });
                    sink.emit(PipelineEvent::RunFailed { run_id, error });
                    return;
                }
                drop(state);
                sink.emit(PipelineEvent::StepSucceeded {
                    run_id,
                    step_id: id,
                    output: output_ref,
                });
            }
            Err(err) => self
                .fail_step(project_path, handle, sink, clock, id, err.0)
                .await,
        }
    }

    async fn fail_step(
        &self,
        project_path: &Path,
        handle: &Arc<RunHandle>,
        sink: &dyn EventSink,
        clock: &dyn Clock,
        step_id: String,
        error: String,
    ) {
        let mut state = handle.state.lock().await;
        if state.status == RunStatus::Cancelled {
            return;
        }
        let finished_at = clock.now_ms();
        if let Some(step) = state.find_step_mut(&step_id) {
            step.status = StepStatus::Failed;
            step.error = Some(error.clone());
            step.finished_at = Some(finished_at);
            if let Some(attempt) = step.history.last_mut() {
                attempt.error = Some(error.clone());
                attempt.finished_at = Some(finished_at);
                attempt.duration_ms = Some(finished_at.saturating_sub(attempt.started_at));
            }
        }
        state.status = RunStatus::Failed;
        state.updated_at = finished_at;
        let run_id = state.run_id.clone();
        let _ = store::save_run_state(project_path, &state);
        drop(state);
        sink.emit(PipelineEvent::StepFailed {
            run_id: run_id.clone(),
            step_id,
            error: error.clone(),
        });
        sink.emit(PipelineEvent::RunFailed {
            run_id: run_id.clone(),
            error,
        });
        let _ = self.record_run_summary(project_path, &run_id, clock);
    }

    pub(crate) fn record_run_summary(
        &self,
        project_path: &Path,
        run_id: &str,
        clock: &dyn Clock,
    ) -> Result<(), PipelineError> {
        let state = store::load_run_state(project_path, run_id)
            .map_err(PipelineError::Store)?
            .ok_or_else(|| PipelineError::RunNotFound(run_id.to_string()))?;
        let mut plan = story_plan::load_plan(project_path)
            .map_err(PipelineError::Plan)?
            .unwrap_or_else(|| StoryPlan::new(""));
        let summary = PipelineRunSummary {
            run_id: run_id.to_string(),
            status: format!("{:?}", state.status).to_lowercase(),
            started_at: state.started_at,
            updated_at: clock.now_ms(),
        };
        plan.pipeline_runs.retain(|r| r.run_id != summary.run_id);
        plan.pipeline_runs.push(summary);
        story_plan::save_plan(project_path, &plan).map_err(PipelineError::Plan)
    }
}

/// Apply an agent's output to the in-memory StoryPlan.
fn apply_output(plan: &mut StoryPlan, kind: StepKind, out: &AgentOutput) {
    match kind {
        StepKind::Plan => {
            if let Some(synopsis) = &out.synopsis {
                plan.synopsis = synopsis.clone();
            }
        }
        StepKind::Memory => {
            if let Some(worldbook) = &out.worldbook {
                plan.memory.worldbook = worldbook.clone();
            }
        }
        StepKind::Outline => {
            if let Some(chapters) = &out.chapters {
                plan.chapters = chapters.clone();
            }
        }
        StepKind::Scene => {
            if let Some(scene) = &out.scene {
                if !plan.scenes.contains(&scene.name) {
                    plan.scenes.push(scene.name.clone());
                }
            }
        }
        _ => {
            // Future slices produce memory/characters/assets/etc.
        }
    }
}

/// Write a generated scene script to `<project>/game/scene/<name>`.
fn write_scene_file(project_path: &Path, scene: &SceneScript) -> std::io::Result<()> {
    let dir = project_path.join("game").join("scene");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(&scene.name), &scene.content)
}

fn serialize_output(out: &AgentOutput) -> String {
    serde_json::to_string(out).unwrap_or_else(|_| "{}".to_string())
}

impl RunHandle {
    pub async fn pause(
        &self,
        project_path: &Path,
        sink: &dyn EventSink,
        clock: &dyn Clock,
    ) -> Result<(), PipelineError> {
        let mut state = self.state.lock().await;
        if state.status != RunStatus::Running {
            return Ok(());
        }
        let previous_updated_at = state.updated_at;
        state.status = RunStatus::Paused;
        state.updated_at = clock.now_ms();
        let run_id = state.run_id.clone();
        if let Err(error) = store::save_run_state(project_path, &state) {
            state.status = RunStatus::Running;
            state.updated_at = previous_updated_at;
            return Err(PipelineError::Store(error));
        }
        drop(state);
        sink.emit(PipelineEvent::RunPaused { run_id });
        Ok(())
    }

    pub async fn resume(
        &self,
        project_path: &Path,
        sink: &dyn EventSink,
        clock: &dyn Clock,
    ) -> Result<(), PipelineError> {
        {
            let mut state = self.state.lock().await;
            if state.status != RunStatus::Paused {
                return Ok(());
            }
            state.status = RunStatus::Running;
            state.updated_at = clock.now_ms();
            let run_id = state.run_id.clone();
            store::save_run_state(project_path, &state).map_err(PipelineError::Store)?;
            drop(state);
            sink.emit(PipelineEvent::RunResumed { run_id });
        }
        self.notify.notify_one();
        Ok(())
    }

    pub async fn step_once(
        &self,
        project_path: &Path,
        sink: &dyn EventSink,
        clock: &dyn Clock,
    ) -> Result<(), PipelineError> {
        let mut state = self.state.lock().await;
        if state.status != RunStatus::Paused {
            return Err(PipelineError::InvalidRunTransition(
                state.run_id.clone(),
                "single-step requires a paused run".to_string(),
            ));
        }
        let previous_updated_at = state.updated_at;
        state.status = RunStatus::Running;
        state.updated_at = clock.now_ms();
        let run_id = state.run_id.clone();
        self.pause_after_step.store(true, Ordering::SeqCst);
        if let Err(error) = store::save_run_state(project_path, &state) {
            state.status = RunStatus::Paused;
            state.updated_at = previous_updated_at;
            self.pause_after_step.store(false, Ordering::SeqCst);
            return Err(PipelineError::Store(error));
        }
        drop(state);
        sink.emit(PipelineEvent::RunResumed { run_id });
        self.notify.notify_one();
        Ok(())
    }

    /// Reset a step and everything downstream so the scheduler re-runs a
    /// coherent suffix of the DAG without repeating completed upstream work.
    pub async fn retry_step(
        &self,
        project_path: &Path,
        step_id: &str,
        sink: &dyn EventSink,
        clock: &dyn Clock,
    ) -> Result<(), PipelineError> {
        {
            let mut state = self.state.lock().await;
            let target = state
                .find_step(step_id)
                .ok_or_else(|| PipelineError::StepNotFound(step_id.to_string()))?;
            if target.status == StepStatus::Running {
                return Err(PipelineError::InvalidStepTransition(
                    step_id.to_string(),
                    "cannot retry a running step".to_string(),
                ));
            }
            let mut reset = HashSet::from([step_id.to_string()]);
            loop {
                let before = reset.len();
                for step in &state.steps {
                    if step.def.depends_on.iter().any(|dep| reset.contains(dep)) {
                        reset.insert(step.def.id.clone());
                    }
                }
                if reset.len() == before {
                    break;
                }
            }
            for step in &mut state.steps {
                if reset.contains(&step.def.id) {
                    step.status = StepStatus::Pending;
                    step.error = None;
                    step.output = None;
                    step.started_at = None;
                    step.finished_at = None;
                }
            }
            if state.status.is_terminal() {
                state.status = RunStatus::Running;
            }
            state.updated_at = clock.now_ms();
            store::save_run_state(project_path, &state).map_err(PipelineError::Store)?;
        }
        let _ = sink;
        self.notify.notify_one();
        Ok(())
    }

    /// Mark a step `Skipped`; downstream steps whose only dep is this one
    /// become ready. A skipped optional step keeps the flow moving.
    pub async fn skip_step(
        &self,
        project_path: &Path,
        step_id: &str,
        sink: &dyn EventSink,
        clock: &dyn Clock,
    ) -> Result<(), PipelineError> {
        let run_id;
        {
            let mut state = self.state.lock().await;
            let step = state
                .find_step_mut(step_id)
                .ok_or_else(|| PipelineError::StepNotFound(step_id.to_string()))?;
            if step.status != StepStatus::Pending {
                return Err(PipelineError::InvalidStepTransition(
                    step_id.to_string(),
                    "only pending steps can be skipped".to_string(),
                ));
            }
            step.status = StepStatus::Skipped;
            step.error = None;
            step.finished_at = Some(clock.now_ms());
            if state.status == RunStatus::Failed {
                state.status = RunStatus::Running;
            }
            state.updated_at = clock.now_ms();
            run_id = state.run_id.clone();
            store::save_run_state(project_path, &state).map_err(PipelineError::Store)?;
        }
        sink.emit(PipelineEvent::StepSkipped {
            run_id,
            step_id: step_id.to_string(),
        });
        self.notify.notify_one();
        Ok(())
    }

    pub async fn update_dependencies(
        &self,
        project_path: &Path,
        step_id: &str,
        depends_on: Vec<String>,
        clock: &dyn Clock,
    ) -> Result<(), PipelineError> {
        let mut state = self.state.lock().await;
        let step = state
            .find_step(step_id)
            .ok_or_else(|| PipelineError::StepNotFound(step_id.to_string()))?;
        if step.status != StepStatus::Pending {
            return Err(PipelineError::InvalidStepTransition(
                step_id.to_string(),
                "only pending step dependencies can be edited".to_string(),
            ));
        }
        let mut recipe = FlowRecipe {
            steps: state.steps.iter().map(|step| step.def.clone()).collect(),
        };
        recipe
            .steps
            .iter_mut()
            .find(|step| step.id == step_id)
            .expect("step was checked above")
            .depends_on = depends_on;
        recipe.validate().map_err(PipelineError::RecipeInvalid)?;
        state.find_step_mut(step_id).expect("step exists").def = recipe
            .steps
            .into_iter()
            .find(|step| step.id == step_id)
            .expect("validated recipe contains step");
        state.updated_at = clock.now_ms();
        store::save_run_state(project_path, &state).map_err(PipelineError::Store)
    }

    pub async fn update_step_prompt(
        &self,
        project_path: &Path,
        step_id: &str,
        prompt: String,
        clock: &dyn Clock,
    ) -> Result<(), PipelineError> {
        let mut state = self.state.lock().await;
        let step = state
            .find_step_mut(step_id)
            .ok_or_else(|| PipelineError::StepNotFound(step_id.to_string()))?;
        if step.status == StepStatus::Running {
            return Err(PipelineError::InvalidStepTransition(
                step_id.to_string(),
                "cannot edit the prompt of a running step".to_string(),
            ));
        }
        let previous_prompt = step.def.prompt.clone();
        step.def.prompt = prompt;
        let previous_updated_at = state.updated_at;
        state.updated_at = clock.now_ms();
        if let Err(error) = store::save_run_state(project_path, &state) {
            state.find_step_mut(step_id).expect("step exists").def.prompt = previous_prompt;
            state.updated_at = previous_updated_at;
            return Err(PipelineError::Store(error));
        }
        Ok(())
    }
}

#[derive(Debug)]
pub enum PipelineError {
    RecipeInvalid(crate::pipeline::dsl::RecipeError),
    Store(crate::pipeline::store::RunStoreError),
    Plan(crate::story_plan::PlanError),
    PlanMissing,
    RunNotFound(String),
    StepNotFound(String),
    InvalidStepTransition(String, String),
    InvalidRunTransition(String, String),
}

impl std::fmt::Display for PipelineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PipelineError::RecipeInvalid(e) => write!(f, "invalid recipe: {}", e),
            PipelineError::Store(e) => write!(f, "run store error: {}", e),
            PipelineError::Plan(e) => write!(f, "story plan error: {}", e),
            PipelineError::PlanMissing => write!(f, "StoryPlan is missing"),
            PipelineError::RunNotFound(id) => write!(f, "run not found: {}", id),
            PipelineError::StepNotFound(id) => write!(f, "step not found: {}", id),
            PipelineError::InvalidStepTransition(id, reason) => {
                write!(f, "invalid transition for step '{}': {}", id, reason)
            }
            PipelineError::InvalidRunTransition(id, reason) => {
                write!(f, "invalid transition for run '{}': {}", id, reason)
            }
        }
    }
}

impl std::error::Error for PipelineError {}
