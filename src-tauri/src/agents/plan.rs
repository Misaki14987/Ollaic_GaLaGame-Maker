use std::future::Future;
use std::pin::Pin;

use serde::Deserialize;

use super::router::generate_structured;
use super::{Agent, AgentContext, AgentError, AgentOutput};

/// Turns the Production Brief into a concise dramatic premise.
pub struct PlanAgent;

#[derive(Deserialize)]
struct PlanResponse {
    synopsis: String,
}

impl Agent for PlanAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            let prompt = ctx.prompt.trim();
            if prompt.is_empty() {
                return Err(AgentError("Plan step received an empty prompt".to_string()));
            }
            let input = serde_json::json!({
                "productionBrief": prompt,
                "stepInstruction": ctx.instruction,
                "requirements": "用中文写 120-220 字梗概，明确主人公、核心关系、冲突、选择与结局悬念。"
            });
            if let Some(routed) = generate_structured::<PlanResponse>(
                "Plan / 制片策划",
                "把生产简报转成可供后续世界观、剧情和角色 Agent 共同使用的单段故事梗概。JSON 格式：{\"synopsis\":\"...\"}。",
                &input,
                ctx.allow_local_fallback,
            ).await? {
                if routed.value.synopsis.trim().is_empty() {
                    return Err(AgentError("Plan Agent returned an empty synopsis".to_string()));
                }
                return Ok(AgentOutput {
                    synopsis: Some(routed.value.synopsis),
                    model: Some(routed.model),
                    prompt_tokens: routed.prompt_tokens,
                    completion_tokens: routed.completion_tokens,
                    ..AgentOutput::default()
                });
            }
            let synopsis = format!(
                "《{}》围绕一次打破日常的相遇展开。主人公在追查异常的过程中，与一位掌握关键秘密的少女从互相戒备走向彼此信任；当真相要求他们在安稳生活与共同承担后果之间选择时，两人的关系也成为改变结局的唯一变量。",
                prompt
            );
            Ok(AgentOutput {
                synopsis: Some(synopsis),
                ..AgentOutput::default()
            }
            .local_fallback())
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
            instruction: "",
            synopsis: "",
            chapters: &[],
            worldbook: "",
            glossary: &Default::default(),
            characters: &[],
            scene_plans: &[],
            branches: &Default::default(),
            scene_drafts: &[],
            asset_plan: &[],
            allow_local_fallback: true,
        };
        let out = agent.run(&ctx).await.unwrap();
        assert!(out
            .synopsis
            .as_deref()
            .unwrap()
            .contains("赛博朋克校园恋爱"));
        assert!(out.chapters.is_none());
    }

    #[tokio::test]
    async fn plan_agent_rejects_empty_prompt() {
        let agent = PlanAgent;
        let ctx = AgentContext {
            prompt: "   ",
            instruction: "",
            synopsis: "",
            chapters: &[],
            worldbook: "",
            glossary: &Default::default(),
            characters: &[],
            scene_plans: &[],
            branches: &Default::default(),
            scene_drafts: &[],
            asset_plan: &[],
            allow_local_fallback: true,
        };
        assert!(agent.run(&ctx).await.is_err());
    }
}
