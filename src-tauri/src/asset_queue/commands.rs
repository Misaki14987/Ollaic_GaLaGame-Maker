use std::path::Path;

use base64::Engine;

use super::binder::bind_asset;
use super::store::save_queue;
use super::{load_queue, queue_path, AssetQueue, AssetTaskStatus};

#[tauri::command]
pub fn asset_queue_get(project_path: String) -> Result<Option<AssetQueue>, String> {
    let project = Path::new(&project_path);
    if !queue_path(project).is_file() {
        return Ok(None);
    }
    load_queue(project).map(Some)
}

#[tauri::command]
pub fn asset_queue_preview_artifact(
    project_path: String,
    task_id: String,
    attempt: u32,
) -> Result<String, String> {
    let project = Path::new(&project_path);
    let queue = load_queue(project)?;
    let artifact = resolve_artifact(project, &queue, &task_id, attempt)?;
    let bytes = std::fs::read(&artifact)
        .map_err(|error| format!("failed to read artifact {}: {error}", artifact.display()))?;
    let mime = mime_guess::from_path(&artifact).first_or_octet_stream();
    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub fn asset_queue_delete_artifact(
    project_path: String,
    task_id: String,
    attempt: u32,
) -> Result<AssetQueue, String> {
    let project = Path::new(&project_path);
    let mut queue = load_queue(project)?;
    let artifact = resolve_artifact(project, &queue, &task_id, attempt)?;
    std::fs::remove_file(&artifact)
        .map_err(|error| format!("failed to delete artifact {}: {error}", artifact.display()))?;
    let record = queue
        .tasks
        .iter_mut()
        .find(|task| task.id == task_id)
        .and_then(|task| {
            task.attempts
                .iter_mut()
                .find(|item| item.attempt == attempt)
        })
        .ok_or_else(|| format!("asset attempt not found: {task_id}/{attempt}"))?;
    record.artifact = None;
    queue.updated_at = now_ms();
    save_queue(project, &queue)?;
    Ok(queue)
}

#[tauri::command]
pub fn asset_queue_promote_artifact(
    project_path: String,
    task_id: String,
    attempt: u32,
) -> Result<AssetQueue, String> {
    let project = Path::new(&project_path);
    let mut queue = load_queue(project)?;
    let task_index = queue
        .tasks
        .iter()
        .position(|task| task.id == task_id)
        .ok_or_else(|| format!("asset task not found: {task_id}"))?;
    let selected = queue.tasks[task_index]
        .attempts
        .iter()
        .find(|item| item.attempt == attempt && item.artifact.is_some())
        .cloned()
        .ok_or_else(|| format!("asset artifact not found: {task_id}/{attempt}"))?;
    resolve_artifact(project, &queue, &task_id, attempt)?;
    let mut candidate = queue.tasks[task_index].clone();
    candidate.attempts = vec![selected];
    let filename = bind_asset(project, &candidate)?;
    queue.tasks[task_index].status = AssetTaskStatus::Succeeded;
    queue.tasks[task_index].asset_file = Some(filename);
    queue.tasks[task_index].error = None;
    queue.updated_at = now_ms();
    save_queue(project, &queue)?;
    Ok(queue)
}

fn resolve_artifact(
    project: &Path,
    queue: &AssetQueue,
    task_id: &str,
    attempt: u32,
) -> Result<std::path::PathBuf, String> {
    if task_id.is_empty()
        || !task_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(format!("invalid asset task id: {task_id}"));
    }
    let artifact = queue
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .and_then(|task| task.attempts.iter().find(|item| item.attempt == attempt))
        .and_then(|item| item.artifact.as_deref())
        .ok_or_else(|| format!("asset artifact not found: {task_id}/{attempt}"))?;
    let root = project
        .join(".ollaic/artifacts/assets")
        .canonicalize()
        .map_err(|error| format!("failed to resolve artifact root: {error}"))?;
    let artifact = Path::new(artifact)
        .canonicalize()
        .map_err(|error| format!("failed to resolve artifact: {error}"))?;
    if !artifact.starts_with(root.join(task_id)) || !artifact.is_file() {
        return Err("artifact is outside the project task directory".to_string());
    }
    Ok(artifact)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asset_queue::types::{AssetAttempt, AssetKind, AssetTask};

    #[test]
    fn artifact_can_be_previewed_promoted_and_deleted() {
        let project =
            std::env::temp_dir().join(format!("ollaic_artifact_commands_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&project);
        std::fs::create_dir_all(project.join("game/scene")).unwrap();
        std::fs::write(project.join("game/scene/start.txt"), ":hello;\n").unwrap();
        let artifact = project.join(".ollaic/artifacts/assets/bg_start/1.png");
        std::fs::create_dir_all(artifact.parent().unwrap()).unwrap();
        std::fs::write(&artifact, b"png").unwrap();
        let queue = AssetQueue::new(
            "run-1",
            vec![AssetTask {
                id: "bg_start".into(),
                kind: AssetKind::Background,
                target_stem: "bg_start".into(),
                prompt: "background".into(),
                scene_ref: Some("start.txt".into()),
                character_ref: None,
                dialogue_index: None,
                text: None,
                status: AssetTaskStatus::Failed,
                attempts: vec![AssetAttempt {
                    attempt: 1,
                    started_at: 1,
                    finished_at: 2,
                    artifact: Some(artifact.to_string_lossy().into_owned()),
                    error: None,
                }],
                asset_file: None,
                error: Some("review rejected".into()),
            }],
            2,
        );
        save_queue(&project, &queue).unwrap();
        let project_string = project.to_string_lossy().into_owned();

        assert!(
            asset_queue_preview_artifact(project_string.clone(), "bg_start".into(), 1)
                .unwrap()
                .starts_with("data:image/png;base64,")
        );
        let promoted =
            asset_queue_promote_artifact(project_string.clone(), "bg_start".into(), 1).unwrap();
        assert_eq!(promoted.tasks[0].status, AssetTaskStatus::Succeeded);
        assert!(
            std::fs::read_to_string(project.join("game/scene/start.txt"))
                .unwrap()
                .contains("changeBg:bg_start.png;")
        );
        let cleaned = asset_queue_delete_artifact(project_string, "bg_start".into(), 1).unwrap();
        assert!(cleaned.tasks[0].attempts[0].artifact.is_none());
        assert!(!artifact.exists());
        let _ = std::fs::remove_dir_all(project);
    }
}
