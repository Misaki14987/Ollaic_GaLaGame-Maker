import { describe, expect, it } from 'vitest';
import { initialFlowState, reduceFlowEvent } from './flow-state';
import type { PipelineEvent } from './pipeline-types';

const ev = (e: PipelineEvent) => e;

describe('flow-state reducer', () => {
  it('starts with the default recipe pending and the run idle', () => {
    const s = initialFlowState();
    expect(s.runStatus).toBe('idle');
    expect(s.runId).toBeNull();
    expect(s.steps.map((x) => x.id)).toEqual(['plan', 'outline']);
    expect(s.steps.every((x) => x.status === 'pending')).toBe(true);
  });

  it('runs the two-step recipe in order and completes', () => {
    let s = initialFlowState();
    s = reduceFlowEvent(s, ev({ type: 'runStarted', runId: 'run_1' }));
    expect(s.runId).toBe('run_1');
    expect(s.runStatus).toBe('running');

    s = reduceFlowEvent(s, ev({ type: 'stepStarted', runId: 'run_1', stepId: 'plan', kind: 'plan' }));
    expect(statusOf(s, 'plan')).toBe('running');

    s = reduceFlowEvent(s, ev({ type: 'stepSucceeded', runId: 'run_1', stepId: 'plan', output: null }));
    expect(statusOf(s, 'plan')).toBe('succeeded');

    s = reduceFlowEvent(s, ev({ type: 'stepStarted', runId: 'run_1', stepId: 'outline', kind: 'outline' }));
    expect(statusOf(s, 'outline')).toBe('running');

    s = reduceFlowEvent(s, ev({ type: 'stepSucceeded', runId: 'run_1', stepId: 'outline', output: null }));
    expect(statusOf(s, 'outline')).toBe('succeeded');

    s = reduceFlowEvent(s, ev({ type: 'runCompleted', runId: 'run_1' }));
    expect(s.runStatus).toBe('completed');
  });

  it('marks a step failed and the run failed', () => {
    let s = initialFlowState();
    s = reduceFlowEvent(s, ev({ type: 'runStarted', runId: 'run_1' }));
    s = reduceFlowEvent(s, ev({ type: 'stepStarted', runId: 'run_1', stepId: 'plan', kind: 'plan' }));
    s = reduceFlowEvent(s, ev({ type: 'stepFailed', runId: 'run_1', stepId: 'plan', error: 'boom' }));
    expect(statusOf(s, 'plan')).toBe('failed');
    s = reduceFlowEvent(s, ev({ type: 'runFailed', runId: 'run_1', error: 'boom' }));
    expect(s.runStatus).toBe('failed');
    // Downstream outline was never started.
    expect(statusOf(s, 'outline')).toBe('pending');
  });

  it('pauses and resumes', () => {
    let s = initialFlowState();
    s = reduceFlowEvent(s, ev({ type: 'runStarted', runId: 'run_1' }));
    s = reduceFlowEvent(s, ev({ type: 'runPaused', runId: 'run_1' }));
    expect(s.runStatus).toBe('paused');
    s = reduceFlowEvent(s, ev({ type: 'runResumed', runId: 'run_1' }));
    expect(s.runStatus).toBe('running');
  });

  it('skips a step', () => {
    let s = initialFlowState();
    s = reduceFlowEvent(s, ev({ type: 'runStarted', runId: 'run_1' }));
    s = reduceFlowEvent(s, ev({ type: 'stepSkipped', runId: 'run_1', stepId: 'plan' }));
    expect(statusOf(s, 'plan')).toBe('skipped');
  });

  it('ignores events from a different run once bound', () => {
    let s = initialFlowState();
    s = reduceFlowEvent(s, ev({ type: 'runStarted', runId: 'run_1' }));
    s = reduceFlowEvent(s, ev({ type: 'stepStarted', runId: 'run_other', stepId: 'plan', kind: 'plan' }));
    expect(statusOf(s, 'plan')).toBe('pending');
  });
});

function statusOf(state: ReturnType<typeof initialFlowState>, id: string) {
  return state.steps.find((s) => s.id === id)?.status;
}
