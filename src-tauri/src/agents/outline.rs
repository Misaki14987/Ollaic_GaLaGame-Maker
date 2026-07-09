use std::future::Future;
use std::pin::Pin;

use crate::story_plan::types::ChapterPlan;

use super::{Agent, AgentContext, AgentError, AgentOutput};

/// The Outline step: turns the synopsis into a chapter outline. P0
/// deterministic stub; replaced by a `genai`-backed agent in P1.
pub struct OutlineAgent;

impl Agent for OutlineAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            let synopsis = if ctx.synopsis.trim().is_empty() {
                "(无梗概)"
            } else {
                ctx.synopsis
            };
            let head: String = synopsis.chars().take(16).collect();
            let chapters = vec![
                ChapterPlan {
                    id: "ch1".to_string(),
                    title: "序章".to_string(),
                    summary: synopsis.to_string(),
                },
                ChapterPlan {
                    id: "ch2".to_string(),
                    title: "第一章".to_string(),
                    summary: format!("承接 {}", head),
                },
            ];
            Ok(AgentOutput {
                synopsis: None,
                chapters: Some(chapters),
                scene: None,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn outline_agent_produces_two_chapters_from_synopsis() {
        let agent = OutlineAgent;
        let ctx = AgentContext {
            prompt: "",
            synopsis: "主角在校园发现异常信号",
            chapters: &[],
        };
        let out = agent.run(&ctx).await.unwrap();
        let chapters = out.chapters.expect("outline should produce chapters");
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].id, "ch1");
        assert_eq!(chapters[1].id, "ch2");
        assert!(chapters[0].summary.contains("异常信号"));
        assert!(out.synopsis.is_none());
    }
}
