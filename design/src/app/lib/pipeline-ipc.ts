/**
 * Frontend IPC layer for the V2 Pipeline. Wraps Tauri invoke calls to the
 * Rust backend (`src-tauri/src/pipeline/commands.rs`) and the per-run event
 * channel `pipeline:{runId}` (ADR 0055). Command args use camelCase (Tauri
 * convention); return types mirror `pipeline-types.ts`.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PipelineEvent, RunState, StoryPlan } from './pipeline-types';

/** Start an Agent Flow for a project. Returns the new run id. */
export async function pipelineStart(projectPath: string, prompt: string): Promise<string> {
  return invoke<string>('pipeline_start', { projectPath, prompt });
}

/** Pause a live (in-memory) run before the next step. */
export async function pipelinePause(runId: string): Promise<void> {
  return invoke<void>('pipeline_pause', { runId });
}

/** Resume an in-memory paused run. */
export async function pipelineResume(runId: string): Promise<void> {
  return invoke<void>('pipeline_resume', { runId });
}

/** Crash-recovery: reload a persisted run from disk and drive it. Use this on
 * app start for any non-terminal `.ollaic/pipeline/*.json`, not `pipelineResume`. */
export async function pipelineResumeRun(projectPath: string, runId: string): Promise<void> {
  return invoke<void>('pipeline_resume_run', { projectPath, runId });
}

/** Re-run a step (resets it to pending and, if the run was failed, restarts it). */
export async function pipelineRetryStep(runId: string, stepId: string, projectPath: string): Promise<void> {
  return invoke<void>('pipeline_retry_step', { runId, stepId, projectPath });
}

/** Skip a pending step; downstream steps whose only dep is it become ready. */
export async function pipelineSkipStep(runId: string, stepId: string): Promise<void> {
  return invoke<void>('pipeline_skip_step', { runId, stepId });
}

export async function pipelineUpdateDependencies(
  runId: string,
  stepId: string,
  dependsOn: string[],
): Promise<void> {
  return invoke<void>('pipeline_update_dependencies', { runId, stepId, dependsOn });
}

/** Snapshot of a run's current state. */
export async function pipelineGetState(runId: string): Promise<RunState | null> {
  return invoke<RunState | null>('pipeline_get_state', { runId });
}

/** The project's StoryPlan (`.ollaic/plan.json`), if one exists. */
export async function pipelineGetPlan(projectPath: string): Promise<StoryPlan | null> {
  return invoke<StoryPlan | null>('pipeline_get_plan', { projectPath });
}

/** Persisted runs for a project, newest first. */
export async function pipelineListRuns(projectPath: string): Promise<RunState[]> {
  return invoke<RunState[]>('pipeline_list_runs', { projectPath });
}

/** Subscribe to `pipeline:{runId}` events. Returns an unlisten function. */
export async function listenPipelineEvents(
  runId: string,
  handler: (event: PipelineEvent) => void,
): Promise<UnlistenFn> {
  return listen<PipelineEvent>(`pipeline:${runId}`, (event) => handler(event.payload));
}
