use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn backup_path(path: &Path) -> PathBuf {
    suffixed_path(path, ".bak")
}

pub fn read_candidates(path: &Path) -> std::io::Result<Vec<String>> {
    let mut candidates = Vec::new();
    for candidate in [path.to_path_buf(), backup_path(path)] {
        if candidate.exists() {
            candidates.push(std::fs::read_to_string(candidate)?);
        }
    }
    Ok(candidates)
}

pub fn write_crash_safe(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let temporary = suffixed_path(path, ".tmp");
    let backup = backup_path(path);
    let mut file = std::fs::File::create(&temporary)?;
    file.write_all(contents)?;
    file.sync_all()?;

    if path.exists() {
        if backup.exists() {
            std::fs::remove_file(&backup)?;
        }
        std::fs::rename(path, &backup)?;
    }
    if let Err(error) = std::fs::rename(&temporary, path) {
        if backup.exists() && !path.exists() {
            let _ = std::fs::rename(&backup, path);
        }
        return Err(error);
    }
    if backup.exists() {
        std::fs::remove_file(backup)?;
    }
    Ok(())
}

fn suffixed_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value: OsString = path.as_os_str().to_owned();
    value.push(suffix);
    PathBuf::from(value)
}
