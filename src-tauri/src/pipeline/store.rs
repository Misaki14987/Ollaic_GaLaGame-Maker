//! Persistence of pipeline run state to `.ollaic/pipeline/<run_id>.json`
//! (ADR 0054). Written after every step transition so a crashed run can be
//! resumed without redoing completed steps.

use std::path::{Path, PathBuf};

use crate::pipeline::state::RunState;

pub fn run_state_dir(project_path: &Path) -> PathBuf {
    project_path.join(".ollaic").join("pipeline")
}

pub fn run_state_path(project_path: &Path, run_id: &str) -> PathBuf {
    run_state_dir(project_path).join(format!("{}.json", run_id))
}

pub fn load_run_state(project_path: &Path, run_id: &str) -> Result<Option<RunState>, RunStoreError> {
    let path = run_state_path(project_path, run_id);
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| RunStoreError::ReadFailed(path.display().to_string(), e.to_string()))?;
    let state: RunState = serde_json::from_str(&text)
        .map_err(|e| RunStoreError::InvalidJson(e.to_string()))?;
    Ok(Some(state))
}

pub fn save_run_state(project_path: &Path, state: &RunState) -> Result<(), RunStoreError> {
    let dir = run_state_dir(project_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| RunStoreError::WriteFailed(dir.display().to_string(), e.to_string()))?;
    let path = run_state_path(project_path, &state.run_id);
    let text = serde_json::to_string_pretty(state)
        .map_err(|e| RunStoreError::SerializeFailed(e.to_string()))?;
    std::fs::write(&path, text)
        .map_err(|e| RunStoreError::WriteFailed(path.display().to_string(), e.to_string()))?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
pub enum RunStoreError {
    InvalidJson(String),
    ReadFailed(String, String),
    WriteFailed(String, String),
    SerializeFailed(String),
}

impl std::fmt::Display for RunStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunStoreError::InvalidJson(e) => write!(f, "run state is not valid JSON: {}", e),
            RunStoreError::ReadFailed(p, e) => write!(f, "failed to read {}: {}", p, e),
            RunStoreError::WriteFailed(p, e) => write!(f, "failed to write {}: {}", p, e),
            RunStoreError::SerializeFailed(e) => {
                write!(f, "failed to serialize run state: {}", e)
            }
        }
    }
}

impl std::error::Error for RunStoreError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::dsl::{FlowRecipe, StepDef, StepKind};

    fn sample_state(run_id: &str) -> RunState {
        let recipe = FlowRecipe::new()
            .step(StepDef::new("a", StepKind::Plan))
            .step(StepDef::new("b", StepKind::Outline).depends_on("a"));
        let mut state = RunState::new(run_id, ".", "a brief", &recipe, 100);
        state.find_step_mut("a").unwrap().status =
            crate::pipeline::state::StepStatus::Succeeded;
        state
    }

    fn fresh_dir(name: &str) -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join(format!("ollaic_pipeline_store_{}", name));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        tmp
    }

    #[test]
    fn run_state_round_trips_through_disk() {
        let project = fresh_dir("round_trip");
        let state = sample_state("run_42");
        save_run_state(&project, &state).unwrap();
        let loaded = load_run_state(&project, "run_42")
            .unwrap()
            .expect("run state should exist");
        assert_eq!(loaded, state);
        assert!(run_state_path(&project, "run_42").is_file());
    }

    #[test]
    fn load_returns_none_when_absent() {
        let project = fresh_dir("absent");
        assert!(load_run_state(&project, "nope").unwrap().is_none());
    }

    #[test]
    fn persists_after_partial_progress() {
        // Simulate per-step persistence: save once after `a` succeeds.
        let project = fresh_dir("partial");
        let state = sample_state("run_99");
        save_run_state(&project, &state).unwrap();
        // A fresh load reflects that `a` is done and `b` is still pending.
        let loaded = load_run_state(&project, "run_99").unwrap().unwrap();
        assert_eq!(
            loaded.find_step("a").unwrap().status,
            crate::pipeline::state::StepStatus::Succeeded
        );
        assert_eq!(
            loaded.find_step("b").unwrap().status,
            crate::pipeline::state::StepStatus::Pending
        );
    }
}
