//! Multi-Agent definitions (V2 section 3.3). Agents are invoked by the
//! pipeline through the `Agent` trait, so the orchestrator is testable
//! without an LLM (ADR 0056). P0 ships deterministic stubs for Plan and
//! Outline; real `genai`-backed agents arrive in P1.

pub mod outline;
pub mod plan;
pub mod scene;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

use crate::pipeline::dsl::StepKind;
use crate::story_plan::types::ChapterPlan;

pub use outline::OutlineAgent;
pub use plan::PlanAgent;
pub use scene::SceneAgent;

/// The slice of StoryPlan context an Agent may read. Grows per slice as new
/// agents need more context (worldbook, characters, branches, ...).
pub struct AgentContext<'a> {
    pub prompt: &'a str,
    pub synopsis: &'a str,
    /// Read by future Scene/Dialogist agents; unused in P0.
    #[allow(dead_code)]
    pub chapters: &'a [ChapterPlan],
}

/// What an Agent produced for a step.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AgentOutput {
    #[serde(default)]
    pub synopsis: Option<String>,
    #[serde(default)]
    pub chapters: Option<Vec<ChapterPlan>>,
    #[serde(default)]
    pub scene: Option<SceneScript>,
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
    map: HashMap<StepKind, Box<dyn Agent>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        AgentRegistry {
            map: HashMap::new(),
        }
    }

    /// The default P0/P1 registry: Plan + Outline + Scene stub agents.
    pub fn with_defaults() -> Self {
        let mut registry = Self::new();
        registry.register(StepKind::Plan, Box::new(PlanAgent));
        registry.register(StepKind::Outline, Box::new(OutlineAgent));
        registry.register(StepKind::Scene, Box::new(SceneAgent));
        registry
    }

    pub fn register(&mut self, kind: StepKind, agent: Box<dyn Agent>) {
        self.map.insert(kind, agent);
    }

    pub fn get(&self, kind: StepKind) -> Option<&dyn Agent> {
        self.map.get(&kind).map(|boxed| boxed.as_ref())
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}
