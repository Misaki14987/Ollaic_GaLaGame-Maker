//! Integration tests for the Pipeline Orchestrator. These exercise the
//! scheduler through its public API (`Pipeline::create_run` / `execute` and
//! `RunHandle` controls) with injectable agents, a deterministic clock, and a
//! recording sink - no LLM, no browser, no real time.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use tokio::sync::{Mutex as AsyncMutex, Notify};
use tokio::time::{sleep, timeout, Duration};

use crate::agents::{Agent, AgentContext, AgentError, AgentOutput, AgentRegistry};
use crate::pipeline::dsl::{default_recipe, FlowRecipe, RecipeError, StepDef, StepKind};
use crate::pipeline::events::{PipelineEvent, RecordingSink};
use crate::pipeline::scheduler::Pipeline;
use crate::pipeline::state::{Clock, RunStatus, StepStatus, SystemClock};
use crate::story_plan::types::ChapterPlan;

// ---------- test helpers ----------

/// A clock that returns an incrementing value on each call, for stable
/// timestamps in assertions.
struct StepClock {
    next: std::sync::Mutex<u64>,
}
impl StepClock {
    fn new() -> Self {
        StepClock {
            next: std::sync::Mutex::new(1_700_000_000_000),
        }
    }
}
impl Clock for StepClock {
    fn now_ms(&self) -> u64 {
        let mut n = self.next.lock().unwrap();
        let v = *n;
        *n += 1;
        v
    }
}

/// An agent that blocks on a `Notify` gate before returning a fixed output,
/// giving tests a deterministic window to pause/resume or simulate a crash.
struct ControllableAgent {
    gate: Arc<Notify>,
    output: AgentOutput,
}
impl Agent for ControllableAgent {
    fn run<'a>(
        &'a self,
        _ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        let gate = self.gate.clone();
        let output = self.output.clone();
        Box::pin(async move {
            gate.notified().await;
            Ok(output)
        })
    }
}

/// An agent that always fails.
struct FailingAgent {
    message: String,
}
impl Agent for FailingAgent {
    fn run<'a>(
        &'a self,
        _ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        let message = self.message.clone();
        Box::pin(async move { Err(AgentError(message)) })
    }
}

/// An agent that fails the first N calls, then succeeds. For retry tests.
struct OnceFailingAgent {
    fails_left: Arc<AsyncMutex<u32>>,
    output: AgentOutput,
}
impl Agent for OnceFailingAgent {
    fn run<'a>(
        &'a self,
        _ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        let fails = self.fails_left.clone();
        let output = self.output.clone();
        Box::pin(async move {
            let mut n = fails.lock().await;
            if *n > 0 {
                *n -= 1;
                return Err(AgentError("flaky failure".to_string()));
            }
            drop(n);
            Ok(output)
        })
    }
}

/// An instant agent that counts how many times it ran.
struct CountingAgent {
    calls: Arc<AtomicU32>,
    output: AgentOutput,
}
impl Agent for CountingAgent {
    fn run<'a>(
        &'a self,
        _ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        let calls = self.calls.clone();
        let output = self.output.clone();
        Box::pin(async move {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(output)
        })
    }
}

fn synopsis_output(text: &str) -> AgentOutput {
    AgentOutput {
        synopsis: Some(text.to_string()),
        worldbook: None,
        chapters: None,
        scene: None,
    }
}

fn chapters_output() -> AgentOutput {
    AgentOutput {
        synopsis: None,
        worldbook: None,
        chapters: Some(vec![
            ChapterPlan {
                id: "ch1".to_string(),
                title: "序章".to_string(),
                summary: "s1".to_string(),
            },
            ChapterPlan {
                id: "ch2".to_string(),
                title: "第一章".to_string(),
                summary: "s2".to_string(),
            },
        ]),
        scene: None,
    }
}

fn fresh_project(name: &str) -> std::path::PathBuf {
    let tmp = std::env::temp_dir().join(format!("ollaic_pipeline_{}", name));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    tmp
}

/// Human-readable event sequence: run events by name, step events by
/// `{type}:{step_id}`.
fn labels(events: &[PipelineEvent]) -> Vec<String> {
    events
        .iter()
        .map(|e| match e {
            PipelineEvent::RunStarted { .. } => "run_started".to_string(),
            PipelineEvent::StepStarted { step_id, .. } => format!("step_started:{}", step_id),
            PipelineEvent::StepSucceeded { step_id, .. } => format!("step_succeeded:{}", step_id),
            PipelineEvent::StepFailed { step_id, .. } => format!("step_failed:{}", step_id),
            PipelineEvent::StepSkipped { step_id, .. } => format!("step_skipped:{}", step_id),
            PipelineEvent::RunPaused { .. } => "run_paused".to_string(),
            PipelineEvent::RunResumed { .. } => "run_resumed".to_string(),
            PipelineEvent::RunCompleted { .. } => "run_completed".to_string(),
            PipelineEvent::RunFailed { .. } => "run_failed".to_string(),
        })
        .collect()
}

/// Wait until the sink's events satisfy `predicate`, or panic after a timeout.
async fn wait_until<F>(sink: &RecordingSink, predicate: F)
where
    F: Fn(&[PipelineEvent]) -> bool,
{
    timeout(Duration::from_secs(3), async {
        loop {
            if predicate(&sink.events()) {
                return;
            }
            sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("timed out waiting for pipeline events");
}

// ---------- DSL ----------

#[test]
fn default_recipe_is_valid() {
    assert!(default_recipe().validate().is_ok());
}

#[test]
fn ipc_contract_serializes_to_camel_case() {
    // Pin the exact JSON shape the frontend (pipeline-ipc.ts) must match.
    use serde_json::json;

    let step_started = PipelineEvent::StepStarted {
        run_id: "run_1".to_string(),
        step_id: "plan".to_string(),
        kind: "plan".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&step_started).unwrap(),
        json!({
            "type": "stepStarted",
            "runId": "run_1",
            "stepId": "plan",
            "kind": "plan"
        })
    );

    let run_failed = PipelineEvent::RunFailed {
        run_id: "run_1".to_string(),
        error: "boom".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&run_failed).unwrap(),
        json!({ "type": "runFailed", "runId": "run_1", "error": "boom" })
    );

    // RunState / StepState / StepDef / enums also camelCase.
    let recipe = default_recipe();
    let state = crate::pipeline::state::RunState::new(
        "run_1",
        ".",
        "brief",
        &recipe,
        100,
    );
    let v = serde_json::to_value(&state).unwrap();
    assert_eq!(v["runId"], "run_1");
    assert_eq!(v["projectPath"], ".");
    assert_eq!(v["status"], "idle");
    assert_eq!(v["steps"][0]["def"]["kind"], "plan");
    assert_eq!(v["steps"][0]["status"], "pending");
    assert_eq!(v["steps"][1]["def"]["dependsOn"][0], "plan");
}

#[test]
fn recipe_rejects_a_dependency_cycle() {
    let recipe = FlowRecipe::new()
        .step(StepDef::new("a", StepKind::Plan).depends_on("b"))
        .step(StepDef::new("b", StepKind::Outline).depends_on("a"));
    assert!(matches!(
        recipe.validate(),
        Err(RecipeError::CycleThrough(_))
    ));
}

#[test]
fn recipe_rejects_unknown_dependency() {
    let recipe = FlowRecipe::new().step(StepDef::new("a", StepKind::Plan).depends_on("ghost"));
    assert!(matches!(
        recipe.validate(),
        Err(RecipeError::UnknownDependency(_, _))
    ));
}

// ---------- scheduler: tracer bullet ----------

#[tokio::test]
async fn runs_two_step_recipe_in_order_and_updates_plan() {
    let project = fresh_project("happy");
    let sink = Arc::new(RecordingSink::new());
    let clock = StepClock::new();
    let pipeline = Pipeline::with_default_agents();

    let handle = pipeline
        .create_run(&project, "run_1", "赛博朋克校园恋爱", &default_recipe(), &clock, sink.as_ref())
        .unwrap();

    // Drive the run to completion.
    timeout(Duration::from_secs(3), pipeline.execute(&project, handle.clone(), sink.as_ref(), &clock))
        .await
        .expect("run did not complete in time");

    let seq = labels(&sink.events());
    assert_eq!(
        seq,
        vec![
            "run_started",
            "step_started:plan",
            "step_succeeded:plan",
            "step_started:outline",
            "step_succeeded:outline",
            "run_completed",
        ]
    );

    // The StoryPlan absorbed every step's output.
    let plan = crate::story_plan::load_plan(&project).unwrap().unwrap();
    assert!(plan.synopsis.contains("赛博朋克校园恋爱"));
    assert_eq!(plan.chapters.len(), 2);
    assert_eq!(plan.chapters[0].id, "ch1");
    assert!(plan.chapters[0].summary.contains("赛博朋克校园恋爱"));
    assert!(plan.scenes.is_empty(), "P0 must not write P1 scene output");

    // Run history was recorded.
    assert_eq!(plan.pipeline_runs.len(), 1);
    assert_eq!(plan.pipeline_runs[0].run_id, "run_1");
    assert_eq!(plan.pipeline_runs[0].status, "completed");

    // Run state persisted as completed.
    let run_state = crate::pipeline::load_run_state(&project, "run_1").unwrap().unwrap();
    assert_eq!(run_state.status, RunStatus::Completed);
    assert!(run_state.all_steps_succeeded());
    assert!(run_state.steps.iter().all(|step| step.history.len() == 1));
    assert_eq!(run_state.find_step("plan").unwrap().history[0].input_snapshot, "赛博朋克校园恋爱");
    assert!(run_state.find_step("outline").unwrap().history[0].duration_ms.is_some());
}

// ---------- scheduler: failure ----------

#[tokio::test]
async fn failed_step_fails_run_and_skips_downstream() {
    let project = fresh_project("fail");
    let sink = Arc::new(RecordingSink::new());
    let clock = StepClock::new();

    let mut agents = AgentRegistry::new();
    agents.register(StepKind::Plan, Box::new(FailingAgent {
        message: "model overload".to_string(),
    }));
    agents.register(StepKind::Memory, Box::new(crate::agents::MemoryAgent));
    agents.register(StepKind::Outline, Box::new(crate::agents::OutlineAgent));
    agents.register(StepKind::Scene, Box::new(crate::agents::SceneAgent));
    let pipeline = Pipeline::new(agents);

    let handle = pipeline
        .create_run(&project, "run_fail", "brief", &default_recipe(), &clock, sink.as_ref())
        .unwrap();

    timeout(Duration::from_secs(3), pipeline.execute(&project, handle.clone(), sink.as_ref(), &clock))
        .await
        .expect("run did not finish");

    let seq = labels(&sink.events());
    assert_eq!(
        seq,
        vec![
            "run_started",
            "step_started:plan",
            "step_failed:plan",
            "run_failed",
        ]
    );

    // Downstream outline never ran.
    let run_state = crate::pipeline::load_run_state(&project, "run_fail").unwrap().unwrap();
    assert_eq!(run_state.status, RunStatus::Failed);
    assert_eq!(
        run_state.find_step("plan").unwrap().status,
        StepStatus::Failed
    );
    assert_eq!(
        run_state.find_step("outline").unwrap().status,
        StepStatus::Pending
    );
}

// ---------- scheduler: pause / resume ----------

#[tokio::test]
async fn pause_then_resume_completes_run() {
    let project = fresh_project("pause");
    let sink = Arc::new(RecordingSink::new());
    let clock = StepClock::new();

    let plan_gate = Arc::new(Notify::new());
    let mut agents = AgentRegistry::new();
    agents.register(
        StepKind::Plan,
        Box::new(ControllableAgent {
            gate: plan_gate.clone(),
            output: synopsis_output("【梗概】暂停测试"),
        }),
    );
    agents.register(StepKind::Memory, Box::new(crate::agents::MemoryAgent));
    agents.register(StepKind::Outline, Box::new(crate::agents::OutlineAgent));
    agents.register(StepKind::Scene, Box::new(crate::agents::SceneAgent));
    let pipeline = Pipeline::new(agents);

    let handle = pipeline
        .create_run(&project, "run_pause", "brief", &default_recipe(), &clock, sink.as_ref())
        .unwrap();

    let project_cloned = project.clone();
    let handle_for_task = handle.clone();
    let sink_for_task = sink.clone();
    let task = tokio::spawn(async move {
        pipeline
            .execute(&project_cloned, handle_for_task, sink_for_task.as_ref(), &SystemClock)
            .await;
    });
    // Pause/resume/retry/skip all live on RunHandle, so no Pipeline is needed
    // for control calls after the task is spawned.

    // Let the Plan step start (agent now awaiting its gate).
    wait_until(&sink, |e| e.iter().any(|ev| matches!(ev, PipelineEvent::StepStarted { step_id, .. } if step_id == "plan"))).await;

    // Pause while Plan is running.
    handle.pause(&project, sink.as_ref(), &SystemClock).await.unwrap();
    wait_until(&sink, |e| e.iter().any(|ev| matches!(ev, PipelineEvent::RunPaused { .. }))).await;

    // Let Plan finish; the loop then sees Paused and waits for resume.
    plan_gate.notify_one();
    wait_until(&sink, |e| e.iter().any(|ev| matches!(ev, PipelineEvent::StepSucceeded { step_id, .. } if step_id == "plan"))).await;

    // Resume: Outline should run and the run should complete.
    handle.resume(&project, sink.as_ref(), &SystemClock).await.unwrap();

    let _ = timeout(Duration::from_secs(3), task)
        .await
        .expect("task timed out");

    let seq = labels(&sink.events());
    assert!(seq.contains(&"run_paused".to_string()));
    assert!(seq.contains(&"run_resumed".to_string()));
    // Order: plan succeeds, then paused, then resumed, then outline.
    let plan_succeeded_idx = seq.iter().position(|s| s == "step_succeeded:plan").unwrap();
    let paused_idx = seq.iter().position(|s| s == "run_paused").unwrap();
    let resumed_idx = seq.iter().position(|s| s == "run_resumed").unwrap();
    let outline_started_idx = seq.iter().position(|s| s == "step_started:outline").unwrap();
    assert!(plan_succeeded_idx < paused_idx || paused_idx < plan_succeeded_idx); // either order is fine
    assert!(resumed_idx < outline_started_idx, "outline must start after resume");
    assert!(seq.contains(&"run_completed".to_string()));

    let run_state = crate::pipeline::load_run_state(&project, "run_pause").unwrap().unwrap();
    assert_eq!(run_state.status, RunStatus::Completed);
}

// ---------- scheduler: crash-resume ----------

#[tokio::test]
async fn crash_resume_does_not_redo_succeeded_steps() {
    let project = fresh_project("crash");
    let sink = Arc::new(RecordingSink::new());
    let clock = StepClock::new();

    let plan_calls = Arc::new(AtomicU32::new(0));
    let outline_gate = Arc::new(Notify::new());
    let mut agents = AgentRegistry::new();
    agents.register(
        StepKind::Plan,
        Box::new(CountingAgent {
            calls: plan_calls.clone(),
            output: synopsis_output("【梗概】崩溃恢复"),
        }),
    );
    agents.register(StepKind::Memory, Box::new(crate::agents::MemoryAgent));
    agents.register(
        StepKind::Outline,
        Box::new(ControllableAgent {
            gate: outline_gate.clone(),
            output: chapters_output(),
        }),
    );
    agents.register(StepKind::Scene, Box::new(crate::agents::SceneAgent));
    let pipeline = Arc::new(Pipeline::new(agents));

    let handle = pipeline
        .create_run(&project, "run_crash", "brief", &default_recipe(), &clock, sink.as_ref())
        .unwrap();

    // First lifecycle: Plan completes (instant), Outline starts and blocks.
    let pipeline1 = pipeline.clone();
    let project1 = project.clone();
    let handle1 = handle.clone();
    let sink1 = sink.clone();
    let task = tokio::spawn(async move {
        pipeline1.execute(&project1, handle1, sink1.as_ref(), &SystemClock).await;
    });
    wait_until(&sink, |e| {
        e.iter().any(|ev| matches!(ev, PipelineEvent::StepStarted { step_id, .. } if step_id == "outline"))
    })
    .await;

    // Simulate a crash: abort the task and drop the handle.
    task.abort();
    let _ = task.await;

    // Persisted state: Plan succeeded, Outline was left Running.
    let persisted = crate::pipeline::load_run_state(&project, "run_crash").unwrap().unwrap();
    assert_eq!(
        persisted.find_step("plan").unwrap().status,
        StepStatus::Succeeded
    );
    assert_eq!(
        persisted.find_step("outline").unwrap().status,
        StepStatus::Running
    );

    // Resume from disk with a fresh sink. Plan must NOT be re-run.
    let resumed_sink = Arc::new(RecordingSink::new());
    let resumed_handle = pipeline
        .resume_run(&project, "run_crash", resumed_sink.as_ref(), &SystemClock)
        .unwrap();
    let project2 = project.clone();
    let resumed_handle2 = resumed_handle.clone();
    let resumed_sink2 = resumed_sink.clone();
    let pipeline2 = pipeline.clone();
    let resume_task = tokio::spawn(async move {
        pipeline2.execute(&project2, resumed_handle2, resumed_sink2.as_ref(), &SystemClock).await;
    });
    // Outline is now Pending (reset by resume_run) and waiting on the gate.
    wait_until(&resumed_sink, |e| {
        e.iter().any(|ev| matches!(ev, PipelineEvent::StepStarted { step_id, .. } if step_id == "outline"))
    })
    .await;
    outline_gate.notify_one();
    let _ = timeout(Duration::from_secs(3), resume_task)
        .await
        .expect("resume did not complete");

    // Plan was run exactly once (the first lifecycle), never re-run on resume.
    assert_eq!(plan_calls.load(Ordering::SeqCst), 1);

    let seq = labels(&resumed_sink.events());
    assert!(!seq.iter().any(|s| s.contains("plan")), "plan must not be re-run after resume: {:?}", seq);
    assert_eq!(
        seq.iter().filter(|s| s == &"run_resumed").count(),
        1,
        "resume should emit RunResumed once: {:?}",
        seq
    );
    assert!(seq.contains(&"step_started:outline".to_string()));
    assert!(seq.contains(&"step_succeeded:outline".to_string()));
    assert!(seq.contains(&"run_completed".to_string()));

    let run_state = crate::pipeline::load_run_state(&project, "run_crash").unwrap().unwrap();
    assert_eq!(run_state.status, RunStatus::Completed);
}

// ---------- scheduler: skip ----------

#[tokio::test]
async fn skip_step_unblocks_downstream() {
    let project = fresh_project("skip");
    let sink = Arc::new(RecordingSink::new());
    let clock = StepClock::new();

    let plan_gate = Arc::new(Notify::new());
    let mut agents = AgentRegistry::new();
    agents.register(
        StepKind::Plan,
        Box::new(ControllableAgent {
            gate: plan_gate.clone(),
            output: synopsis_output("skipped-plan"),
        }),
    );
    agents.register(StepKind::Memory, Box::new(crate::agents::MemoryAgent));
    agents.register(StepKind::Outline, Box::new(crate::agents::OutlineAgent));
    agents.register(StepKind::Scene, Box::new(crate::agents::SceneAgent));
    let pipeline = Pipeline::new(agents);

    let recipe = FlowRecipe::new()
        .step(StepDef::new("plan", StepKind::Plan))
        .step(StepDef::new("outline", StepKind::Outline).depends_on("plan"))
        .step(StepDef::new("scene", StepKind::Scene).depends_on("outline"));
    let handle = pipeline
        .create_run(&project, "run_skip", "brief", &recipe, &clock, sink.as_ref())
        .unwrap();

    let project_c = project.clone();
    let handle_c = handle.clone();
    let sink_c = sink.clone();
    let task = tokio::spawn(async move {
        pipeline.execute(&project_c, handle_c, sink_c.as_ref(), &SystemClock).await;
    });

    // Wait for Plan to start (blocked on gate).
    wait_until(&sink, |e| {
        e.iter().any(|ev| matches!(ev, PipelineEvent::StepStarted { step_id, .. } if step_id == "plan"))
    })
    .await;

    // While Plan is running, skip the still-pending Scene step (the user opts
    // out of scene generation). Plan then Outline run; Scene is never started.
    handle.skip_step(&project, "scene", sink.as_ref(), &SystemClock).await.unwrap();

    // Let Plan finish; Outline runs, Scene is skipped, the run completes.
    plan_gate.notify_one();
    let _ = timeout(Duration::from_secs(3), task)
        .await
        .expect("run did not complete");

    let seq = labels(&sink.events());
    assert!(seq.contains(&"step_skipped:scene".to_string()));
    assert!(
        !seq.iter().any(|s| s == "step_started:scene"),
        "scene must not run: {:?}",
        seq
    );
    assert!(seq.contains(&"step_started:outline".to_string()));
    assert!(seq.contains(&"run_completed".to_string()));
    let run_state = crate::pipeline::load_run_state(&project, "run_skip").unwrap().unwrap();
    assert_eq!(run_state.status, RunStatus::Completed);
    assert_eq!(run_state.find_step("plan").unwrap().status, StepStatus::Succeeded);
    assert_eq!(run_state.find_step("outline").unwrap().status, StepStatus::Succeeded);
    assert_eq!(run_state.find_step("scene").unwrap().status, StepStatus::Skipped);
}

// ---------- scheduler: retry ----------

#[tokio::test]
async fn retry_step_reruns_and_completes() {
    let project = fresh_project("retry");
    let sink = Arc::new(RecordingSink::new());
    let clock = StepClock::new();

    let fails_left = Arc::new(AsyncMutex::new(1u32));
    let mut agents = AgentRegistry::new();
    agents.register(
        StepKind::Plan,
        Box::new(OnceFailingAgent {
            fails_left: fails_left.clone(),
            output: synopsis_output("【梗概】重试成功"),
        }),
    );
    agents.register(StepKind::Memory, Box::new(crate::agents::MemoryAgent));
    agents.register(StepKind::Outline, Box::new(crate::agents::OutlineAgent));
    agents.register(StepKind::Scene, Box::new(crate::agents::SceneAgent));
    let pipeline = Pipeline::new(agents);

    let handle = pipeline
        .create_run(&project, "run_retry", "brief", &default_recipe(), &clock, sink.as_ref())
        .unwrap();

    let project_c = project.clone();
    let handle_c = handle.clone();
    let sink_c = sink.clone();
    let task = tokio::spawn(async move {
        pipeline.execute(&project_c, handle_c, sink_c.as_ref(), &SystemClock).await;
    });

    // Plan fails on the first attempt -> run fails (execute returns).
    wait_until(&sink, |e| {
        e.iter().any(|ev| matches!(ev, PipelineEvent::RunFailed { .. }))
    })
    .await;
    let _ = timeout(Duration::from_secs(1), task).await;

    // Retry Plan: it now succeeds (fails_left exhausted).
    handle.retry_step(&project, "plan", sink.as_ref(), &SystemClock).await.unwrap();

    // Re-drive execution. The handle's state now has Plan=Pending and
    // status=Running; spawn a fresh execute task to continue the run.
    let handle2 = handle.clone();
    let project2 = project.clone();
    let sink2 = sink.clone();
    let pipeline_for_resume = Pipeline::new({
        let mut a = AgentRegistry::new();
        a.register(StepKind::Plan, Box::new(crate::agents::PlanAgent));
        a.register(StepKind::Memory, Box::new(crate::agents::MemoryAgent));
        a.register(StepKind::Outline, Box::new(crate::agents::OutlineAgent));
        a.register(StepKind::Scene, Box::new(crate::agents::SceneAgent));
        a
    });
    let resume_task = tokio::spawn(async move {
        pipeline_for_resume.execute(&project2, handle2, sink2.as_ref(), &SystemClock).await;
    });
    let _ = timeout(Duration::from_secs(3), resume_task)
        .await
        .expect("retry did not complete");

    let seq = labels(&sink.events());
    // Plan started twice (first attempt failed, second succeeded).
    assert_eq!(
        seq.iter().filter(|s| s == &"step_started:plan").count(),
        2,
        "plan should be started twice: {:?}",
        seq
    );
    assert_eq!(
        seq.iter().filter(|s| s == &"step_succeeded:plan").count(),
        1,
        "plan should succeed once: {:?}",
        seq
    );
    assert!(seq.contains(&"run_completed".to_string()));

    let run_state = crate::pipeline::load_run_state(&project, "run_retry").unwrap().unwrap();
    assert_eq!(run_state.status, RunStatus::Completed);
    let plan_step = run_state.find_step("plan").unwrap();
    assert_eq!(plan_step.history.len(), 2);
    assert!(plan_step.history[0].error.is_some());
    assert!(plan_step.history[1].output.is_some());
}

#[tokio::test]
async fn retrying_a_completed_step_resets_it_and_its_downstream() {
    let project = fresh_project("retry_completed");
    let sink = RecordingSink::new();
    let clock = StepClock::new();
    let pipeline = Pipeline::with_default_agents();
    let handle = pipeline
        .create_run(
            &project,
            "run_retry_completed",
            "brief",
            &default_recipe(),
            &clock,
            &sink,
        )
        .unwrap();

    pipeline
        .execute(&project, handle.clone(), &sink, &clock)
        .await;
    assert_eq!(handle.state().lock().await.status, RunStatus::Completed);

    handle
        .retry_step(&project, "plan", &sink, &clock)
        .await
        .unwrap();
    let state = handle.state().lock().await;
    assert_eq!(state.status, RunStatus::Running);
    assert_eq!(state.find_step("plan").unwrap().status, StepStatus::Pending);
    assert_eq!(state.find_step("outline").unwrap().status, StepStatus::Pending);
}

#[tokio::test]
async fn scene_write_failure_fails_the_step_instead_of_claiming_success() {
    let project = fresh_project("scene_write_failure");
    let sink = RecordingSink::new();
    let clock = StepClock::new();
    let pipeline = Pipeline::with_default_agents();
    let recipe = FlowRecipe::new()
        .step(StepDef::new("plan", StepKind::Plan))
        .step(StepDef::new("outline", StepKind::Outline).depends_on("plan"))
        .step(StepDef::new("scene", StepKind::Scene).depends_on("outline"));
    let handle = pipeline
        .create_run(
            &project,
            "run_scene_write_failure",
            "brief",
            &recipe,
            &clock,
            &sink,
        )
        .unwrap();
    std::fs::write(project.join("game"), "not a directory").unwrap();

    pipeline.execute(&project, handle.clone(), &sink, &clock).await;

    let state = handle.state().lock().await;
    assert_eq!(state.status, RunStatus::Failed);
    assert_eq!(state.find_step("scene").unwrap().status, StepStatus::Failed);
    assert!(state.find_step("scene").unwrap().error.as_deref().unwrap().contains("scene"));
    assert!(!labels(&sink.events()).contains(&"step_succeeded:scene".to_string()));
}

#[tokio::test]
async fn transition_persistence_failure_stops_before_running_the_agent() {
    let project = fresh_project("transition_write_failure");
    let sink = RecordingSink::new();
    let clock = StepClock::new();
    let pipeline = Pipeline::with_default_agents();
    let handle = pipeline
        .create_run(
            &project,
            "run_transition_write_failure",
            "brief",
            &default_recipe(),
            &clock,
            &sink,
        )
        .unwrap();
    let run_dir = project.join(".ollaic").join("pipeline");
    std::fs::remove_dir_all(&run_dir).unwrap();
    std::fs::write(&run_dir, "not a directory").unwrap();

    pipeline.execute(&project, handle.clone(), &sink, &clock).await;

    assert_eq!(handle.state().lock().await.status, RunStatus::Failed);
    let events = labels(&sink.events());
    assert!(events.contains(&"run_failed".to_string()));
    assert!(!events.iter().any(|event| event.starts_with("step_started:")));
}

#[tokio::test]
async fn pending_dependencies_are_editable_but_cycles_are_rejected() {
    let project = fresh_project("dependency_edit");
    let sink = RecordingSink::new();
    let clock = StepClock::new();
    let pipeline = Pipeline::with_default_agents();
    let handle = pipeline
        .create_run(
            &project,
            "run_dependency_edit",
            "brief",
            &default_recipe(),
            &clock,
            &sink,
        )
        .unwrap();

    assert!(handle
        .update_dependencies(&project, "plan", vec!["outline".to_string()], &clock)
        .await
        .is_err());
    handle
        .update_dependencies(&project, "outline", Vec::new(), &clock)
        .await
        .unwrap();

    let persisted = crate::pipeline::load_run_state(&project, "run_dependency_edit")
        .unwrap()
        .unwrap();
    assert!(persisted.find_step("outline").unwrap().def.depends_on.is_empty());
}
