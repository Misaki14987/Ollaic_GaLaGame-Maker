/**
 * Pure event->state reducer for the FlowBoard. This is the testable behavior
 * core: how pipeline events map to step/run statuses. The React Flow canvas
 * is presentation on top of this state.
 */

import type { PipelineEvent, RunStatus, StepStatus } from './pipeline-types';

export interface FlowStepView {
  id: string;
  kind: string;
  status: StepStatus;
}

export interface FlowState {
  runId: string | null;
  runStatus: RunStatus;
  steps: FlowStepView[];
}

/** The P0 built-in recipe: Plan -> Outline. */
export const DEFAULT_RECIPE_STEPS: ReadonlyArray<{ id: string; kind: string }> = [
  { id: 'plan', kind: 'plan' },
  { id: 'outline', kind: 'outline' },
];

export function initialFlowState(): FlowState {
  return {
    runId: null,
    runStatus: 'idle',
    steps: DEFAULT_RECIPE_STEPS.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: 'pending' as StepStatus,
    })),
  };
}

export function reduceFlowEvent(state: FlowState, event: PipelineEvent): FlowState {
  // Once bound to a run, ignore events from a different run.
  if (state.runId !== null && event.runId !== state.runId) {
    return state;
  }
  switch (event.type) {
    case 'runStarted':
      return { ...state, runId: event.runId, runStatus: 'running' };
    case 'stepStarted':
      return {
        ...state,
        runStatus: 'running',
        steps: setStep(state.steps, event.stepId, 'running'),
      };
    case 'stepSucceeded':
      return { ...state, steps: setStep(state.steps, event.stepId, 'succeeded') };
    case 'stepFailed':
      return { ...state, steps: setStep(state.steps, event.stepId, 'failed') };
    case 'stepSkipped':
      return { ...state, steps: setStep(state.steps, event.stepId, 'skipped') };
    case 'runPaused':
      return { ...state, runStatus: 'paused' };
    case 'runResumed':
      return { ...state, runStatus: 'running' };
    case 'runCompleted':
      return { ...state, runStatus: 'completed' };
    case 'runFailed':
      return { ...state, runStatus: 'failed' };
    default:
      return state;
  }
}

function setStep(
  steps: FlowStepView[],
  id: string,
  status: StepStatus,
): FlowStepView[] {
  return steps.map((s) => (s.id === id ? { ...s, status } : s));
}
