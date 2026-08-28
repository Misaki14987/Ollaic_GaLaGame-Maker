use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

type ProjectMutex = Arc<Mutex<()>>;

fn locks() -> &'static Mutex<HashMap<PathBuf, Weak<Mutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn project_key(project_path: &Path) -> PathBuf {
    project_path
        .canonicalize()
        .unwrap_or_else(|_| project_path.to_path_buf())
}

pub fn with_project_lock<T>(project_path: &Path, operation: impl FnOnce() -> T) -> T {
    let key = project_key(project_path);
    let project_lock = {
        let mut entries = locks()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        entries.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = entries.get(&key).and_then(Weak::upgrade) {
            lock
        } else {
            let lock: ProjectMutex = Arc::new(Mutex::new(()));
            entries.insert(key, Arc::downgrade(&lock));
            lock
        }
    };
    let _guard = project_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    operation()
}

pub fn project_root_for_game_path(path: &Path) -> Option<PathBuf> {
    let mut current = path.parent();
    while let Some(directory) = current {
        if directory.file_name().and_then(|name| name.to_str()) == Some("game") {
            return directory.parent().map(Path::to_path_buf);
        }
        current = directory.parent();
    }
    None
}

pub fn with_game_path_lock<T>(path: &Path, operation: impl FnOnce() -> T) -> T {
    match project_root_for_game_path(path) {
        Some(root) => with_project_lock(&root, operation),
        None => operation(),
    }
}
