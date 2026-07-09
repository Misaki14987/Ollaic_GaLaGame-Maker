use std::future::Future;
use std::pin::Pin;

use super::{Agent, AgentContext, AgentError, AgentOutput};

/// The Plan step: turns the user's Production Brief into a one-paragraph
/// synopsis. P0 deterministic stub; replaced by a `genai`-backed agent in P1.
pub struct PlanAgent;

impl Agent for PlanAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            let prompt = ctx.prompt.trim();
            if prompt.is_empty() {
                return Err(AgentError(
                    "Plan step received an empty prompt".to_string(),
                ));
            }
            // Deterministic, content-addressable stub output.
            let synopsis = format!("【梗概】{}", prompt);
            Ok(AgentOutput {
                synopsis: Some(synopsis),
                chapters: None,
                scene: None,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn plan_agent_produces_synopsis_from_prompt() {
        let agent = PlanAgent;
        let ctx = AgentContext {
            prompt: "赛博朋克校园恋爱",
            synopsis: "",
            chapters: &[],
        };
        let out = agent.run(&ctx).await.unwrap();
        assert_eq!(out.synopsis.as_deref(), Some("【梗概】赛博朋克校园恋爱"));
        assert!(out.chapters.is_none());
    }

    #[tokio::test]
    async fn plan_agent_rejects_empty_prompt() {
        let agent = PlanAgent;
        let ctx = AgentContext {
            prompt: "   ",
            synopsis: "",
            chapters: &[],
        };
        assert!(agent.run(&ctx).await.is_err());
    }
}
