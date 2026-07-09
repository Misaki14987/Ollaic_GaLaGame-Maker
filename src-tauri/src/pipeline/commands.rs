//! Tauri IPC adapters for the V2 Pipeline. Thin shims over the testable
//! `Pipeline` core: they translate IPC into core calls and pipe events to
//! the `pipeline:{run_id}` Tauri channel (ADR 0055). The hard logic lives in
//! `scheduler.rs` and is tested there; these commands are not unit-tested,
//! matching the codebase convention (e.g. `ai::commands`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use tauri::Emitter;

use crate::pipeline::dsl::default_recipe;
use crate::pipeline::events::{EventSink, PipelineEvent};
use crate::pipeline::scheduler::Pipeline;
use crate::pipeline::state::{RunState, SystemClock};
use crate::story_plan::{self, StoryPlan};

/// Emits pipeline events to the per-run Tauri channel `pipeline:{run_id}`.
pub struct TauriEventSink {
    app: tauri::AppHandle,
}

impl EventSink for TauriEventSink {
    fn emit(&self, event: PipelineEvent) {
        let channel = format!("pipeline:{}", event.run_id());
        let _ = self.app.emit(&channel, event);
    }
}

fn make_sink(app: &tauri::AppHandle) -> TauriEventSink {
    TauriEventSink {
        app: app.clone(),
    }
}

struct ManagedRun {
    handle: Arc<crate::pipeline::scheduler::RunHandle>,
    project_path: PathBuf,
    /// True while an `execute` task is currently driving this run (including
    /// while it is paused-and-waiting). Commands use it to decide whether to
    /// (re-)spawn the driver after a retry/skip on a finished run.
    driving: Arc<AtomicBool>,
}

/// Tauri-managed state: the pipeline plus its active runs.
pub struct Orchestrator {
    pipeline: Arc<Pipeline>,
    runs: tokio::sync::Mutex<HashMap<String, ManagedRun>>,
}

impl Orchestrator {
    pub fn new() -> Self {
        Orchestrator {
            pipeline: Arc::new(Pipeline::with_default_agents()),
            runs: tokio::sync::Mutex::new(HashMap::new()),
        }
    }
}

impl Default for Orchestrator {
    fn default() -> Self {
        Self::new()
    }
}

static RUN_COUNTER: AtomicU64 = AtomicU64::new(1);

fn new_run_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let n = RUN_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("run_{}_{}", now, n)
}

/// Drive a run to completion (or pause). Clears `driving` when done.
async fn drive(
    pipeline: Arc<Pipeline>,
    handle: Arc<crate::pipeline::scheduler::RunHandle>,
    driving: Arc<AtomicBool>,
    project_path: PathBuf,
    app: tauri::AppHandle,
) {
    driving.store(true, Ordering::SeqCst);
    let sink = make_sink(&app);
    pipeline
        .execute(&project_path, handle, &sink, &SystemClock)
        .await;
    driving.store(false, Ordering::SeqCst);
}

fn spawn_driver(
    pipeline: Arc<Pipeline>,
    handle: Arc<crate::pipeline::scheduler::RunHandle>,
    driving: Arc<AtomicBool>,
    project_path: PathBuf,
    app: tauri::AppHandle,
) {
    tauri::async_runtime::spawn(drive(
        pipeline, handle, driving, project_path, app,
    ));
}

#[tauri::command]
pub async fn pipeline_start(
    orchestrator: tauri::State<'_, Orchestrator>,
    app: tauri::AppHandle,
    project_path: String,
    prompt: String,
) -> Result<String, String> {
    let project_path = PathBuf::from(project_path);
    let run_id = new_run_id();
    let recipe = default_recipe();
    let sink = make_sink(&app);
    let handle = orchestrator
        .pipeline
        .create_run(&project_path, &run_id, &prompt, &recipe, &SystemClock, &sink)
        .map_err(|e| e.to_string())?;
    let driving = Arc::new(AtomicBool::new(false));
    orchestrator
        .runs
        .lock()
        .await
        .insert(
            run_id.clone(),
            ManagedRun {
                handle: handle.clone(),
                project_path: project_path.clone(),
                driving: driving.clone(),
            },
        );
    spawn_driver(
        orchestrator.pipeline.clone(),
        handle,
        driving,
        project_path,
        app,
    );
    Ok(run_id)
}

async fn with_run<F, R>(orchestrator: &Orchestrator, run_id: &str, f: F) -> Result<R, String>
where
    F: FnOnce(&ManagedRun) -> Result<R, String>,
{
    let guard = orchestrator.runs.lock().await;
    let entry = guard.get(run_id).ok_or_else(|| format!("run not found: {}", run_id))?;
    f(entry)
}

#[tauri::command]
pub async fn pipeline_pause(
    orchestrator: tauri::State<'_, Orchestrator>,
    app: tauri::AppHandle,
    run_id: String,
) -> Result<(), String> {
    let (handle, project_path) = with_run(&orchestrator, &run_id, |e| {
        Ok((e.handle.clone(), e.project_path.clone()))
    })
    .await?;
    handle
        .pause(&project_path, &make_sink(&app), &SystemClock)
        .await
        .map_err(|e| e.to_string())
}

/// Unpause a run that is live in memory. After an app restart (no live
/// driver), the frontend must instead call `pipeline_resume_run` to reload
/// the persisted run and start a fresh driver.
#[tauri::command]
pub async fn pipeline_resume(
    orchestrator: tauri::State<'_, Orchestrator>,
    app: tauri::AppHandle,
    run_id: String,
) -> Result<(), String> {
    let (handle, project_path) = with_run(&orchestrator, &run_id, |e| {
        Ok((e.handle.clone(), e.project_path.clone()))
    })
    .await?;
    handle
        .resume(&project_path, &make_sink(&app), &SystemClock)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pipeline_retry_step(
    orchestrator: tauri::State<'_, Orchestrator>,
    app: tauri::AppHandle,
    run_id: String,
    step_id: String,
) -> Result<(), String> {
    let (handle, project_path, driving) = {
        let guard = orchestrator.runs.lock().await;
        let entry = guard
            .get(&run_id)
            .ok_or_else(|| format!("run not found: {}", run_id))?;
        (entry.handle.clone(), entry.project_path.clone(), entry.driving.clone())
    };
    handle
        .retry_step(&project_path, &step_id, &make_sink(&app), &SystemClock)
        .await
        .map_err(|e| e.to_string())?;
    // Atomically claim the driver role. If a driver is already running
    // (incl. paused-and-waiting), it picks up the retried step via the notify
    // sent by retry_step. Otherwise the run was terminal and we start one.
    if driving
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        spawn_driver(orchestrator.pipeline.clone(), handle, driving, project_path, app);
    }
    Ok(())
}

#[tauri::command]
pub async fn pipeline_skip_step(
    orchestrator: tauri::State<'_, Orchestrator>,
    app: tauri::AppHandle,
    run_id: String,
    step_id: String,
) -> Result<(), String> {
    let (handle, project_path, driving) = {
        let guard = orchestrator.runs.lock().await;
        let entry = guard
            .get(&run_id)
            .ok_or_else(|| format!("run not found: {}", run_id))?;
        (entry.handle.clone(), entry.project_path.clone(), entry.driving.clone())
    };
    handle
        .skip_step(&project_path, &step_id, &make_sink(&app), &SystemClock)
        .await
        .map_err(|e| e.to_string())?;
    if driving
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        spawn_driver(orchestrator.pipeline.clone(), handle, driving, project_path, app);
    }
    Ok(())
}

#[tauri::command]
pub async fn pipeline_get_state(
    orchestrator: tauri::State<'_, Orchestrator>,
    run_id: String,
) -> Result<Option<RunState>, String> {
    let handle = with_run(&orchestrator, &run_id, |e| Ok(e.handle.clone())).await?;
    let state = handle.state().lock().await.clone();
    Ok(Some(state))
}

#[tauri::command]
pub async fn pipeline_resume_run(
    orchestrator: tauri::State<'_, Orchestrator>,
    app: tauri::AppHandle,
    project_path: String,
    run_id: String,
) -> Result<(), String> {
    // Crash-recovery entry point: load a persisted run from disk and drive
    // it. Refuse if the run is already in memory (use pipeline_resume to
    // unpause a live run) - otherwise two drivers would race on the same
    // logical run with divergent in-memory state copies.
    {
        let runs = orchestrator.runs.lock().await;
        if runs.contains_key(&run_id) {
            return Err(format!(
                "run {} is already in memory; use pipeline_resume to unpause it",
                run_id
            ));
        }
    }
    let project_path = PathBuf::from(project_path);
    let sink = make_sink(&app);
    let handle = orchestrator
        .pipeline
        .resume_run(&project_path, &run_id, &sink, &SystemClock)
        .map_err(|e| e.to_string())?;
    let driving = Arc::new(AtomicBool::new(false));
    orchestrator
        .runs
        .lock()
        .await
        .insert(
            run_id.clone(),
            ManagedRun {
                handle: handle.clone(),
                project_path: project_path.clone(),
                driving: driving.clone(),
            },
        );
    spawn_driver(orchestrator.pipeline.clone(), handle, driving, project_path, app);
    Ok(())
}

#[tauri::command]
pub async fn pipeline_get_plan(project_path: String) -> Result<Option<StoryPlan>, String> {
    story_plan::load_plan(&PathBuf::from(project_path)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_ids_are_unique() {
        let a = new_run_id();
        let b = new_run_id();
        assert_ne!(a, b);
        assert!(a.starts_with("run_"));
    }
}
