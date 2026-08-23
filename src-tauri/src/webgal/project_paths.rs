use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ProjectPaths {
    root: PathBuf,
    scene_dir: PathBuf,
}

impl ProjectPaths {
    pub fn open(project_root: impl AsRef<Path>) -> Result<Self, String> {
        let requested_root = project_root.as_ref();
        let root = requested_root
            .canonicalize()
            .map_err(|error| format!("Invalid project {}: {error}", requested_root.display()))?;
        if !root.is_dir() {
            return Err(format!("Invalid project {}: not a directory", root.display()));
        }

        let game = canonical_domain_dir(&root, &root.join("game"), "game")?;
        let scene_dir = canonical_domain_dir(&game, &game.join("scene"), "scene")?;
        Ok(Self { root, scene_dir })
    }

    pub fn existing_scene(&self, scene_name: &str) -> Result<PathBuf, String> {
        let path = self.scene_candidate(scene_name)?;
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Scene {scene_name} is not accessible: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!("Scene {scene_name} is not a regular project file"));
        }
        let resolved = path
            .canonicalize()
            .map_err(|error| format!("Scene {scene_name} is not accessible: {error}"))?;
        if !resolved.starts_with(&self.scene_dir) {
            return Err(format!("Scene {scene_name} escapes the project"));
        }
        Ok(path)
    }

    pub fn scene_candidate(&self, scene_name: &str) -> Result<PathBuf, String> {
        validate_scene_identifier(scene_name)?;
        let path = self.scene_dir.join(scene_name);
        if path.parent() != Some(self.scene_dir.as_path()) {
            return Err(format!("Invalid scene identifier: {scene_name}"));
        }
        Ok(path)
    }

    pub fn list_scenes(&self) -> Result<Vec<String>, String> {
        let mut scenes = Vec::new();
        for entry in fs::read_dir(&self.scene_dir)
            .map_err(|error| format!("Failed to list project scenes: {error}"))?
        {
            let entry = entry.map_err(|error| format!("Failed to list project scenes: {error}"))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if validate_scene_identifier(&name).is_err() {
                continue;
            }
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|error| format!("Failed to inspect scene {name}: {error}"))?;
            if metadata.is_file() && !metadata.file_type().is_symlink() {
                scenes.push(name);
            }
        }
        scenes.sort();
        Ok(scenes)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn scene_dir(&self) -> &Path {
        &self.scene_dir
    }
}

fn canonical_domain_dir(owner: &Path, requested: &Path, label: &str) -> Result<PathBuf, String> {
    let resolved = requested
        .canonicalize()
        .map_err(|error| format!("Invalid project {label} directory: {error}"))?;
    if !resolved.is_dir() || !resolved.starts_with(owner) {
        return Err(format!("Invalid project {label} directory"));
    }
    Ok(resolved)
}

fn validate_scene_identifier(scene_name: &str) -> Result<(), String> {
    let path = Path::new(scene_name);
    let single_normal_component = matches!(
        path.components().collect::<Vec<_>>().as_slice(),
        [Component::Normal(_)]
    );
    if scene_name.is_empty()
        || path.is_absolute()
        || !single_normal_component
        || scene_name.contains(['/', '\\'])
        || path.file_name().and_then(|name| name.to_str()) != Some(scene_name)
        || path.file_stem().and_then(|stem| stem.to_str()).is_none_or(str::is_empty)
        || path.extension().and_then(|extension| extension.to_str()) != Some("txt")
    {
        return Err(format!("Invalid scene identifier: {scene_name}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("ollaic_project_paths_{label}_{nonce}"))
    }

    #[test]
    fn project_paths_rejects_scene_identifiers_outside_the_scene_domain() {
        let workspace = temp_root("scene_escape");
        let project = workspace.join("project");
        fs::create_dir_all(project.join("game/scene")).unwrap();
        fs::write(workspace.join("outside.txt"), "secret").unwrap();

        let paths = ProjectPaths::open(&project).unwrap();
        assert!(paths.existing_scene("../../../outside.txt").is_err());
        assert!(paths
            .existing_scene(&workspace.join("outside.txt").to_string_lossy())
            .is_err());

        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn project_paths_accepts_unicode_scene_names_and_rejects_extension_case_variants() {
        let workspace = temp_root("unicode");
        let project = workspace.join("project");
        fs::create_dir_all(project.join("game/scene")).unwrap();
        fs::write(project.join("game/scene/雨夜.txt"), "content").unwrap();
        fs::write(project.join("game/scene/upper.TXT"), "content").unwrap();

        let paths = ProjectPaths::open(&project).unwrap();
        assert!(paths.existing_scene("雨夜.txt").is_ok());
        assert!(paths.existing_scene("upper.TXT").is_err());
        assert_eq!(paths.list_scenes().unwrap(), vec!["雨夜.txt"]);

        fs::remove_dir_all(workspace).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn project_paths_rejects_symlinked_domains_and_scene_files() {
        use std::os::unix::fs::symlink;

        let workspace = temp_root("symlink");
        let outside = workspace.join("outside");
        let project = workspace.join("project");
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(project.join("game/scene")).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        symlink(outside.join("secret.txt"), project.join("game/scene/link.txt")).unwrap();

        let paths = ProjectPaths::open(&project).unwrap();
        assert!(paths.existing_scene("link.txt").is_err());

        let escaped_project = workspace.join("escaped-project");
        fs::create_dir_all(escaped_project.join("game")).unwrap();
        symlink(&outside, escaped_project.join("game/scene")).unwrap();
        assert!(ProjectPaths::open(&escaped_project).is_err());

        fs::remove_dir_all(workspace).unwrap();
    }
}
