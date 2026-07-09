use serde::{Deserialize, Serialize};

/// Project-owned planning record for an Agent Flow. Explains and resumes
/// generation work; the playable story remains in the Project's WebGAL files.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoryPlan {
    /// StoryPlan IR schema version. Bump on breaking changes; see `validate`.
    pub version: u32,
    /// The user's original Production Brief / prompt that started this flow.
    pub prompt: String,
    /// One-paragraph synopsis produced by the Plan step.
    #[serde(default)]
    pub synopsis: String,
    /// Long-form worldbook + glossary produced by the Memory (Worldbuilder) step.
    #[serde(default)]
    pub memory: StoryMemory,
    /// Chapter outline produced by the Outline step.
    #[serde(default)]
    pub chapters: Vec<ChapterPlan>,
    /// Scene files written to `game/scene/` by Scene steps (P1 content link).
    #[serde(default)]
    pub scenes: Vec<String>,
    /// History of pipeline runs against this plan (newest last).
    #[serde(default)]
    pub pipeline_runs: Vec<PipelineRunSummary>,
}

impl StoryPlan {
    /// Create a fresh plan from a Production Brief, before any step has run.
    pub fn new(prompt: impl Into<String>) -> Self {
        StoryPlan {
            version: 1,
            prompt: prompt.into(),
            synopsis: String::new(),
            memory: StoryMemory::default(),
            chapters: Vec::new(),
            scenes: Vec::new(),
            pipeline_runs: Vec::new(),
        }
    }
}

/// Long-form worldbuilding context produced by the Worldbuilder (Memory) step.
/// The Plotter (Outline) reads this when building the chapter outline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoryMemory {
    #[serde(default)]
    pub worldbook: String,
}

/// A single chapter in the story outline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPlan {
    pub id: String,
    pub title: String,
    pub summary: String,
}

/// A retained summary of one pipeline run, kept inside the plan's history.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunSummary {
    pub run_id: String,
    /// Mirror of `RunStatus` as a string, so the plan record is stable across
    /// backend enum refactors.
    pub status: String,
    pub started_at: u64,
    pub updated_at: u64,
}
