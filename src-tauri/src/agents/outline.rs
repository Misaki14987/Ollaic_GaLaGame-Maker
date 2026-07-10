use std::future::Future;
use std::pin::Pin;

use serde::Deserialize;

use crate::story_plan::types::{BranchEdge, BranchGraph, ChapterPlan, ScenePlan};

use super::router::generate_structured;
use super::{Agent, AgentContext, AgentError, AgentOutput};

/// Plotter: turns canon into chapters, scene cards, and an explicit branch graph.
pub struct OutlineAgent;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutlineResponse {
    chapters: Vec<ChapterPlan>,
    scene_plans: Vec<ScenePlan>,
    branches: BranchGraph,
}

fn fill_missing_summaries(response: &mut OutlineResponse, synopsis: &str) {
    for chapter in &mut response.chapters {
        if chapter.summary.trim().is_empty() {
            chapter.summary = format!("章节“{}”围绕故事主线继续推进：{}", chapter.title, synopsis);
        }
    }
    for scene in &mut response.scene_plans {
        if scene.summary.trim().is_empty() {
            scene.summary = format!("围绕“{}”展开，推进主线冲突与人物关系。", scene.title);
        }
    }
}

impl Agent for OutlineAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            let synopsis = ctx.synopsis.trim();
            if synopsis.is_empty() {
                return Err(AgentError("Plotter requires a synopsis".to_string()));
            }
            let input = serde_json::json!({
                "productionBrief": ctx.prompt,
                "synopsis": synopsis,
                "worldbook": ctx.worldbook,
                "glossary": ctx.glossary,
                "stepInstruction": ctx.instruction,
                "requirements": "生成 3 章、至少 5 个 scene。入口 scene 的 file 必须是 start.txt；其他 file 只能是无路径的 .txt 文件名。scene id 唯一，chapterId 必须引用章节 id。branches.entryScene 和每条 edge 的 from/to 使用 scene id，至少包含一次有 choice 文本的分支。"
            });
            if let Some(mut routed) = generate_structured::<OutlineResponse>(
                "Plotter / 剧情结构",
                concat!(
                    "输出可执行的章节、场景卡和分支拓扑。严格使用 JSON：",
                    r#"{"chapters":[{"id":"ch1","title":"...","summary":"..."}],"scenePlans":[{"id":"opening","file":"start.txt","chapterId":"ch1","title":"...","summary":"...","characterIds":["protagonist"]}],"branches":{"entryScene":"opening","edges":[{"from":"opening","to":"next_scene","choice":null}]}}"#,
                    "。每个 chapter 和 scenePlan 都必须包含非空 summary。"
                ),
                &input,
                ctx.allow_local_fallback,
            )
            .await?
            {
                fill_missing_summaries(&mut routed.value, synopsis);
                if routed.value.chapters.is_empty() || routed.value.scene_plans.len() < 2 {
                    return Err(AgentError(
                        "Plotter returned too little story structure".to_string(),
                    ));
                }
                return Ok(AgentOutput {
                    chapters: Some(routed.value.chapters),
                    scene_plans: Some(routed.value.scene_plans),
                    branches: Some(routed.value.branches),
                    model: Some(routed.model),
                    prompt_tokens: routed.prompt_tokens,
                    completion_tokens: routed.completion_tokens,
                    ..AgentOutput::default()
                });
            }
            let chapters = vec![
                ChapterPlan {
                    id: "ch1".to_string(),
                    title: "序章 · 日常的裂缝".to_string(),
                    summary: format!(
                        "主人公在熟悉的日常中发现异常，并第一次遇见掌握秘密的少女。{}",
                        synopsis
                    ),
                },
                ChapterPlan {
                    id: "ch2".to_string(),
                    title: "第二章 · 共同越界".to_string(),
                    summary: "两人合作验证异常回声，在互相试探中建立信任，也触碰静默协议。"
                        .to_string(),
                },
                ChapterPlan {
                    id: "ch3".to_string(),
                    title: "终章 · 锚点".to_string(),
                    summary: "真相迫使主人公决定相信对方并承担代价，或退回安全却失去这段关系。"
                        .to_string(),
                },
            ];
            let scene_plans = vec![
                scene(
                    "opening",
                    "start.txt",
                    "ch1",
                    "听见回声",
                    "日常第一次出现无法解释的重复信号。",
                    &["protagonist", "heroine"],
                ),
                scene(
                    "encounter",
                    "chapter_01.txt",
                    "ch1",
                    "交换秘密",
                    "少女指出主人公也已成为异常的一部分。",
                    &["protagonist", "heroine"],
                ),
                scene(
                    "investigation",
                    "chapter_02.txt",
                    "ch2",
                    "共同越界",
                    "两人验证规则，第三位角色带来现实压力。",
                    &["protagonist", "heroine", "friend"],
                ),
                scene(
                    "decision",
                    "decision.txt",
                    "ch3",
                    "锚点选择",
                    "静默协议启动，主人公必须当场选择。",
                    &["protagonist", "heroine", "friend"],
                ),
                scene(
                    "ending_trust",
                    "ending_trust.txt",
                    "ch3",
                    "共同承担",
                    "主人公选择相信少女，两人带着代价继续追索真相。",
                    &["protagonist", "heroine"],
                ),
                scene(
                    "ending_depart",
                    "ending_depart.txt",
                    "ch3",
                    "归于静默",
                    "主人公回到安稳日常，却保留了一丝无法解释的熟悉感。",
                    &["protagonist"],
                ),
            ];
            let branches = BranchGraph {
                entry_scene: "opening".to_string(),
                edges: vec![
                    edge("opening", "encounter", None),
                    edge("encounter", "investigation", None),
                    edge("investigation", "decision", None),
                    edge("decision", "ending_trust", Some("握住她的手，一起承担")),
                    edge("decision", "ending_depart", Some("遵守协议，回到日常")),
                ],
            };
            Ok(AgentOutput {
                chapters: Some(chapters),
                scene_plans: Some(scene_plans),
                branches: Some(branches),
                ..AgentOutput::default()
            }
            .local_fallback())
        })
    }
}

fn scene(
    id: &str,
    file: &str,
    chapter_id: &str,
    title: &str,
    summary: &str,
    characters: &[&str],
) -> ScenePlan {
    ScenePlan {
        id: id.to_string(),
        file: file.to_string(),
        chapter_id: chapter_id.to_string(),
        title: title.to_string(),
        summary: summary.to_string(),
        character_ids: characters.iter().map(|id| id.to_string()).collect(),
    }
}

fn edge(from: &str, to: &str, choice: Option<&str>) -> BranchEdge {
    BranchEdge {
        from: from.to_string(),
        to: to.to_string(),
        choice: choice.map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_response_without_summaries_does_not_abort_plotter() {
        let response = r#"{
            "chapters":[{"id":"ch1","title":"序章"}],
            "scenePlans":[{"id":"opening","file":"start.txt","chapterId":"ch1","title":"相遇"}],
            "branches":{"entryScene":"","edges":[]}
        }"#;

        let mut parsed: OutlineResponse =
            serde_json::from_str(response).expect("missing summary should be recoverable");
        fill_missing_summaries(&mut parsed, "校园悬疑");
        assert!(!parsed.chapters[0].summary.is_empty());
        assert!(!parsed.scene_plans[0].summary.is_empty());
    }

    #[tokio::test]
    async fn outline_agent_produces_two_chapters_from_synopsis() {
        let agent = OutlineAgent;
        let ctx = AgentContext {
            prompt: "",
            instruction: "",
            synopsis: "主角在校园发现异常信号",
            chapters: &[],
            worldbook: "霓虹学园",
            glossary: &Default::default(),
            characters: &[],
            scene_plans: &[],
            branches: &Default::default(),
            scene_drafts: &[],
            asset_plan: &[],
            allow_local_fallback: true,
        };
        let out = agent.run(&ctx).await.unwrap();
        let chapters = out.chapters.expect("outline should produce chapters");
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[0].id, "ch1");
        assert_eq!(chapters[1].id, "ch2");
        assert!(chapters[0].summary.contains("异常信号"));
        assert_eq!(out.scene_plans.as_ref().unwrap().len(), 6);
        assert_eq!(out.branches.as_ref().unwrap().entry_scene, "opening");
        assert!(out.synopsis.is_none());
    }
}
