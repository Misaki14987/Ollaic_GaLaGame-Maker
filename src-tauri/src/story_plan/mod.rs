//! StoryPlan IR - the project-owned planning record for an Agent Flow (V2).
//!
//! See CONTEXT.md "StoryPlan" and ADRs 0050 (local-first) / 0054 (per-step
//! persistence). The playable story remains in the Project's WebGAL files;
//! this record only explains and resumes generation work.

pub mod store;
pub mod types;

#[allow(unused_imports)]
pub use store::{load_plan, plan_path, remove_plan, save_plan, validate, PlanError};
#[allow(unused_imports)]
pub use types::{
    AssetTaskPlan, BranchEdge, BranchGraph, ChapterPlan, DialogueBeat, PipelineRunSummary,
    SceneDraft, ScenePlan, StoryPlan,
};

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
