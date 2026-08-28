use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::Engine;

use crate::asset_queue::{AssetGenerator, AssetKind, AssetTask, GeneratedArtifact};

pub(crate) trait AssetGeneratorFactory: Send + Sync {
    fn create(
        &self,
        allow_local_fallback: bool,
        cancelled: Arc<AtomicBool>,
    ) -> Arc<dyn AssetGenerator>;
}

pub(crate) struct ConfiguredAssetGeneratorFactory {
    figure_matting_model: Result<PathBuf, String>,
}

impl ConfiguredAssetGeneratorFactory {
    pub(crate) fn new(figure_matting_model: Result<PathBuf, String>) -> Self {
        Self {
            figure_matting_model,
        }
    }
}

impl AssetGeneratorFactory for ConfiguredAssetGeneratorFactory {
    fn create(
        &self,
        allow_local_fallback: bool,
        cancelled: Arc<AtomicBool>,
    ) -> Arc<dyn AssetGenerator> {
        Arc::new(ConfiguredAssetGenerator {
            local_fallback: allow_local_fallback,
            cancelled,
            figure_matting_model: self.figure_matting_model.clone(),
        })
    }
}

struct ConfiguredAssetGenerator {
    local_fallback: bool,
    cancelled: Arc<AtomicBool>,
    figure_matting_model: Result<PathBuf, String>,
}

impl AssetGenerator for ConfiguredAssetGenerator {
    fn preflight(&self, task: &AssetTask) -> Result<(), String> {
        if self.local_fallback {
            return Ok(());
        }
        let (config, capability) = match task.kind {
            AssetKind::Background | AssetKind::Figure => {
                (crate::ai::config::load_image_config(), "图片")
            }
            AssetKind::Tts => (crate::ai::config::load_tts_config(), "音频"),
            AssetKind::Bgm | AssetKind::Sfx => (crate::ai::config::load_music_config(), "音乐"),
        };
        crate::ai::commands::validate_provider_config_basics(&config, capability)?;
        configured_model(&config.model)?;
        if matches!(task.kind, AssetKind::Bgm | AssetKind::Sfx)
            && config.provider.trim() == "custom"
            && config.base_url.trim().is_empty()
        {
            return Err("自定义音乐端点未填写 Base URL".to_string());
        }
        Ok(())
    }

    fn generate<'a>(
        &'a self,
        task: &'a AssetTask,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<GeneratedArtifact, String>> + Send + 'a>,
    > {
        Box::pin(async move {
            if self.cancelled.load(Ordering::SeqCst) {
                return Err(crate::asset_queue::scheduler::ASSET_QUEUE_CANCELLED.to_string());
            }
            let result = generate_configured_asset(task, &self.figure_matting_model).await;
            if self.cancelled.load(Ordering::SeqCst) {
                return Err(crate::asset_queue::scheduler::ASSET_QUEUE_CANCELLED.to_string());
            }
            match result {
                Ok(artifact) => Ok(artifact),
                Err(_) if self.local_fallback => Ok(local_placeholder(task.kind)),
                Err(error) => Err(error),
            }
        })
    }
}

async fn generate_configured_asset(
    task: &AssetTask,
    figure_matting_model: &Result<PathBuf, String>,
) -> Result<GeneratedArtifact, String> {
    let media = match task.kind {
        AssetKind::Background | AssetKind::Figure => {
            let config = crate::ai::config::load_image_config();
            crate::ai::commands::generate_image_media(
                None,
                task.prompt.clone(),
                configured_model(&config.model)?,
                None,
            )
            .await?
        }
        AssetKind::Tts => {
            let config = crate::ai::config::load_tts_config();
            crate::ai::commands::generate_tts_media(
                task.text.clone().unwrap_or_default(),
                task.prompt.clone(),
                configured_model(&config.model)?,
                "mp3".to_string(),
            )
            .await?
        }
        AssetKind::Bgm | AssetKind::Sfx => {
            let config = crate::ai::config::load_music_config();
            crate::ai::commands::generate_music_media(
                task.prompt.clone(),
                configured_model(&config.model)?,
                "mp3".to_string(),
            )
            .await?
        }
    };
    let encoded = media
        .base64_data
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(media.base64_data.as_str());
    let mut bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|error| format!("failed to decode generated media: {error}"))?;
    let mut extension = media.extension;
    if task.kind == AssetKind::Figure {
        let model_path = figure_matting_model.clone()?;
        bytes = tokio::task::spawn_blocking(move || {
            matte_figure_bytes(bytes, |source| {
                crate::matting::commands::matte_image(&model_path, source)
            })
        })
        .await
        .map_err(|error| format!("figure matting task failed: {error}"))??;
        extension = "png".to_string();
    }
    Ok(GeneratedArtifact {
        extension,
        bytes,
        used_local_fallback: false,
    })
}

fn configured_model(value: &str) -> Result<String, String> {
    value
        .split(',')
        .map(str::trim)
        .find(|model| !model.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "asset provider has no configured model".to_string())
}

fn matte_figure_bytes(
    bytes: Vec<u8>,
    matte: impl FnOnce(&[u8]) -> Result<Vec<u8>, String>,
) -> Result<Vec<u8>, String> {
    matte(&bytes)
}

pub(crate) fn local_placeholder(kind: AssetKind) -> GeneratedArtifact {
    if kind == AssetKind::Figure {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([0, 0, 0, 0]),
        ))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .expect("embedded transparent placeholder is encodable");
        return GeneratedArtifact {
            extension: "png".to_string(),
            bytes: bytes.into_inner(),
            used_local_fallback: true,
        };
    }
    if kind == AssetKind::Background {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XfP7WQAAAABJRU5ErkJggg==")
            .expect("embedded placeholder png is valid");
        return GeneratedArtifact {
            extension: "png".to_string(),
            bytes,
            used_local_fallback: true,
        };
    }
    let mut bytes = b"RIFF\x24\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\x40\x1f\0\0\x80\x3e\0\0\x02\0\x10\0data\0\0\0\0".to_vec();
    bytes.truncate(44);
    GeneratedArtifact {
        extension: "wav".to_string(),
        bytes,
        used_local_fallback: true,
    }
}

#[cfg(test)]
pub(crate) struct PlaceholderAssetGeneratorFactory;

#[cfg(test)]
impl AssetGeneratorFactory for PlaceholderAssetGeneratorFactory {
    fn create(
        &self,
        _allow_local_fallback: bool,
        cancelled: Arc<AtomicBool>,
    ) -> Arc<dyn AssetGenerator> {
        Arc::new(PlaceholderAssetGenerator { cancelled })
    }
}

#[cfg(test)]
struct PlaceholderAssetGenerator {
    cancelled: Arc<AtomicBool>,
}

#[cfg(test)]
impl AssetGenerator for PlaceholderAssetGenerator {
    fn generate<'a>(
        &'a self,
        task: &'a AssetTask,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<GeneratedArtifact, String>> + Send + 'a>,
    > {
        Box::pin(async move {
            if self.cancelled.load(Ordering::SeqCst) {
                Err(crate::asset_queue::scheduler::ASSET_QUEUE_CANCELLED.to_string())
            } else {
                Ok(local_placeholder(task.kind))
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::matte_figure_bytes;

    #[test]
    fn generated_figure_uses_matting_output() {
        let output = matte_figure_bytes(b"opaque source".to_vec(), |source| {
            assert_eq!(source, b"opaque source");
            Ok(b"transparent png".to_vec())
        })
        .unwrap();
        assert_eq!(output, b"transparent png");
        assert_eq!(
            matte_figure_bytes(b"opaque source".to_vec(), |_| Err("matting failed".into()))
                .unwrap_err(),
            "matting failed"
        );
    }
}
