use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::stream::{FuturesUnordered, StreamExt};
use tokio::sync::{Mutex, Semaphore};

use super::binder::bind_asset;
use super::store::{load_queue, save_queue};
use super::types::{AssetAttempt, AssetKind, AssetQueue, AssetTask, AssetTaskStatus};
use crate::story_plan::types::StoryPlan;

pub const ASSET_QUEUE_CANCELLED: &str = "asset queue cancelled";

pub struct GeneratedArtifact {
    pub extension: String,
    pub bytes: Vec<u8>,
}

pub trait AssetGenerator: Send + Sync {
    fn generate<'a>(
        &'a self,
        task: &'a AssetTask,
    ) -> Pin<Box<dyn Future<Output = Result<GeneratedArtifact, String>> + Send + 'a>>;
}

/// Generate all runnable tasks with per-capability limits, then bind successful
/// artifacts serially so scene and metadata rewrites cannot lose each other.
pub async fn run_queue(
    project_path: &Path,
    run_id: &str,
    plan: &StoryPlan,
    generator: Arc<dyn AssetGenerator>,
) -> Result<AssetQueue, String> {
    let mut queue = load_queue(project_path)?;
    let same_run = queue.run_id == run_id;
    if !same_run {
        queue = super::store::derive_queue(project_path, run_id, plan)?;
    }
    validate_limits(&queue)?;
    let attempt_budget = queue.limits.max_retries + 1;
    let runnable: Vec<(usize, u32)> = queue
        .tasks
        .iter_mut()
        .enumerate()
        .filter_map(|(index, task)| {
            if task.status == AssetTaskStatus::Succeeded {
                return None;
            }
            let limit = if same_run && task.status == AssetTaskStatus::Failed {
                task.attempts.len() as u32 + attempt_budget
            } else {
                attempt_budget
            };
            task.status = AssetTaskStatus::Pending;
            task.error = None;
            Some((index, limit))
        })
        .collect();
    queue.updated_at = now_ms();
    save_queue(project_path, &queue)?;
    let queue = Arc::new(Mutex::new(queue));
    let image = Arc::new(Semaphore::new(queue.lock().await.limits.image));
    let tts = Arc::new(Semaphore::new(queue.lock().await.limits.tts));
    let music = Arc::new(Semaphore::new(queue.lock().await.limits.music));
    let project_path = project_path.to_path_buf();
    let mut futures = FuturesUnordered::new();

    for (index, attempt_limit) in runnable {
        let queue = queue.clone();
        let generator = generator.clone();
        let project_path = project_path.clone();
        let semaphore = {
            let task = queue.lock().await.tasks[index].clone();
            match task.kind {
                AssetKind::Background | AssetKind::Figure => image.clone(),
                AssetKind::Tts => tts.clone(),
                AssetKind::Bgm | AssetKind::Sfx => music.clone(),
            }
        };
        futures.push(async move {
            let _permit = semaphore
                .acquire_owned()
                .await
                .map_err(|_| "asset semaphore closed".to_string())?;
            generate_task(
                &project_path,
                &queue,
                index,
                attempt_limit,
                generator.as_ref(),
            )
            .await
        });
    }

    let mut generated = Vec::new();
    while let Some(result) = futures.next().await {
        if let Some(index) = result? {
            generated.push(index);
        }
    }
    generated.sort_unstable();

    for index in generated {
        let task = queue.lock().await.tasks[index].clone();
        let result = bind_asset(&project_path, &task);
        let mut state = queue.lock().await;
        let task = &mut state.tasks[index];
        match result {
            Ok(filename) => {
                task.status = AssetTaskStatus::Succeeded;
                task.asset_file = Some(filename);
                task.error = None;
            }
            Err(error) => {
                task.status = AssetTaskStatus::Failed;
                task.error = Some(format!("binding failed: {error}"));
            }
        }
        state.updated_at = now_ms();
        save_queue(&project_path, &state)?;
    }
    let result = queue.lock().await.clone();
    Ok(result)
}

async fn generate_task(
    project_path: &Path,
    queue: &Mutex<AssetQueue>,
    index: usize,
    attempt_limit: u32,
    generator: &dyn AssetGenerator,
) -> Result<Option<usize>, String> {
    loop {
        let (task, attempt) = {
            let mut state = queue.lock().await;
            let task = &mut state.tasks[index];
            let attempt = task.attempts.len() as u32 + 1;
            if attempt > attempt_limit {
                task.status = AssetTaskStatus::Failed;
                task.error
                    .get_or_insert_with(|| "retry limit reached".to_string());
                state.updated_at = now_ms();
                save_queue(project_path, &state)?;
                return Ok(None);
            }
            task.status = if attempt == 1 {
                AssetTaskStatus::Running
            } else {
                AssetTaskStatus::Retrying
            };
            task.error = None;
            let snapshot = task.clone();
            state.updated_at = now_ms();
            save_queue(project_path, &state)?;
            (snapshot, attempt)
        };
        let started_at = now_ms();
        let generated = generator
            .generate(&task)
            .await
            .and_then(|generated| write_artifact(project_path, &task, attempt, generated));
        match generated {
            Ok(artifact) => {
                let mut state = queue.lock().await;
                state.tasks[index].attempts.push(AssetAttempt {
                    attempt,
                    started_at,
                    finished_at: now_ms(),
                    artifact: Some(artifact.to_string_lossy().into_owned()),
                    error: None,
                });
                state.updated_at = now_ms();
                save_queue(project_path, &state)?;
                return Ok(Some(index));
            }
            Err(error) => {
                if error == ASSET_QUEUE_CANCELLED {
                    return Err(error);
                }
                let mut state = queue.lock().await;
                let task = &mut state.tasks[index];
                task.attempts.push(AssetAttempt {
                    attempt,
                    started_at,
                    finished_at: now_ms(),
                    artifact: None,
                    error: Some(error.clone()),
                });
                task.error = Some(error);
                task.status = if attempt < attempt_limit {
                    AssetTaskStatus::Retrying
                } else {
                    AssetTaskStatus::Failed
                };
                state.updated_at = now_ms();
                save_queue(project_path, &state)?;
                if attempt >= attempt_limit {
                    return Ok(None);
                }
            }
        }
    }
}

fn write_artifact(
    project_path: &Path,
    task: &AssetTask,
    attempt: u32,
    generated: GeneratedArtifact,
) -> Result<std::path::PathBuf, String> {
    validate_extension(&generated.extension)?;
    validate_component(&task.id)?;
    let artifact = project_path
        .join(".ollaic/artifacts/assets")
        .join(&task.id)
        .join(format!("{attempt}.{}", generated.extension));
    if let Some(parent) = artifact.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create artifact directory {}: {error}",
                parent.display()
            )
        })?;
    }
    crate::json_store::write_crash_safe(&artifact, &generated.bytes)
        .map_err(|error| format!("failed to write artifact {}: {error}", artifact.display()))?;
    Ok(artifact)
}

fn validate_limits(queue: &AssetQueue) -> Result<(), String> {
    if queue.limits.image == 0 || queue.limits.tts == 0 || queue.limits.music == 0 {
        return Err("asset queue concurrency limits must be greater than zero".to_string());
    }
    Ok(())
}

fn validate_component(value: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(format!("invalid asset task id: {value}"));
    }
    Ok(())
}

fn validate_extension(value: &str) -> Result<(), String> {
    if value.is_empty() || !value.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return Err(format!("invalid generated artifact extension: {value}"));
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    struct RetryOnce(AtomicUsize);
    struct AlwaysGenerate;
    struct AlwaysFail(AtomicUsize);
    struct FailFourThenSucceed(AtomicUsize);
    struct ConcurrencyProbe {
        current: [AtomicUsize; 3],
        maximum: [AtomicUsize; 3],
    }

    impl AssetGenerator for RetryOnce {
        fn generate<'a>(
            &'a self,
            _task: &'a AssetTask,
        ) -> Pin<Box<dyn Future<Output = Result<GeneratedArtifact, String>> + Send + 'a>> {
            Box::pin(async move {
                if self.0.fetch_add(1, Ordering::SeqCst) == 0 {
                    Err("transient".to_string())
                } else {
                    Ok(GeneratedArtifact {
                        extension: "png".to_string(),
                        bytes: b"image".to_vec(),
                    })
                }
            })
        }
    }

    impl AssetGenerator for AlwaysGenerate {
        fn generate<'a>(
            &'a self,
            _task: &'a AssetTask,
        ) -> Pin<Box<dyn Future<Output = Result<GeneratedArtifact, String>> + Send + 'a>> {
            Box::pin(async {
                Ok(GeneratedArtifact {
                    extension: "wav".to_string(),
                    bytes: b"audio".to_vec(),
                })
            })
        }
    }

    impl AssetGenerator for AlwaysFail {
        fn generate<'a>(
            &'a self,
            _task: &'a AssetTask,
        ) -> Pin<Box<dyn Future<Output = Result<GeneratedArtifact, String>> + Send + 'a>> {
            Box::pin(async move {
                self.0.fetch_add(1, Ordering::SeqCst);
                Err("nope".to_string())
            })
        }
    }

    impl AssetGenerator for FailFourThenSucceed {
        fn generate<'a>(
            &'a self,
            _task: &'a AssetTask,
        ) -> Pin<Box<dyn Future<Output = Result<GeneratedArtifact, String>> + Send + 'a>> {
            Box::pin(async move {
                if self.0.fetch_add(1, Ordering::SeqCst) < 4 {
                    Err("nope".to_string())
                } else {
                    Ok(GeneratedArtifact {
                        extension: "png".to_string(),
                        bytes: b"image".to_vec(),
                    })
                }
            })
        }
    }

    impl ConcurrencyProbe {
        fn new() -> Self {
            Self {
                current: std::array::from_fn(|_| AtomicUsize::new(0)),
                maximum: std::array::from_fn(|_| AtomicUsize::new(0)),
            }
        }

        fn class(kind: AssetKind) -> usize {
            match kind {
                AssetKind::Background | AssetKind::Figure => 0,
                AssetKind::Tts => 1,
                AssetKind::Bgm | AssetKind::Sfx => 2,
            }
        }
    }

    impl AssetGenerator for ConcurrencyProbe {
        fn generate<'a>(
            &'a self,
            task: &'a AssetTask,
        ) -> Pin<Box<dyn Future<Output = Result<GeneratedArtifact, String>> + Send + 'a>> {
            Box::pin(async move {
                let class = Self::class(task.kind);
                let current = self.current[class].fetch_add(1, Ordering::SeqCst) + 1;
                self.maximum[class].fetch_max(current, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(10)).await;
                self.current[class].fetch_sub(1, Ordering::SeqCst);
                Ok(GeneratedArtifact {
                    extension: if class == 0 { "png" } else { "wav" }.to_string(),
                    bytes: vec![class as u8],
                })
            })
        }
    }

    fn task(id: String, kind: AssetKind, index: Option<usize>) -> AssetTask {
        AssetTask {
            target_stem: id.clone(),
            prompt: "test".to_string(),
            scene_ref: Some("start.txt".to_string()),
            character_ref: None,
            dialogue_index: index,
            text: index.map(|value| format!("line {value}")),
            id,
            kind,
            status: AssetTaskStatus::Pending,
            attempts: Vec::new(),
            asset_file: None,
            error: None,
        }
    }

    #[tokio::test]
    async fn retries_generation_then_binds_serially() {
        let project = std::env::temp_dir().join(format!("ollaic_queue_run_{}", now_ms()));
        std::fs::create_dir_all(project.join("game/scene")).unwrap();
        std::fs::write(project.join("game/scene/start.txt"), ":hello;\n").unwrap();
        let queue = AssetQueue::new(
            "run-1",
            vec![AssetTask {
                id: "bg_start".to_string(),
                kind: AssetKind::Background,
                target_stem: "bg_start".to_string(),
                prompt: "background".to_string(),
                scene_ref: Some("start.txt".to_string()),
                character_ref: None,
                dialogue_index: None,
                text: None,
                status: AssetTaskStatus::Pending,
                attempts: Vec::new(),
                asset_file: None,
                error: None,
            }],
            now_ms(),
        );
        save_queue(&project, &queue).unwrap();
        let plan = StoryPlan {
            scenes: vec!["start.txt".to_string()],
            ..StoryPlan::new("test")
        };
        let result = run_queue(
            &project,
            "run-1",
            &plan,
            Arc::new(RetryOnce(AtomicUsize::new(0))),
        )
        .await
        .unwrap();
        assert_eq!(result.tasks[0].status, AssetTaskStatus::Succeeded);
        assert_eq!(result.tasks[0].attempts.len(), 2);
        assert!(project.join("game/background/bg_start.png").is_file());
        assert!(
            std::fs::read_to_string(project.join("game/scene/start.txt"))
                .unwrap()
                .contains("changeBg:bg_start.png;")
        );
        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn binding_failure_does_not_leave_a_formal_asset() {
        let project = std::env::temp_dir().join(format!("ollaic_queue_bind_{}", now_ms()));
        std::fs::create_dir_all(project.join("game/scene")).unwrap();
        std::fs::write(project.join("game/scene/start.txt"), ":actual;\n").unwrap();
        let queue = AssetQueue::new(
            "run-2",
            vec![AssetTask {
                id: "tts_start_0".to_string(),
                kind: AssetKind::Tts,
                target_stem: "vo_start_0".to_string(),
                prompt: "narrator".to_string(),
                scene_ref: Some("start.txt".to_string()),
                character_ref: None,
                dialogue_index: Some(0),
                text: Some("stale".to_string()),
                status: AssetTaskStatus::Pending,
                attempts: Vec::new(),
                asset_file: None,
                error: None,
            }],
            now_ms(),
        );
        save_queue(&project, &queue).unwrap();
        let plan = StoryPlan {
            scenes: vec!["start.txt".to_string()],
            ..StoryPlan::new("test")
        };
        let result = run_queue(&project, "run-2", &plan, Arc::new(AlwaysGenerate))
            .await
            .unwrap();
        assert_eq!(result.tasks[0].status, AssetTaskStatus::Failed);
        assert!(!project.join("game/vocal/vo_start_0.wav").exists());
        assert!(project
            .join(".ollaic/artifacts/assets/tts_start_0/1.wav")
            .is_file());
        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn enforces_each_kind_concurrency_limit() {
        let project = std::env::temp_dir().join(format!("ollaic_queue_limits_{}", now_ms()));
        std::fs::create_dir_all(project.join("game/scene")).unwrap();
        let scene = (0..8)
            .map(|index| format!(":line {index};"))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(project.join("game/scene/start.txt"), scene).unwrap();
        let mut tasks = Vec::new();
        tasks.extend((0..6).map(|index| task(format!("bg_{index}"), AssetKind::Background, None)));
        tasks.extend((0..8).map(|index| task(format!("tts_{index}"), AssetKind::Tts, Some(index))));
        tasks.extend((0..3).map(|index| task(format!("bgm_{index}"), AssetKind::Bgm, None)));
        save_queue(&project, &AssetQueue::new("run-limits", tasks, now_ms())).unwrap();
        let plan = StoryPlan {
            scenes: vec!["start.txt".to_string()],
            ..StoryPlan::new("test")
        };
        let probe = Arc::new(ConcurrencyProbe::new());
        let result = run_queue(&project, "run-limits", &plan, probe.clone())
            .await
            .unwrap();
        assert!(result
            .tasks
            .iter()
            .all(|task| task.status == AssetTaskStatus::Succeeded));
        assert_eq!(probe.maximum[0].load(Ordering::SeqCst), 2);
        assert_eq!(probe.maximum[1].load(Ordering::SeqCst), 4);
        assert_eq!(probe.maximum[2].load(Ordering::SeqCst), 1);
        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn permanent_failure_stops_after_initial_attempt_plus_three_retries() {
        let project = std::env::temp_dir().join(format!("ollaic_queue_fail_{}", now_ms()));
        std::fs::create_dir_all(project.join("game/scene")).unwrap();
        std::fs::write(project.join("game/scene/start.txt"), ":line;\n").unwrap();
        save_queue(
            &project,
            &AssetQueue::new(
                "run-fail",
                vec![task("bg_fail".to_string(), AssetKind::Background, None)],
                now_ms(),
            ),
        )
        .unwrap();
        let plan = StoryPlan {
            scenes: vec!["start.txt".to_string()],
            ..StoryPlan::new("test")
        };
        let generator = Arc::new(AlwaysFail(AtomicUsize::new(0)));
        let result = run_queue(&project, "run-fail", &plan, generator.clone())
            .await
            .unwrap();
        assert_eq!(generator.0.load(Ordering::SeqCst), 4);
        assert_eq!(result.tasks[0].attempts.len(), 4);
        assert_eq!(result.tasks[0].status, AssetTaskStatus::Failed);
        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn manual_rerun_gets_a_fresh_retry_budget() {
        let project = std::env::temp_dir().join(format!("ollaic_queue_rerun_{}", now_ms()));
        std::fs::create_dir_all(project.join("game/scene")).unwrap();
        std::fs::write(project.join("game/scene/start.txt"), ":line;\n").unwrap();
        save_queue(
            &project,
            &AssetQueue::new(
                "run-rerun",
                vec![task("bg_rerun".to_string(), AssetKind::Background, None)],
                now_ms(),
            ),
        )
        .unwrap();
        let plan = StoryPlan {
            scenes: vec!["start.txt".to_string()],
            ..StoryPlan::new("test")
        };
        let generator = Arc::new(FailFourThenSucceed(AtomicUsize::new(0)));

        let failed = run_queue(&project, "run-rerun", &plan, generator.clone())
            .await
            .unwrap();
        assert_eq!(failed.tasks[0].status, AssetTaskStatus::Failed);
        let succeeded = run_queue(&project, "run-rerun", &plan, generator)
            .await
            .unwrap();
        assert_eq!(succeeded.tasks[0].status, AssetTaskStatus::Succeeded);
        assert_eq!(succeeded.tasks[0].attempts.len(), 5);
        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn schedules_and_binds_twelve_scenes_by_eight_voice_lines() {
        let project = std::env::temp_dir().join(format!("ollaic_queue_96_tts_{}", now_ms()));
        std::fs::create_dir_all(project.join("game/scene")).unwrap();
        let mut tasks = Vec::new();
        let mut scenes = Vec::new();
        for scene in 0..12 {
            let file = format!("scene_{scene}.txt");
            let source = (0..8)
                .map(|line| format!(":scene {scene} line {line};"))
                .collect::<Vec<_>>()
                .join("\n");
            std::fs::write(project.join("game/scene").join(&file), source).unwrap();
            for line in 0..8 {
                let mut task = task(format!("tts_{scene}_{line}"), AssetKind::Tts, Some(line));
                task.scene_ref = Some(file.clone());
                task.text = Some(format!("scene {scene} line {line}"));
                tasks.push(task);
            }
            scenes.push(file);
        }
        save_queue(&project, &AssetQueue::new("run-96-tts", tasks, now_ms())).unwrap();
        let plan = StoryPlan {
            scenes,
            ..StoryPlan::new("test")
        };
        let started = std::time::Instant::now();
        let result = run_queue(
            &project,
            "run-96-tts",
            &plan,
            Arc::new(ConcurrencyProbe::new()),
        )
        .await
        .unwrap();
        assert_eq!(result.tasks.len(), 96);
        assert!(result
            .tasks
            .iter()
            .all(|task| task.status == AssetTaskStatus::Succeeded));
        assert!(started.elapsed() < Duration::from_secs(30));
        let _ = std::fs::remove_dir_all(project);
    }
}
