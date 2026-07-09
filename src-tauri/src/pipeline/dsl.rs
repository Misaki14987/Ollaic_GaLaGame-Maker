//! Flow recipe DSL - the declarative description of an Agent Flow's steps,
//! dependencies, and agents. See CONTEXT.md "Flow Template" / "Declarative
//! Recipe" and the V2 node types in `doc/v2-agent-pipeline.md` section 3.4.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// The kind of work a Flow Step performs. Mirrors the V2 node-type table.
/// P0 wires only `Plan` and `Outline` to agents; the rest are reserved for
/// later slices so the kind set is stable up front.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepKind {
    Plan,
    Memory,
    Outline,
    Character,
    Scene,
    Asset,
    Lint,
    Review,
    Export,
    UserInput,
}

impl StepKind {
    /// Stable camelCase name, used in events and persisted state.
    pub fn as_str(&self) -> &'static str {
        match self {
            StepKind::Plan => "plan",
            StepKind::Memory => "memory",
            StepKind::Outline => "outline",
            StepKind::Character => "character",
            StepKind::Scene => "scene",
            StepKind::Asset => "asset",
            StepKind::Lint => "lint",
            StepKind::Review => "review",
            StepKind::Export => "export",
            StepKind::UserInput => "userInput",
        }
    }
}

/// One step in a Flow Recipe.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepDef {
    pub id: String,
    pub kind: StepKind,
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Agent key. Defaults to the step kind when unset.
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub prompt: String,
}

impl StepDef {
    pub fn new(id: impl Into<String>, kind: StepKind) -> Self {
        StepDef {
            id: id.into(),
            kind,
            depends_on: Vec::new(),
            agent: None,
            prompt: String::new(),
        }
    }
}

/// A declarative Flow Recipe: an ordered list of steps with dependencies.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct FlowRecipe {
    #[serde(default)]
    pub steps: Vec<StepDef>,
}

impl FlowRecipe {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn step(mut self, step: StepDef) -> Self {
        self.steps.push(step);
        self
    }

    /// Structural validation: unique ids, known dependencies, acyclic graph.
    pub fn validate(&self) -> Result<(), RecipeError> {
        let mut ids: HashSet<&str> = HashSet::new();
        for step in &self.steps {
            if !ids.insert(step.id.as_str()) {
                return Err(RecipeError::DuplicateStepId(step.id.clone()));
            }
        }
        for step in &self.steps {
            for dep in &step.depends_on {
                if !ids.contains(dep.as_str()) {
                    return Err(RecipeError::UnknownDependency(
                        step.id.clone(),
                        dep.clone(),
                    ));
                }
            }
        }
        self.assert_acyclic()?;
        Ok(())
    }

    fn assert_acyclic(&self) -> Result<(), RecipeError> {
        let by_id: HashMap<&str, &StepDef> =
            self.steps.iter().map(|s| (s.id.as_str(), s)).collect();
        // Owned keys avoid the invariant-lifetime friction of HashMap<&str, _>.
        let mut color: HashMap<String, u8> = HashMap::new();
        for step in &self.steps {
            if color.get(step.id.as_str()).copied().unwrap_or(0) == 0 {
                self.visit(step.id.as_str(), &by_id, &mut color)?;
            }
        }
        Ok(())
    }

    fn visit(
        &self,
        id: &str,
        by_id: &HashMap<&str, &StepDef>,
        color: &mut HashMap<String, u8>,
    ) -> Result<(), RecipeError> {
        match color.get(id).copied().unwrap_or(0) {
            2 => return Ok(()),
            1 => return Err(RecipeError::CycleThrough(id.to_string())),
            _ => {}
        }
        color.insert(id.to_string(), 1);
        if let Some(step) = by_id.get(id) {
            for dep in &step.depends_on {
                self.visit(dep, by_id, color)?;
            }
        }
        color.insert(id.to_string(), 2);
        Ok(())
    }
}

/// The default built-in recipe: `Plan` -> `Outline` -> `Scene`
/// (Plan: brief->synopsis; Outline: synopsis->chapters; Scene: chapters->
/// a WebGAL scene script written to game/scene/). This is the P1 content link.
pub fn default_recipe() -> FlowRecipe {
    FlowRecipe::new()
        .step(StepDef::new("plan", StepKind::Plan))
        .step(StepDef::new("outline", StepKind::Outline).depends_on("plan"))
        .step(StepDef::new("scene", StepKind::Scene).depends_on("outline"))
}

impl StepDef {
    pub fn depends_on(mut self, id: impl Into<String>) -> Self {
        self.depends_on.push(id.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum RecipeError {
    DuplicateStepId(String),
    UnknownDependency(String, String),
    CycleThrough(String),
}

impl std::fmt::Display for RecipeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RecipeError::DuplicateStepId(id) => write!(f, "duplicate step id: {}", id),
            RecipeError::UnknownDependency(step, dep) => {
                write!(f, "step '{}' depends on unknown step '{}'", step, dep)
            }
            RecipeError::CycleThrough(id) => {
                write!(f, "dependency cycle detected through step '{}'", id)
            }
        }
    }
}

impl std::error::Error for RecipeError {}
