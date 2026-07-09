use std::future::Future;
use std::pin::Pin;

use super::{Agent, AgentContext, AgentError, AgentOutput};

/// The Memory step (Worldbuilder): turns the synopsis into a long-form
/// worldbook stored in `StoryPlan.memory`, which the Outline (Plotter) step
/// reads. P0/P1 deterministic stub; replaced by a `genai`-backed Worldbuilder
/// in a later slice.
pub struct MemoryAgent;

impl Agent for MemoryAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            let synopsis = ctx.synopsis.trim();
            if synopsis.is_empty() {
                return Err(AgentError(
                    "Memory step received an empty synopsis".to_string(),
                ));
            }
            // Deterministic stub: derive a worldbook from the synopsis.
            let worldbook = format!("【世界观】基于梗概「{}」展开的世界设定。", synopsis);
            Ok(AgentOutput {
                synopsis: None,
                chapters: None,
                scene: None,
                worldbook: Some(worldbook),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_agent_produces_worldbook_from_synopsis() {
        let agent = MemoryAgent;
        let ctx = AgentContext {
            prompt: "",
            synopsis: "赛博校园里的记忆黑客",
            chapters: &[],
            worldbook: "",
        };
        let out = agent.run(&ctx).await.unwrap();
        assert!(out.worldbook.as_deref().unwrap().contains("赛博校园"));
        assert!(out.synopsis.is_none());
    }

    #[tokio::test]
    async fn memory_agent_rejects_empty_synopsis() {
        let agent = MemoryAgent;
        let ctx = AgentContext {
            prompt: "",
            synopsis: "  ",
            chapters: &[],
            worldbook: "",
        };
        assert!(agent.run(&ctx).await.is_err());
    }
}
