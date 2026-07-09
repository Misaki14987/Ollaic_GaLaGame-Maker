use std::future::Future;
use std::pin::Pin;

use super::{Agent, AgentContext, AgentError, AgentOutput, SceneScript};

/// The Scene step: turns the chapter outline into a WebGAL scene script the
/// scheduler writes to `game/scene/`. P0/P1 deterministic stub; replaced by
/// a `genai`-backed Dialogist agent in a later slice.
pub struct SceneAgent;

impl Agent for SceneAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            if ctx.chapters.is_empty() {
                return Err(AgentError(
                    "Scene step received no chapters to script".to_string(),
                ));
            }
            let mut lines = vec!["intro:自动生成的场景;".to_string()];
            for chapter in ctx.chapters {
                lines.push(format!("{}:{};", chapter.title, chapter.summary));
            }
            let content = lines.join("\n") + "\n";
            Ok(AgentOutput {
                synopsis: None,
                worldbook: None,
                chapters: None,
                scene: Some(SceneScript {
                    name: "scene_01.txt".to_string(),
                    content,
                }),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::story_plan::types::ChapterPlan;

    fn chapters() -> Vec<ChapterPlan> {
        vec![ChapterPlan {
            id: "ch1".to_string(),
            title: "序章".to_string(),
            summary: "开场".to_string(),
        }]
    }

    #[tokio::test]
    async fn scene_agent_produces_a_scene_script_from_chapters() {
        let agent = SceneAgent;
        let ch = chapters();
        let ctx = AgentContext {
            prompt: "",
            synopsis: "",
            chapters: &ch,
            worldbook: "",
        };
        let out = agent.run(&ctx).await.unwrap();
        let scene = out.scene.expect("scene agent should produce a script");
        assert_eq!(scene.name, "scene_01.txt");
        assert!(scene.content.contains("intro:自动生成的场景;"));
        assert!(scene.content.contains("序章:开场;"));
    }

    #[tokio::test]
    async fn scene_agent_rejects_empty_chapters() {
        let agent = SceneAgent;
        let ctx = AgentContext {
            prompt: "",
            synopsis: "",
            chapters: &[],
            worldbook: "",
        };
        assert!(agent.run(&ctx).await.is_err());
    }
}
