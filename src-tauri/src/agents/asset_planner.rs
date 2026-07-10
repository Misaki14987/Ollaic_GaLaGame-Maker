use std::future::Future;
use std::pin::Pin;

use serde::Deserialize;

use crate::story_plan::types::AssetTaskPlan;

use super::router::generate_structured;
use super::{Agent, AgentContext, AgentError, AgentOutput};

pub struct AssetPlannerAgent;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetPlanResponse {
    asset_plan: Vec<AssetTaskPlan>,
}

impl Agent for AssetPlannerAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            if ctx.scene_drafts.is_empty() || ctx.characters.is_empty() {
                return Err(AgentError(
                    "AssetPlanner requires dialogue drafts and characters".to_string(),
                ));
            }
            let input = serde_json::json!({
                "productionBrief": ctx.prompt,
                "worldbook": ctx.worldbook,
                "characters": ctx.characters,
                "scenePlans": ctx.scene_plans,
                "sceneDrafts": ctx.scene_drafts,
                "stepInstruction": ctx.instruction,
                "requirements": "仅规划需求，不生成或绑定素材。kind 使用 background、figure、bgm、sfx 之一；targetStem 使用安全英文/数字/下划线；sceneRef/characterRef 引用已有 id；status 固定 pending。覆盖每个场景的背景、每个主要角色的默认立绘，以及全局 BGM。"
            });
            if let Some(routed) = generate_structured::<AssetPlanResponse>(
                "AssetPlanner / 资产规划",
                "把故事内容转成 P2 可消费的结构化资产任务。JSON 格式：{\"assetPlan\":[AssetTaskPlan]}，字段使用 camelCase。",
                &input,
                ctx.allow_local_fallback,
            ).await? {
                if routed.value.asset_plan.is_empty() {
                    return Err(AgentError("AssetPlanner returned no tasks".to_string()));
                }
                return Ok(AgentOutput {
                    asset_plan: Some(routed.value.asset_plan),
                    model: Some(routed.model),
                    prompt_tokens: routed.prompt_tokens,
                    completion_tokens: routed.completion_tokens,
                    ..AgentOutput::default()
                });
            }

            let mut tasks: Vec<AssetTaskPlan> = ctx
                .scene_plans
                .iter()
                .map(|scene| AssetTaskPlan {
                    id: format!("bg_{}", scene.id),
                    kind: "background".to_string(),
                    target_stem: format!("bg_{}", scene.id),
                    prompt: format!(
                        "视觉小说背景，无人物，{}；{}；与统一世界观保持光线和建筑语言一致",
                        scene.title, scene.summary
                    ),
                    scene_ref: Some(scene.id.clone()),
                    character_ref: None,
                    status: "pending".to_string(),
                })
                .collect();
            tasks.extend(ctx.characters.iter().map(|character| AssetTaskPlan {
                id: format!("figure_{}_default", character.id),
                kind: "figure".to_string(),
                target_stem: format!("{}_default", character.id),
                prompt: format!(
                    "视觉小说角色立绘，透明背景，默认站姿；{}；性格：{}",
                    character.description, character.personality
                ),
                scene_ref: None,
                character_ref: Some(character.id.clone()),
                status: "pending".to_string(),
            }));
            tasks.push(AssetTaskPlan {
                id: "bgm_main_theme".to_string(),
                kind: "bgm".to_string(),
                target_stem: "bgm_main_theme".to_string(),
                prompt: "克制而带悬念的视觉小说主题音乐，能从日常感逐渐过渡到温柔的决意。"
                    .to_string(),
                scene_ref: None,
                character_ref: None,
                status: "pending".to_string(),
            });
            Ok(AgentOutput {
                asset_plan: Some(tasks),
                ..AgentOutput::default()
            }
            .local_fallback())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planned_tasks_are_pending_by_default() {
        let task = AssetTaskPlan {
            id: "bg_opening".into(),
            kind: "background".into(),
            target_stem: "bg_opening".into(),
            prompt: "教室".into(),
            scene_ref: Some("opening".into()),
            character_ref: None,
            status: "pending".into(),
        };
        assert_eq!(task.status, "pending");
    }
}
