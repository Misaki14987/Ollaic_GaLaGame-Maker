/**
 * Pure event->state reducer for the FlowBoard. This is the testable behavior
 * core: how pipeline events map to step/run statuses. The React Flow canvas
 * is presentation on top of this state.
 */

import type { PipelineEvent, RunState, RunStatus, StepStatus } from './pipeline-types';

export interface FlowStepView {
  id: string;
  kind: string;
  status: StepStatus;
  dependsOn: string[];
  attempt: number;
  prompt: string;
  output: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface FlowState {
  runId: string | null;
  runStatus: RunStatus;
  steps: FlowStepView[];
}

/** The built-in recipe: Plan -> Memory -> Outline -> Scene. */
export const DEFAULT_RECIPE_STEPS: ReadonlyArray<{ id: string; kind: string; dependsOn: string[] }> = [
  { id: 'plan', kind: 'plan', dependsOn: [] },
  { id: 'memory', kind: 'memory', dependsOn: ['plan'] },
  { id: 'outline', kind: 'outline', dependsOn: ['memory'] },
  { id: 'scene', kind: 'scene', dependsOn: ['outline'] },
];

export function initialFlowState(): FlowState {
  return {
    runId: null,
    runStatus: 'idle',
    steps: DEFAULT_RECIPE_STEPS.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: 'pending' as StepStatus,
      dependsOn: s.dependsOn,
      attempt: 0,
      prompt: '',
      output: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    })),
  };
}

export type FlowAction = PipelineEvent
  | { type: 'stateHydrated'; state: RunState }
  | { type: 'reset' };

export function reduceFlowEvent(state: FlowState, event: FlowAction): FlowState {
  if (event.type === 'stateHydrated') {
    return {
      runId: event.state.runId,
      runStatus: event.state.status,
      steps: event.state.steps.map((step) => ({
        id: step.def.id,
        kind: step.def.kind,
        status: step.status,
        dependsOn: step.def.dependsOn,
        attempt: step.attempt,
        prompt: step.def.prompt,
        output: step.output ?? null,
        error: step.error ?? null,
        startedAt: step.startedAt ?? null,
        finishedAt: step.finishedAt ?? null,
      })),
    };
  }
  if (event.type === 'reset') return initialFlowState();
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
      return {
        ...state,
        steps: setStep(state.steps, event.stepId, 'succeeded', { output: event.output }),
      };
    case 'stepFailed':
      return {
        ...state,
        steps: setStep(state.steps, event.stepId, 'failed', { error: event.error }),
      };
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
  patch: Partial<FlowStepView> = {},
): FlowStepView[] {
  return steps.map((s) => (s.id === id ? { ...s, status, ...patch } : s));
}
