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
    let candidates = crate::json_store::read_candidates(&path)
        .map_err(|e| RunStoreError::ReadFailed(path.display().to_string(), e.to_string()))?;
    if candidates.is_empty() {
        return Ok(None);
    }
    let mut last_error = String::new();
    for text in candidates {
        match serde_json::from_str(&text) {
            Ok(state) => return Ok(Some(state)),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(RunStoreError::InvalidJson(last_error))
}

pub fn list_run_states(project_path: &Path) -> Result<Vec<RunState>, RunStoreError> {
    let dir = run_state_dir(project_path);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RunStoreError::ReadFailed(dir.display().to_string(), e.to_string()))?;
    let mut run_ids = std::collections::HashSet::new();
    for entry in entries {
        let entry = entry
            .map_err(|e| RunStoreError::ReadFailed(dir.display().to_string(), e.to_string()))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some(run_id) = name.strip_suffix(".json") {
            run_ids.insert(run_id.to_string());
        } else if let Some(run_id) = name.strip_suffix(".json.bak") {
            run_ids.insert(run_id.to_string());
        }
    }
    let mut runs = Vec::with_capacity(run_ids.len());
    for run_id in run_ids {
        if let Some(state) = load_run_state(project_path, &run_id)? {
            runs.push(state);
        }
    }
    runs.sort_by_key(|run: &RunState| std::cmp::Reverse(run.updated_at));
    Ok(runs)
}

pub fn save_run_state(project_path: &Path, state: &RunState) -> Result<(), RunStoreError> {
    let dir = run_state_dir(project_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| RunStoreError::WriteFailed(dir.display().to_string(), e.to_string()))?;
    let path = run_state_path(project_path, &state.run_id);
    let text = serde_json::to_string_pretty(state)
        .map_err(|e| RunStoreError::SerializeFailed(e.to_string()))?;
    crate::json_store::write_crash_safe(&path, text.as_bytes())
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

    #[test]
    fn lists_run_states_newest_first() {
        let project = fresh_dir("list");
        let mut older = sample_state("run_old");
        older.updated_at = 100;
        let mut newer = sample_state("run_new");
        newer.updated_at = 200;
        save_run_state(&project, &older).unwrap();
        save_run_state(&project, &newer).unwrap();

        let runs = list_run_states(&project).unwrap();
        assert_eq!(runs.iter().map(|run| run.run_id.as_str()).collect::<Vec<_>>(), vec![
            "run_new",
            "run_old",
        ]);
    }

    #[test]
    fn recovers_from_backup_when_primary_json_is_truncated() {
        let project = fresh_dir("backup_recovery");
        let state = sample_state("run_backup");
        save_run_state(&project, &state).unwrap();
        let path = run_state_path(&project, "run_backup");
        std::fs::copy(&path, crate::json_store::backup_path(&path)).unwrap();
        std::fs::write(&path, "{").unwrap();

        assert_eq!(load_run_state(&project, "run_backup").unwrap(), Some(state));
        assert_eq!(list_run_states(&project).unwrap().len(), 1);
    }

    #[test]
    fn saving_after_backup_recovery_keeps_a_valid_copy() {
        let project = fresh_dir("backup_resave");
        let mut state = sample_state("run_backup_resave");
        save_run_state(&project, &state).unwrap();
        let path = run_state_path(&project, "run_backup_resave");
        std::fs::rename(&path, crate::json_store::backup_path(&path)).unwrap();
        state.updated_at = 500;

        save_run_state(&project, &state).unwrap();

        assert_eq!(load_run_state(&project, "run_backup_resave").unwrap(), Some(state));
    }
}
