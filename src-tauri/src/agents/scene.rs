use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use crate::story_plan::types::{DialogueBeat, SceneDraft};

use super::{Agent, AgentContext, AgentError, AgentOutput, SceneScript};

/// Deterministically compiles structured Dialogist output into editable WebGAL.
pub struct SceneAgent;

impl Agent for SceneAgent {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>> {
        Box::pin(async move {
            if ctx.scene_plans.is_empty() {
                return Err(AgentError("SceneScript requires scene plans".to_string()));
            }
            let fallback_drafts: Vec<SceneDraft>;
            let drafts = if ctx.scene_drafts.is_empty() {
                fallback_drafts = ctx
                    .scene_plans
                    .iter()
                    .map(|scene| SceneDraft {
                        scene_id: scene.id.clone(),
                        title: scene.title.clone(),
                        beats: vec![DialogueBeat {
                            speaker: None,
                            text: scene.summary.clone(),
                        }],
                    })
                    .collect();
                fallback_drafts.as_slice()
            } else {
                ctx.scene_drafts
            };
            let by_draft: HashMap<&str, &SceneDraft> = drafts
                .iter()
                .map(|draft| (draft.scene_id.as_str(), draft))
                .collect();
            let by_file: HashMap<&str, &str> = ctx
                .scene_plans
                .iter()
                .map(|scene| (scene.id.as_str(), scene.file.as_str()))
                .collect();
            let mut scripts = Vec::with_capacity(ctx.scene_plans.len());
            for scene in ctx.scene_plans {
                let draft = by_draft.get(scene.id.as_str()).ok_or_else(|| {
                    AgentError(format!(
                        "SceneScript is missing draft for scene {}",
                        scene.id
                    ))
                })?;
                let mut lines = vec![
                    format!("; Ollaic Agent scene: {}", clean(&scene.title)),
                    format!(
                        "; Planned assets in this production: {}",
                        ctx.asset_plan.len()
                    ),
                    format!("intro:{};", clean(&scene.title)),
                ];
                lines.extend(draft.beats.iter().map(compile_beat));
                let outgoing: Vec<_> = ctx
                    .branches
                    .edges
                    .iter()
                    .filter(|edge| edge.from == scene.id)
                    .collect();
                if outgoing.len() > 1 || outgoing.iter().any(|edge| edge.choice.is_some()) {
                    let choices = outgoing
                        .iter()
                        .map(|edge| {
                            let label = clean_choice(edge.choice.as_deref().unwrap_or("继续"));
                            let file = by_file
                                .get(edge.to.as_str())
                                .copied()
                                .unwrap_or("start.txt");
                            format!("{}:{}", label, file)
                        })
                        .collect::<Vec<_>>()
                        .join("|");
                    lines.push(format!("choose:{};", choices));
                } else if let Some(edge) = outgoing.first() {
                    let file = by_file.get(edge.to.as_str()).copied().ok_or_else(|| {
                        AgentError(format!(
                            "SceneScript branch targets unknown scene {}",
                            edge.to
                        ))
                    })?;
                    lines.push(format!("changeScene:{};", file));
                } else {
                    lines.push("end;".to_string());
                }
                let content = lines.join("\n") + "\n";
                validate_script(&scene.file, &content)?;
                scripts.push(SceneScript {
                    name: scene.file.clone(),
                    content,
                });
            }
            Ok(AgentOutput {
                scenes: Some(scripts),
                ..AgentOutput::default()
            })
        })
    }
}

fn compile_beat(beat: &DialogueBeat) -> String {
    let text = clean(&beat.text);
    match beat
        .speaker
        .as_deref()
        .map(str::trim)
        .filter(|speaker| !speaker.is_empty())
    {
        Some(speaker) => format!("{}:{};", clean(speaker).replace(':', "："), text),
        None => format!(":{};", text),
    }
}

fn clean(value: &str) -> String {
    value.trim().replace(['\r', '\n'], " ").replace(';', "；")
}

fn clean_choice(value: &str) -> String {
    clean(value).replace([':', '|'], " ")
}

fn validate_script(name: &str, content: &str) -> Result<(), AgentError> {
    let stem = name.strip_suffix(".txt").unwrap_or("");
    if stem.is_empty()
        || !stem
            .chars()
            .all(|ch| ch.is_alphanumeric() || ch == '_' || ch == '-')
        || std::path::Path::new(name)
            .file_name()
            .and_then(|value| value.to_str())
            != Some(name)
    {
        return Err(AgentError(format!(
            "invalid WebGAL scene file name: {name}"
        )));
    }
    if content
        .lines()
        .any(|line| !line.starts_with(';') && !line.ends_with(';'))
    {
        return Err(AgentError(format!(
            "scene {name} contains an unterminated WebGAL command"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::story_plan::types::{BranchEdge, BranchGraph, ScenePlan};

    #[tokio::test]
    async fn scene_agent_compiles_multiple_linked_webgal_files() {
        let plans = vec![
            ScenePlan {
                id: "opening".into(),
                file: "start.txt".into(),
                chapter_id: "ch1".into(),
                title: "开场".into(),
                summary: "相遇".into(),
                character_ids: Vec::new(),
            },
            ScenePlan {
                id: "end".into(),
                file: "ending.txt".into(),
                chapter_id: "ch1".into(),
                title: "结尾".into(),
                summary: "告别".into(),
                character_ids: Vec::new(),
            },
        ];
        let drafts = vec![
            SceneDraft {
                scene_id: "opening".into(),
                title: "开场".into(),
                beats: vec![DialogueBeat {
                    speaker: Some("林夏".into()),
                    text: "你终于来了。".into(),
                }],
            },
            SceneDraft {
                scene_id: "end".into(),
                title: "结尾".into(),
                beats: vec![DialogueBeat {
                    speaker: None,
                    text: "天亮了。".into(),
                }],
            },
        ];
        let branches = BranchGraph {
            entry_scene: "opening".into(),
            edges: vec![BranchEdge {
                from: "opening".into(),
                to: "end".into(),
                choice: None,
            }],
        };
        let agent = SceneAgent;
        let ctx = AgentContext {
            prompt: "",
            instruction: "",
            synopsis: "",
            chapters: &[],
            worldbook: "",
            glossary: &Default::default(),
            characters: &[],
            scene_plans: &plans,
            branches: &branches,
            scene_drafts: &drafts,
            asset_plan: &[],
            allow_local_fallback: true,
        };
        let scripts = agent.run(&ctx).await.unwrap().scenes.unwrap();
        assert_eq!(scripts.len(), 2);
        assert!(scripts[0].content.contains("林夏:你终于来了。;"));
        assert!(scripts[0].content.contains("changeScene:ending.txt;"));
        assert!(scripts[1].content.contains("end;"));
    }
}
