use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::story_plan::types::StoryPlan;

/// `.ollaic/plan.json` - the StoryPlan IR location for a project (ADR 0050).
pub fn plan_path(project_path: &Path) -> PathBuf {
    project_path.join(".ollaic").join("plan.json")
}

/// Load the project's StoryPlan. Returns `Ok(None)` when no plan exists yet.
pub fn load_plan(project_path: &Path) -> Result<Option<StoryPlan>, PlanError> {
    let path = plan_path(project_path);
    let candidates = crate::json_store::read_candidates(&path)
        .map_err(|e| PlanError::ReadFailed(path.display().to_string(), e.to_string()))?;
    if candidates.is_empty() {
        return Ok(None);
    }
    let mut last_error = String::new();
    for text in candidates {
        match serde_json::from_str(&text) {
            Ok(plan) => {
                validate(&plan)?;
                return Ok(Some(plan));
            }
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(PlanError::InvalidJson(last_error))
}

/// Validate and persist the plan to `.ollaic/plan.json`.
pub fn save_plan(project_path: &Path, plan: &StoryPlan) -> Result<(), PlanError> {
    validate(plan)?;
    let path = plan_path(project_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| PlanError::WriteFailed(parent.display().to_string(), e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(plan)
        .map_err(|e| PlanError::SerializeFailed(e.to_string()))?;
    crate::json_store::write_crash_safe(&path, text.as_bytes())
        .map_err(|e| PlanError::WriteFailed(path.display().to_string(), e.to_string()))?;
    Ok(())
}

pub fn remove_plan(project_path: &Path) -> Result<(), PlanError> {
    let path = plan_path(project_path);
    for candidate in [path.clone(), crate::json_store::backup_path(&path)] {
        if candidate.exists() {
            std::fs::remove_file(&candidate)
                .map_err(|e| PlanError::WriteFailed(candidate.display().to_string(), e.to_string()))?;
        }
    }
    Ok(())
}

/// Structural validation of a StoryPlan. See ADR 0054.
pub fn validate(plan: &StoryPlan) -> Result<(), PlanError> {
    if plan.version != 1 {
        return Err(PlanError::UnsupportedVersion(plan.version));
    }
    if plan.prompt.trim().is_empty() && plan.synopsis.trim().is_empty() {
        return Err(PlanError::EmptyPlan);
    }
    let mut seen: HashSet<&str> = HashSet::new();
    for chapter in &plan.chapters {
        if !seen.insert(chapter.id.as_str()) {
            return Err(PlanError::DuplicateChapterId(chapter.id.clone()));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
pub enum PlanError {
    UnsupportedVersion(u32),
    EmptyPlan,
    DuplicateChapterId(String),
    InvalidJson(String),
    ReadFailed(String, String),
    WriteFailed(String, String),
    SerializeFailed(String),
}

impl std::fmt::Display for PlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlanError::UnsupportedVersion(v) => {
                write!(f, "unsupported StoryPlan version: {} (expected 1)", v)
            }
            PlanError::EmptyPlan => write!(
                f,
                "StoryPlan has neither a prompt nor a synopsis"
            ),
            PlanError::DuplicateChapterId(id) => {
                write!(f, "duplicate chapter id in outline: {}", id)
            }
            PlanError::InvalidJson(e) => write!(f, "plan.json is not valid JSON: {}", e),
            PlanError::ReadFailed(p, e) => write!(f, "failed to read {}: {}", p, e),
            PlanError::WriteFailed(p, e) => write!(f, "failed to write {}: {}", p, e),
            PlanError::SerializeFailed(e) => {
                write!(f, "failed to serialize StoryPlan: {}", e)
            }
        }
    }
}

impl std::error::Error for PlanError {}
