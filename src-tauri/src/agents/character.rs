use std::future::Future;
use std::pin::Pin;

use serde::Deserialize;

use crate::characters::types::Character;

use super::router::generate_structured;
use super::{Agent, AgentContext, AgentError, AgentOutput};

pub struct CharacterAgent;

#[derive(Deserialize)]
struct CharacterResponse {
    characters: Vec<Character>,
}

impl Agent for CharacterAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            if ctx.scene_plans.is_empty() {
                return Err(AgentError(
                    "Character Agent requires scene plans".to_string(),
                ));
            }
            let input = serde_json::json!({
                "productionBrief": ctx.prompt,
                "synopsis": ctx.synopsis,
                "worldbook": ctx.worldbook,
                "chapters": ctx.chapters,
                "scenePlans": ctx.scene_plans,
                "stepInstruction": ctx.instruction,
                "requirements": "生成 3-5 个可直接保存的角色卡。id 使用稳定英文小写标识，并覆盖 scenePlans.characterIds。name 是 WebGAL 对白中的显示名。description、personality、dialogueStyle、keywords 必须具体。sprites 留空，资产由 P2 生成。"
            });
            if let Some(routed) = generate_structured::<CharacterResponse>(
                "Character / 角色设计",
                "根据剧情结构创建一致、可演出的角色卡。JSON 格式：{\"characters\":[Character]}，Character 字段使用 camelCase。",
                &input,
                ctx.allow_local_fallback,
            ).await? {
                validate_characters(&routed.value.characters)?;
                return Ok(AgentOutput {
                    characters: Some(routed.value.characters),
                    model: Some(routed.model),
                    prompt_tokens: routed.prompt_tokens,
                    completion_tokens: routed.completion_tokens,
                    ..AgentOutput::default()
                });
            }

            let characters = vec![
                character(
                    "protagonist",
                    "陆川",
                    "习惯先观察再行动的转学生，是异常回声的新感知者。",
                    "克制、敏锐、害怕连累别人；越紧张越会用事实掩饰情绪。",
                    "短句，先确认事实再表达感受；真正下定决心时会直接叫对方名字。",
                    "男",
                    "17",
                    &["主人公", "转学生", "锚点"],
                    "中立",
                ),
                character(
                    "heroine",
                    "林夏",
                    "掌握静默协议真相的少女，独自追查被抹去的异常记录。",
                    "冷静外表下有强烈的责任感，不轻易求助，却会记住他人的微小善意。",
                    "语气简洁，常用反问试探；放下戒备后会把真正担忧藏在玩笑后面。",
                    "女",
                    "17",
                    &["女主角", "知情者", "异常回声"],
                    "越界者",
                ),
                character(
                    "friend",
                    "周遥",
                    "主人公在新环境中的第一个朋友，也是维持日常秩序的现实提醒。",
                    "热心、务实、对气氛变化很敏感；不理解秘密，却愿意保护朋友。",
                    "自然口语，会用具体小事打断沉重气氛；认真时不绕弯子。",
                    "女",
                    "17",
                    &["朋友", "日常", "见证者"],
                    "守序",
                ),
            ];
            Ok(AgentOutput {
                characters: Some(characters),
                ..AgentOutput::default()
            }
            .local_fallback())
        })
    }
}

fn character(
    id: &str,
    name: &str,
    description: &str,
    personality: &str,
    dialogue_style: &str,
    gender: &str,
    age: &str,
    keywords: &[&str],
    stance: &str,
) -> Character {
    Character {
        id: id.to_string(),
        name: name.to_string(),
        aliases: Vec::new(),
        description: description.to_string(),
        personality: personality.to_string(),
        reference_images: Vec::new(),
        stance: stance.to_string(),
        keywords: keywords.iter().map(|value| value.to_string()).collect(),
        dialogue_style: dialogue_style.to_string(),
        gender: gender.to_string(),
        age: age.to_string(),
        sprites: Vec::new(),
        default_voice: None,
        voice_timbre: None,
        relations: Vec::new(),
        color_theme: None,
        notes: String::new(),
    }
}

fn validate_characters(characters: &[Character]) -> Result<(), AgentError> {
    let mut ids = std::collections::HashSet::new();
    if characters.len() < 2 {
        return Err(AgentError(
            "Character Agent returned fewer than two characters".to_string(),
        ));
    }
    for character in characters {
        if character.id.trim().is_empty() || character.name.trim().is_empty() {
            return Err(AgentError(
                "Character Agent returned an unnamed character".to_string(),
            ));
        }
        if !ids.insert(character.id.as_str()) {
            return Err(AgentError(format!(
                "Character Agent returned duplicate id: {}",
                character.id
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::story_plan::types::{BranchGraph, ScenePlan};

    #[tokio::test]
    async fn local_character_agent_produces_editable_character_cards() {
        let scenes = vec![ScenePlan {
            id: "opening".into(),
            file: "start.txt".into(),
            chapter_id: "ch1".into(),
            title: "开场".into(),
            summary: "相遇".into(),
            character_ids: vec!["protagonist".into()],
        }];
        let agent = CharacterAgent;
        let ctx = AgentContext {
            prompt: "校园悬疑恋爱",
            instruction: "",
            synopsis: "相遇",
            chapters: &[],
            worldbook: "规则",
            glossary: &Default::default(),
            characters: &[],
            scene_plans: &scenes,
            branches: &BranchGraph::default(),
            scene_drafts: &[],
            asset_plan: &[],
            allow_local_fallback: true,
        };
        let out = agent.run(&ctx).await.unwrap();
        let characters = out.characters.unwrap();
        assert_eq!(characters.len(), 3);
        assert!(characters
            .iter()
            .all(|character| !character.dialogue_style.is_empty()));
    }
}
