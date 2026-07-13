import { describe, expect, it } from 'vitest';
import type { FlowStepView } from '@/app/lib/flow-state';
import {
  flowLayoutStorageKey,
  layoutFlowSteps,
  loadFlowPositions,
  saveFlowPositions,
} from '@/app/lib/flow-layout';

const step = (id: string, dependsOn: string[] = []): FlowStepView => ({
  id,
  kind: id,
  agent: null,
  dependsOn,
  status: 'pending',
  attempt: 0,
  prompt: '',
  output: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  history: [],
});

describe('flow layout', () => {
  it('lays dependency levels out from left to right with stable branch rows', () => {
    const positions = layoutFlowSteps([
      step('plan'),
      step('characters', ['plan']),
      step('outline', ['plan']),
      step('scene', ['characters', 'outline']),
    ]);

    expect(positions).toEqual({
      plan: { x: 0, y: 0 },
      characters: { x: 300, y: 0 },
      outline: { x: 300, y: 160 },
      scene: { x: 600, y: 0 },
    });
  });

  it('preserves valid user positions and replaces invalid saved positions', () => {
    const positions = layoutFlowSteps([step('plan'), step('outline', ['plan'])], {
      plan: { x: 42, y: 84 },
      outline: { x: Number.NaN, y: 2 },
    });

    expect(positions.plan).toEqual({ x: 42, y: 84 });
    expect(positions.outline).toEqual({ x: 300, y: 0 });
  });
});

describe('flow layout storage', () => {
  it('uses project and run specific keys and round-trips positions', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    saveFlowPositions('/project one', 'run/1', { plan: { x: 10, y: 20 } }, storage);

    expect(flowLayoutStorageKey('/project one', 'run/1')).not.toBe(
      flowLayoutStorageKey('/project one', 'run/2'),
    );
    expect(loadFlowPositions('/project one', 'run/1', storage)).toEqual({
      plan: { x: 10, y: 20 },
    });
  });

  it('tolerates corrupt storage and discards malformed coordinates', () => {
    expect(loadFlowPositions('/project', 'run', { getItem: () => '{broken' })).toEqual({});
    expect(
      loadFlowPositions('/project', 'run', {
        getItem: () =>
          JSON.stringify({
            plan: { x: 1, y: 2 },
            bad: { x: 'left', y: 2 },
          }),
      }),
    ).toEqual({ plan: { x: 1, y: 2 } });
  });
});
