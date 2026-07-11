use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::story_plan::types::StoryPlan;
use crate::webgal::parser;
use crate::webgal::types::CommandType;

use super::types::{AssetKind, AssetQueue, AssetTask, AssetTaskStatus};

pub fn queue_path(project_path: &Path) -> PathBuf {
    project_path.join(".ollaic/assets/queue.json")
}

pub fn load_queue(project_path: &Path) -> Result<AssetQueue, String> {
    let path = queue_path(project_path);
    let candidates = crate::json_store::read_candidates(&path)
        .map_err(|error| format!("failed to read asset queue {}: {error}", path.display()))?;
    if candidates.is_empty() {
        return Ok(AssetQueue::new("", Vec::new(), 0));
    }
    candidates
        .into_iter()
        .find_map(|source| serde_json::from_str(&source).ok())
        .ok_or_else(|| format!("failed to parse asset queue {}", path.display()))
}

pub fn save_queue(project_path: &Path, queue: &AssetQueue) -> Result<(), String> {
    let path = queue_path(project_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create asset queue directory: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(queue).map_err(|error| error.to_string())?;
    crate::json_store::write_crash_safe(&path, &bytes)
        .map_err(|error| format!("failed to write asset queue {}: {error}", path.display()))
}

/// Build executable tasks from the planner output and the compiled scene files.
/// TTS is derived from the playable scripts, so its dialogue indexes match binding.
pub fn derive_queue(
    project_path: &Path,
    run_id: &str,
    plan: &StoryPlan,
) -> Result<AssetQueue, String> {
    let scene_files = &plan.scenes;
    let scene_files_by_ref: HashMap<&str, &str> = plan
        .scene_plans
        .iter()
        .map(|scene| (scene.id.as_str(), scene.file.as_str()))
        .collect();
    let entry_scene = scene_files_by_ref
        .get(plan.branches.entry_scene.as_str())
        .copied();
    let voice_timbres: HashMap<&str, &str> = plan
        .characters
        .iter()
        .filter_map(|character| {
            character
                .voice_timbre
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|voice| {
                    [
                        (character.id.as_str(), voice),
                        (character.name.as_str(), voice),
                    ]
                })
        })
        .flatten()
        .collect();
    let mut ids = HashSet::new();
    let mut tasks = Vec::new();
    for task_plan in &plan.asset_plan {
        let kind = AssetKind::from_plan(&task_plan.kind)
            .ok_or_else(|| format!("unsupported asset kind: {}", task_plan.kind))?;
        if !ids.insert(task_plan.id.clone()) {
            return Err(format!("duplicate asset task id: {}", task_plan.id));
        }
        tasks.push(AssetTask {
            id: task_plan.id.clone(),
            kind,
            target_stem: task_plan.target_stem.clone(),
            prompt: task_plan.prompt.clone(),
            scene_ref: task_plan
                .scene_ref
                .as_deref()
                .and_then(|scene| scene_files_by_ref.get(scene).copied().or(Some(scene)))
                .or_else(|| {
                    matches!(kind, AssetKind::Bgm | AssetKind::Sfx)
                        .then_some(entry_scene)
                        .flatten()
                })
                .map(str::to_string),
            character_ref: task_plan.character_ref.clone(),
            dialogue_index: None,
            text: None,
            status: AssetTaskStatus::Pending,
            attempts: Vec::new(),
            asset_file: None,
            error: None,
        });
    }

    for (scene_number, scene_file) in scene_files.iter().enumerate() {
        validate_scene_file(scene_file)?;
        let scene_token = safe_token(scene_file.trim_end_matches(".txt"), scene_number);
        let path = project_path.join("game/scene").join(scene_file);
        let source = fs::read_to_string(&path)
            .map_err(|error| format!("failed to read scene {}: {error}", path.display()))?;
        let mut dialogue_index = 0usize;
        for node in parser::parse_script(&source) {
            if !matches!(node.cmd_type, CommandType::Dialogue | CommandType::Narrator)
                || node.content.trim().is_empty()
            {
                continue;
            }
            let this_index = dialogue_index;
            dialogue_index += 1;
            if node.voice.is_some() {
                continue;
            }
            let id = format!("tts_{scene_token}_{this_index}");
            if ids.insert(id.clone()) {
                let character = node.character.clone();
                let prompt = character
                    .as_deref()
                    .and_then(|name| voice_timbres.get(name).copied())
                    .map(str::to_string)
                    .or_else(|| character.clone())
                    .unwrap_or_else(|| "narrator".to_string());
                tasks.push(AssetTask {
                    id,
                    kind: AssetKind::Tts,
                    target_stem: format!("vo_{scene_token}_{this_index}"),
                    prompt,
                    scene_ref: Some(scene_file.clone()),
                    character_ref: character,
                    dialogue_index: Some(this_index),
                    text: Some(node.content),
                    status: AssetTaskStatus::Pending,
                    attempts: Vec::new(),
                    asset_file: None,
                    error: None,
                });
            }
        }
    }
    Ok(AssetQueue::new(run_id, tasks, now_ms()))
}

fn safe_token(value: &str, fallback: usize) -> String {
    let token: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if token.chars().any(|ch| ch.is_ascii_alphanumeric()) {
        token
    } else {
        format!("scene_{fallback}")
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn validate_scene_file(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.components().count() != 1
        || path.extension().and_then(|extension| extension.to_str()) != Some("txt")
    {
        return Err(format!("invalid scene file: {value}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("ollaic_asset_queue_{name}_{nonce}"));
        fs::create_dir_all(path.join("game/scene")).unwrap();
        path
    }

    #[test]
    fn derives_tts_from_compiled_dialogue_and_round_trips_queue() {
        let project = temp_project("derive");
        fs::write(
            project.join("game/scene/start.txt"),
            "Alice:Hello;\n:Narration;\nBob:Already voiced -old.wav;\n",
        )
        .unwrap();
        let plan = StoryPlan {
            scenes: vec!["start.txt".into()],
            ..StoryPlan::new("test")
        };
        let queue = derive_queue(&project, "run-1", &plan).unwrap();
        assert_eq!(queue.tasks.len(), 2);
        assert_eq!(queue.tasks[0].dialogue_index, Some(0));
        assert_eq!(queue.tasks[1].dialogue_index, Some(1));
        assert_eq!(queue.limits.tts, 4);
        assert_eq!(queue.run_id, "run-1");
        save_queue(&project, &queue).unwrap();
        assert_eq!(load_queue(&project).unwrap(), queue);
        let _ = fs::remove_dir_all(project);
    }

    #[test]
    fn maps_scene_ids_and_uses_character_voice_timbre() {
        let project = temp_project("mapping");
        fs::write(project.join("game/scene/start.txt"), "Alice:Hello;\n").unwrap();
        let plan: StoryPlan = serde_json::from_value(serde_json::json!({
            "version": 1,
            "prompt": "test",
            "scenePlans": [{
                "id": "opening", "file": "start.txt", "chapterId": "ch1", "title": "Opening"
            }],
            "branches": { "entryScene": "opening", "edges": [] },
            "characters": [{
                "id": "alice", "name": "Alice", "voiceTimbre": "voice-42"
            }],
            "assetPlan": [{
                "id": "bg_opening", "kind": "background", "targetStem": "bg_opening",
                "prompt": "room", "sceneRef": "opening", "status": "pending"
            }, {
                "id": "bgm_main", "kind": "bgm", "targetStem": "bgm_main",
                "prompt": "theme", "status": "pending"
            }],
            "scenes": ["start.txt"]
        }))
        .unwrap();
        let queue = derive_queue(&project, "run-2", &plan).unwrap();
        assert_eq!(queue.tasks[0].scene_ref.as_deref(), Some("start.txt"));
        assert_eq!(queue.tasks[1].scene_ref.as_deref(), Some("start.txt"));
        assert_eq!(queue.tasks[2].prompt, "voice-42");
        let _ = fs::remove_dir_all(project);
    }
}
