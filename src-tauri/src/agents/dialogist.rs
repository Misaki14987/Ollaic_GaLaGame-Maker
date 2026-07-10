use std::future::Future;
use std::pin::Pin;

use serde::Deserialize;

use crate::story_plan::types::{DialogueBeat, SceneDraft, ScenePlan};

use super::router::generate_structured;
use super::{Agent, AgentContext, AgentError, AgentOutput};

pub struct DialogistAgent;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogistResponse {
    scene_drafts: Vec<SceneDraft>,
}

fn fill_missing_titles(plans: &[ScenePlan], drafts: &mut [SceneDraft]) {
    for draft in drafts {
        if draft.title.trim().is_empty() {
            if let Some(plan) = plans.iter().find(|plan| plan.id == draft.scene_id) {
                draft.title = plan.title.clone();
            }
        }
    }
}

impl Agent for DialogistAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            if ctx.scene_plans.is_empty() || ctx.characters.is_empty() {
                return Err(AgentError(
                    "Dialogist requires scene plans and characters".to_string(),
                ));
            }
            let input = serde_json::json!({
                "productionBrief": ctx.prompt,
                "synopsis": ctx.synopsis,
                "worldbook": ctx.worldbook,
                "glossary": ctx.glossary,
                "characters": ctx.characters,
                "scenePlans": ctx.scene_plans,
                "branches": ctx.branches,
                "stepInstruction": ctx.instruction,
                "requirements": "每个 scenePlan 对应一个 sceneDraft，sceneId 必须一致；每场至少 8 个 beat。speaker 为角色 name 或 null（旁白），text 不含 WebGAL 命令。对白要推进冲突、体现人物口吻，避免说明书式复述。"
            });
            if let Some(mut routed) = generate_structured::<DialogistResponse>(
                "Dialogist / 场景对白",
                "把场景卡扩写成可编译的结构化旁白和对白。JSON 格式：{\"sceneDrafts\":[{\"sceneId\":\"...\",\"title\":\"...\",\"beats\":[{\"speaker\":null,\"text\":\"...\"}]}]}。",
                &input,
                ctx.allow_local_fallback,
            ).await? {
                fill_missing_titles(ctx.scene_plans, &mut routed.value.scene_drafts);
                validate_drafts(ctx.scene_plans, &routed.value.scene_drafts)?;
                return Ok(AgentOutput {
                    scene_drafts: Some(routed.value.scene_drafts),
                    model: Some(routed.model),
                    prompt_tokens: routed.prompt_tokens,
                    completion_tokens: routed.completion_tokens,
                    ..AgentOutput::default()
                });
            }

            let drafts = ctx
                .scene_plans
                .iter()
                .map(|scene| local_draft(scene))
                .collect();
            Ok(AgentOutput {
                scene_drafts: Some(drafts),
                ..AgentOutput::default()
            }
            .local_fallback())
        })
    }
}

fn local_draft(scene: &ScenePlan) -> SceneDraft {
    let beats = match scene.id.as_str() {
        "opening" => vec![
            beat(
                None,
                "放学铃响过很久，走廊尽头的广播却又重复了一遍早晨的报时。",
            ),
            beat(Some("陆川"), "……刚才也是这个时间。"),
            beat(None, "空教室里，窗边的少女按停一台没有接通电源的录音机。"),
            beat(Some("林夏"), "你听见了。那就别装作只是设备故障。"),
            beat(Some("陆川"), "你一直在等能听见的人？"),
            beat(Some("林夏"), "不。我在确认下一个被卷进来的人是谁。"),
            beat(None, "她把录音机推到桌沿，磁带上写着陆川今天才拿到的学号。"),
            beat(Some("林夏"), "现在，你还想把它当成偶然吗？"),
        ],
        "encounter" => vec![
            beat(None, "天台的风把城市噪声压成遥远的低鸣。"),
            beat(Some("林夏"), "异常回声只重复被人刻意抹掉的东西。"),
            beat(Some("陆川"), "所以磁带里的学号，是有人想让我忘记？"),
            beat(Some("林夏"), "也可能是想让我忘记你。"),
            beat(None, "她说得平静，握住栏杆的手却慢慢收紧。"),
            beat(Some("陆川"), "你认识我。至少在我不记得的那段时间里。"),
            beat(Some("林夏"), "先证明你不会在知道代价后逃走。"),
            beat(Some("陆川"), "那就从第一条证据开始。"),
        ],
        "investigation" => vec![
            beat(None, "旧资料室的终端每隔十七秒闪过一次不存在的登录记录。"),
            beat(Some("周遥"), "你们最近的社团活动，是比赛谁更像可疑人物吗？"),
            beat(Some("陆川"), "如果我说是在找一份被删掉的值日表呢？"),
            beat(Some("周遥"), "我会问为什么林夏把出口堵住了。"),
            beat(Some("林夏"), "因为记录开始反向删除看过它的人。"),
            beat(None, "屏幕上，周遥的名字正在一笔一画地消失。"),
            beat(Some("陆川"), "关掉终端。现在。"),
            beat(Some("林夏"), "来不及了。静默协议已经注意到我们。"),
        ],
        "decision" => vec![
            beat(None, "整座教学楼的灯同时熄灭，只剩录音机的转轴仍在转动。"),
            beat(Some("林夏"), "协议会给你一个完整、安稳、没有我的日常。"),
            beat(Some("陆川"), "那你呢？"),
            beat(Some("林夏"), "回到我本来该消失的位置。很公平。"),
            beat(Some("周遥"), "公平不是替别人把选择做完。"),
            beat(None, "录音机吐出最后一截磁带，里面传来陆川自己的声音。"),
            beat(Some("陆川"), "我以前说过，会把你当作确认真实的锚点。"),
            beat(Some("林夏"), "所以这一次，别因为一句旧承诺勉强自己。"),
        ],
        "ending_trust" => vec![
            beat(None, "陆川握住林夏冰冷的手，广播里的报时第一次继续向前。"),
            beat(Some("陆川"), "不是因为旧承诺。是因为现在的我仍然会选你。"),
            beat(Some("林夏"), "越界以后，我们都会失去一部分安全。"),
            beat(Some("陆川"), "那就一起记住失去的部分。"),
            beat(None, "晨光落进走廊，所有被删除的名字短暂地浮现在玻璃上。"),
            beat(Some("林夏"), "第一条新规则：不准一个人擅自承担全部代价。"),
            beat(Some("陆川"), "同意。第二条，遇到异常先叫对方名字。"),
            beat(
                None,
                "他们并肩走向仍未醒来的城市，录音机安静地停在新的刻度。",
            ),
        ],
        "ending_depart" => vec![
            beat(None, "陆川松开手，广播声像潮水一样盖过林夏的名字。"),
            beat(Some("林夏"), "这样就好。明天你只会觉得做了一场很长的梦。"),
            beat(Some("陆川"), "可我为什么已经开始害怕忘记？"),
            beat(Some("林夏"), "因为你一直都比自己以为的更诚实。"),
            beat(None, "灯光恢复时，窗边只剩一台没有标签的录音机。"),
            beat(Some("周遥"), "陆川？你在等谁吗？"),
            beat(Some("陆川"), "不知道。只是觉得这里不该这么安静。"),
            beat(None, "他按下播放键，磁带深处传来一声几乎听不清的笑。"),
        ],
        _ => vec![
            beat(None, &scene.summary),
            beat(Some("陆川"), "我们已经走到这里，不能再假装什么都没发生。"),
            beat(Some("林夏"), "那就看着我，把你真正的选择说出来。"),
            beat(None, "短暂的沉默让两人都听见了彼此没有说出口的担忧。"),
            beat(Some("陆川"), "我会承担自己的那一部分。"),
            beat(Some("林夏"), "记住这句话。我不会让你反悔。"),
            beat(None, "他们越过界线，日常的表面随之出现新的裂痕。"),
            beat(Some("陆川"), "走吧。答案就在前面。"),
        ],
    };
    SceneDraft {
        scene_id: scene.id.clone(),
        title: scene.title.clone(),
        beats,
    }
}

fn beat(speaker: Option<&str>, text: &str) -> DialogueBeat {
    DialogueBeat {
        speaker: speaker.map(str::to_string),
        text: text.to_string(),
    }
}

fn validate_drafts(plans: &[ScenePlan], drafts: &[SceneDraft]) -> Result<(), AgentError> {
    let ids: std::collections::HashSet<&str> =
        drafts.iter().map(|draft| draft.scene_id.as_str()).collect();
    if drafts.len() != plans.len() || plans.iter().any(|plan| !ids.contains(plan.id.as_str())) {
        return Err(AgentError(
            "Dialogist output does not cover every scene plan".to_string(),
        ));
    }
    if drafts.iter().any(|draft| {
        draft.beats.len() < 4 || draft.beats.iter().any(|beat| beat.text.trim().is_empty())
    }) {
        return Err(AgentError(
            "Dialogist returned an empty or undersized scene".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_response_without_draft_title_uses_scene_title() {
        let response = r#"{
            "sceneDrafts":[{
                "sceneId":"opening",
                "beats":[{"speaker":null,"text":"黄昏的教室很安静。"}]
            }]
        }"#;
        let plans = vec![ScenePlan {
            id: "opening".into(),
            file: "start.txt".into(),
            chapter_id: "ch1".into(),
            title: "初次相遇".into(),
            summary: String::new(),
            character_ids: Vec::new(),
        }];

        let mut parsed: DialogistResponse =
            serde_json::from_str(response).expect("missing draft title should be recoverable");
        fill_missing_titles(&plans, &mut parsed.scene_drafts);
        assert_eq!(parsed.scene_drafts[0].title, "初次相遇");
    }

    #[test]
    fn local_opening_is_readable_dialogue() {
        let draft = local_draft(&ScenePlan {
            id: "opening".into(),
            file: "start.txt".into(),
            chapter_id: "ch1".into(),
            title: "开场".into(),
            summary: "相遇".into(),
            character_ids: Vec::new(),
        });
        assert!(draft.beats.len() >= 8);
        assert!(draft
            .beats
            .iter()
            .any(|beat| beat.speaker.as_deref() == Some("林夏")));
    }
}
