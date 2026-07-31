//! Multi-Agent definitions (V2 section 3.3). Agents are invoked by the
//! pipeline through the `Agent` trait, so the orchestrator is testable
//! without an LLM (ADR 0056). P1 agents use the configured `genai` provider
//! and expose an explicit local fallback when no chat model is configured.

pub mod asset_planner;
pub mod character;
pub mod dialogist;
pub mod memory;
pub mod outline;
pub mod plan;
pub mod router;
pub mod scene;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

use crate::characters::types::Character;
use crate::pipeline::dsl::StepKind;
use crate::story_plan::types::{AssetTaskPlan, BranchGraph, ChapterPlan, SceneDraft, ScenePlan};

pub use asset_planner::AssetPlannerAgent;
pub use character::CharacterAgent;
pub use dialogist::DialogistAgent;
pub use memory::MemoryAgent;
pub use outline::OutlineAgent;
pub use plan::PlanAgent;
pub use scene::SceneAgent;

/// The slice of StoryPlan context an Agent may read. Grows per slice as new
/// agents need more context (worldbook, characters, branches, ...).
pub struct AgentContext<'a> {
    /// The immutable Production Brief that owns the run.
    pub prompt: &'a str,
    /// Optional per-step instruction edited from the Flow inspector.
    pub instruction: &'a str,
    pub synopsis: &'a str,
    pub chapters: &'a [ChapterPlan],
    pub worldbook: &'a str,
    pub glossary: &'a std::collections::BTreeMap<String, String>,
    pub characters: &'a [Character],
    pub scene_plans: &'a [ScenePlan],
    pub branches: &'a BranchGraph,
    pub scene_drafts: &'a [SceneDraft],
    pub asset_plan: &'a [AssetTaskPlan],
    pub allow_local_fallback: bool,
}

/// What an Agent produced for a step.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOutput {
    #[serde(default)]
    pub synopsis: Option<String>,
    #[serde(default)]
    pub worldbook: Option<String>,
    #[serde(default)]
    pub chapters: Option<Vec<ChapterPlan>>,
    #[serde(default)]
    pub characters: Option<Vec<Character>>,
    #[serde(default)]
    pub scene_plans: Option<Vec<ScenePlan>>,
    #[serde(default)]
    pub branches: Option<BranchGraph>,
    #[serde(default)]
    pub scene_drafts: Option<Vec<SceneDraft>>,
    #[serde(default)]
    pub asset_plan: Option<Vec<AssetTaskPlan>>,
    #[serde(default)]
    pub scenes: Option<Vec<SceneScript>>,
    /// Persisted AssetTaskQueue summary produced by the P2 asset executor.
    #[serde(default)]
    pub asset_queue: Option<serde_json::Value>,
    #[serde(default)]
    pub glossary: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub prompt_tokens: Option<u32>,
    #[serde(default)]
    pub completion_tokens: Option<u32>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub downgrade: Option<String>,
}

impl AgentOutput {
    pub fn local_fallback(mut self) -> Self {
        self.warnings
            .push("未配置可用的对话模型，已使用本地内容模板".to_string());
        self.downgrade = Some("local-template".to_string());
        self
    }
}

/// A generated WebGAL scene script. The scheduler writes `content` to
/// `<project>/game/scene/<name>` - this is the "readable script" output of
/// the P1 content link (V2 doc section 6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneScript {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentError(pub String);

pub trait Agent: Send + Sync {
    fn run<'a>(
        &'a self,
        ctx: &'a AgentContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput, AgentError>> + Send + 'a>>;
}

/// Maps a `StepKind` to the agent that runs it. Injectable so tests can swap
/// in deterministic or failing agents.
pub struct AgentRegistry {
    map: HashMap<String, Box<dyn Agent>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        AgentRegistry {
            map: HashMap::new(),
        }
    }

    /// The P1 registry, including named Dialogist and SceneScript roles.
    pub fn with_defaults() -> Self {
        let mut registry = Self::new();
        registry.register(StepKind::Plan, Box::new(PlanAgent));
        registry.register(StepKind::Memory, Box::new(MemoryAgent));
        registry.register(StepKind::Outline, Box::new(OutlineAgent));
        registry.register(StepKind::Character, Box::new(CharacterAgent));
        registry.register(StepKind::Asset, Box::new(AssetPlannerAgent));
        registry.register(StepKind::Scene, Box::new(SceneAgent));
        registry.register_named("dialogist", Box::new(DialogistAgent));
        registry.register_named("assetPlanner", Box::new(AssetPlannerAgent));
        registry.register_named("sceneScript", Box::new(SceneAgent));
        registry
    }

    pub fn register(&mut self, kind: StepKind, agent: Box<dyn Agent>) {
        self.map.insert(kind.as_str().to_string(), agent);
    }

    pub fn register_named(&mut self, key: impl Into<String>, agent: Box<dyn Agent>) {
        self.map.insert(key.into(), agent);
    }

    pub fn get(&self, kind: StepKind, key: Option<&str>) -> Option<&dyn Agent> {
        self.map
            .get(key.unwrap_or_else(|| kind.as_str()))
            .map(|boxed| boxed.as_ref())
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}
