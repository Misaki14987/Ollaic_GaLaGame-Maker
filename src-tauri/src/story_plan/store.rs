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
            std::fs::remove_file(&candidate).map_err(|e| {
                PlanError::WriteFailed(candidate.display().to_string(), e.to_string())
            })?;
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
    let chapter_ids: HashSet<&str> = plan
        .chapters
        .iter()
        .map(|chapter| chapter.id.as_str())
        .collect();
    let mut scene_ids: HashSet<&str> = HashSet::new();
    let mut scene_files: HashSet<&str> = HashSet::new();
    for scene in &plan.scene_plans {
        if !scene_ids.insert(scene.id.as_str()) {
            return Err(PlanError::DuplicateSceneId(scene.id.clone()));
        }
        if !scene_files.insert(scene.file.as_str()) {
            return Err(PlanError::DuplicateSceneFile(scene.file.clone()));
        }
        if !chapter_ids.contains(scene.chapter_id.as_str()) {
            return Err(PlanError::UnknownChapter(
                scene.id.clone(),
                scene.chapter_id.clone(),
            ));
        }
        if !is_safe_scene_file(&scene.file) {
            return Err(PlanError::InvalidSceneFile(scene.file.clone()));
        }
    }
    if !scene_ids.is_empty() && plan.branches.entry_scene.is_empty() {
        return Err(PlanError::InvalidReference(
            "branch graph has no entry scene".to_string(),
        ));
    }
    if !plan.branches.entry_scene.is_empty()
        && !scene_ids.contains(plan.branches.entry_scene.as_str())
    {
        return Err(PlanError::UnknownBranchScene(
            plan.branches.entry_scene.clone(),
        ));
    }
    for edge in &plan.branches.edges {
        for id in [&edge.from, &edge.to] {
            if !scene_ids.contains(id.as_str()) {
                return Err(PlanError::UnknownBranchScene(id.clone()));
            }
        }
    }
    let mut character_ids: HashSet<&str> = HashSet::new();
    for character in &plan.characters {
        if character.id.trim().is_empty() || !character_ids.insert(character.id.as_str()) {
            return Err(PlanError::InvalidReference(format!(
                "invalid or duplicate character id: {}",
                character.id
            )));
        }
    }
    if !character_ids.is_empty() {
        for scene in &plan.scene_plans {
            for character in &scene.character_ids {
                if !character_ids.contains(character.as_str()) {
                    return Err(PlanError::InvalidReference(format!(
                        "scene {} references unknown character: {}",
                        scene.id, character
                    )));
                }
            }
        }
    }
    let mut draft_ids: HashSet<&str> = HashSet::new();
    for draft in &plan.scene_drafts {
        if !scene_ids.contains(draft.scene_id.as_str())
            || !draft_ids.insert(draft.scene_id.as_str())
        {
            return Err(PlanError::InvalidReference(format!(
                "invalid or duplicate scene draft: {}",
                draft.scene_id
            )));
        }
        if draft.beats.is_empty() || draft.beats.iter().any(|beat| beat.text.trim().is_empty()) {
            return Err(PlanError::InvalidReference(format!(
                "scene draft {} has empty dialogue",
                draft.scene_id
            )));
        }
        let scene_cast: HashSet<&str> = plan
            .scene_plans
            .iter()
            .find(|scene| scene.id == draft.scene_id)
            .map(|scene| scene.character_ids.iter().map(String::as_str).collect())
            .unwrap_or_default();
        for cue in draft.beats.iter().flat_map(|beat| &beat.figure_cues) {
            if !character_ids.contains(cue.character_id.as_str())
                || !scene_cast.contains(cue.character_id.as_str())
                || !crate::story_plan::types::is_webgal_flag_value(&cue.character_id)
                || (cue.action == crate::story_plan::FigureCueAction::Show
                    && (cue.position.is_none()
                        || !crate::story_plan::types::is_webgal_flag_value(&cue.emotion)))
            {
                return Err(PlanError::InvalidReference(format!(
                    "invalid figure cue in scene {} for character {}",
                    draft.scene_id, cue.character_id
                )));
            }
        }
    }
    let mut asset_ids: HashSet<&str> = HashSet::new();
    for asset in &plan.asset_plan {
        if asset.id.trim().is_empty() || !asset_ids.insert(asset.id.as_str()) {
            return Err(PlanError::InvalidReference(format!(
                "invalid or duplicate asset task id: {}",
                asset.id
            )));
        }
        if !matches!(asset.kind.as_str(), "background" | "figure" | "bgm" | "sfx")
            || asset.status != "pending"
            || asset.target_stem.is_empty()
            || !asset
                .target_stem
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
        {
            return Err(PlanError::InvalidReference(format!(
                "invalid asset task: {}",
                asset.id
            )));
        }
        if (asset.kind == "figure"
            && (asset.character_ref.as_deref().is_none_or(str::is_empty)
                || asset
                    .emotion
                    .as_deref()
                    .is_some_and(|value| !crate::story_plan::types::is_webgal_flag_value(value))))
            || (asset.kind != "figure" && asset.emotion.is_some())
        {
            return Err(PlanError::InvalidReference(format!(
                "invalid figure variant task: {}",
                asset.id
            )));
        }
        if let Some(scene) = &asset.scene_ref {
            if !scene_ids.contains(scene.as_str()) {
                return Err(PlanError::InvalidReference(format!(
                    "asset {} references unknown scene: {}",
                    asset.id, scene
                )));
            }
        }
        if let Some(character) = &asset.character_ref {
            if !character_ids.contains(character.as_str()) {
                return Err(PlanError::InvalidReference(format!(
                    "asset {} references unknown character: {}",
                    asset.id, character
                )));
            }
        }
    }
    for file in &plan.scenes {
        if !is_safe_scene_file(file) {
            return Err(PlanError::InvalidSceneFile(file.clone()));
        }
        if !scene_files.is_empty() && !scene_files.contains(file.as_str()) {
            return Err(PlanError::InvalidReference(format!(
                "compiled scene has no scene plan: {}",
                file
            )));
        }
    }
    Ok(())
}

fn is_safe_scene_file(file: &str) -> bool {
    let stem = file.strip_suffix(".txt").unwrap_or("");
    !stem.is_empty()
        && stem
            .chars()
            .all(|ch| ch.is_alphanumeric() || ch == '_' || ch == '-')
        && std::path::Path::new(file)
            .file_name()
            .and_then(|name| name.to_str())
            == Some(file)
}

#[derive(Debug, Clone, PartialEq)]
pub enum PlanError {
    UnsupportedVersion(u32),
    EmptyPlan,
    DuplicateChapterId(String),
    DuplicateSceneId(String),
    DuplicateSceneFile(String),
    UnknownChapter(String, String),
    UnknownBranchScene(String),
    InvalidSceneFile(String),
    InvalidReference(String),
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
            PlanError::EmptyPlan => write!(f, "StoryPlan has neither a prompt nor a synopsis"),
            PlanError::DuplicateChapterId(id) => {
                write!(f, "duplicate chapter id in outline: {}", id)
            }
            PlanError::DuplicateSceneId(id) => write!(f, "duplicate scene id: {}", id),
            PlanError::DuplicateSceneFile(file) => write!(f, "duplicate scene file: {}", file),
            PlanError::UnknownChapter(scene, chapter) => {
                write!(f, "scene {} references unknown chapter: {}", scene, chapter)
            }
            PlanError::UnknownBranchScene(scene) => {
                write!(f, "branch references unknown scene: {}", scene)
            }
            PlanError::InvalidSceneFile(file) => write!(f, "invalid scene file name: {}", file),
            PlanError::InvalidReference(message) => {
                write!(f, "invalid StoryPlan reference: {}", message)
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
