use super::*;
use crate::story_plan::types::{ChapterPlan, PipelineRunSummary, StoryPlan};
use std::fs;

fn fresh_project_dir(name: &str) -> std::path::PathBuf {
    let tmp = std::env::temp_dir().join(format!("ollaic_story_plan_{}", name));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();
    tmp
}

#[test]
fn plan_round_trips_through_disk() {
    let project = fresh_project_dir("round_trip");
    let plan = StoryPlan {
        version: 1,
        prompt: "赛博朋克校园恋爱悬疑短篇".to_string(),
        synopsis: "一名转学生在校园服务器里发现了一段不该存在的记忆。".to_string(),
        chapters: vec![
            ChapterPlan {
                id: "ch1".to_string(),
                title: "序章 · 信号".to_string(),
                summary: "主角转学，初遇女主，发现异常。".to_string(),
            },
            ChapterPlan {
                id: "ch2".to_string(),
                title: "第一章 · 余像".to_string(),
                summary: "追查信号来源，与女主关系推进。".to_string(),
            },
        ],
        scenes: vec!["scene_01.txt".to_string()],
        pipeline_runs: vec![PipelineRunSummary {
            run_id: "run_1".to_string(),
            status: "completed".to_string(),
            started_at: 1_700_000_000,
            updated_at: 1_700_000_100,
        }],
    };

    save_plan(&project, &plan).unwrap();
    // No plan exists before save is impossible here; load returns the saved one.
    let loaded = load_plan(&project).unwrap().expect("plan should exist after save");

    assert_eq!(loaded, plan);
    // The plan lands exactly where the ADR says it should.
    assert!(plan_path(&project).is_file());
}

#[test]
fn load_returns_none_when_no_plan_exists() {
    let project = fresh_project_dir("none");
    assert!(load_plan(&project).unwrap().is_none());
}

#[test]
fn rejects_plan_with_unsupported_version() {
    let plan = StoryPlan {
        version: 99,
        prompt: "p".to_string(),
        ..StoryPlan::new("")
    };
    assert_eq!(validate(&plan), Err(PlanError::UnsupportedVersion(99)));
}

#[test]
fn rejects_plan_with_neither_prompt_nor_synopsis() {
    let mut plan = StoryPlan::new("   \n");
    plan.synopsis = "  ".to_string();
    assert_eq!(validate(&plan), Err(PlanError::EmptyPlan));
}

#[test]
fn rejects_outline_with_duplicate_chapter_ids() {
    let mut plan = StoryPlan::new("a brief");
    plan.chapters = vec![
        ChapterPlan {
            id: "ch1".to_string(),
            title: "A".to_string(),
            summary: "s".to_string(),
        },
        ChapterPlan {
            id: "ch1".to_string(),
            title: "B".to_string(),
            summary: "s".to_string(),
        },
    ];
    assert_eq!(
        validate(&plan),
        Err(PlanError::DuplicateChapterId("ch1".to_string()))
    );
}

#[test]
fn refuses_to_save_an_invalid_plan() {
    let project = fresh_project_dir("invalid_save");
    let plan = StoryPlan {
        version: 2,
        prompt: "p".to_string(),
        synopsis: String::new(),
        chapters: Vec::new(),
        scenes: Vec::new(),
        pipeline_runs: Vec::new(),
    };
    let err = save_plan(&project, &plan).unwrap_err();
    assert_eq!(err, PlanError::UnsupportedVersion(2));
    // Nothing should have been written for an invalid plan.
    assert!(!plan_path(&project).exists());
}

#[test]
fn refuses_to_load_a_plan_with_wrong_version() {
    let project = fresh_project_dir("wrong_version_load");
    let path = plan_path(&project);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        &path,
        r#"{"version":7,"prompt":"x","synopsis":"","chapters":[],"pipelineRuns":[]}"#,
    )
    .unwrap();
    assert_eq!(
        load_plan(&project).unwrap_err(),
        PlanError::UnsupportedVersion(7)
    );
}
