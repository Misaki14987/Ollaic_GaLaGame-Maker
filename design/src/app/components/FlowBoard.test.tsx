import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as React from 'react';
import type { PipelineEvent } from '../lib/pipeline-types';
import { FlowBoard } from './FlowBoard';

// React Flow's real renderer needs DOM measurements jsdom doesn't provide.
// Mock it as a passthrough that renders each node through its `nodeTypes`
// component, so we test our wiring + StepNode, not the library.
vi.mock('reactflow', () => ({
  default: ({ nodes, nodeTypes }: { nodes: any[]; nodeTypes: Record<string, any> }) =>
    React.createElement(
      'div',
      { 'data-testid': 'reactflow-mock' },
      nodes.map((n) =>
        nodeTypes?.[n.type]
          ? React.createElement(nodeTypes[n.type], { key: n.id, data: n.data })
          : null,
      ),
    ),
  Handle: () => null,
  Background: () => null,
  Controls: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

let lastListenHandler: ((event: { payload: PipelineEvent }) => void) | null = null;

beforeEach(() => {
  lastListenHandler = null;
  mockedInvoke.mockReset();
  mockedListen.mockReset();
  mockedInvoke.mockImplementation((cmd: string) =>
    Promise.resolve(cmd === 'pipeline_start' ? ('run_1' as unknown) : undefined),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedListen.mockImplementation((_channel: string, handler: any) => {
    lastListenHandler = handler as typeof lastListenHandler;
    return Promise.resolve((() => {}) as unknown as ReturnType<typeof listen>);
  });
});

function emit(event: PipelineEvent) {
  // The listen callback fires outside a React event handler; wrap in act so
  // the dispatched state update flushes before the next assertion.
  act(() => {
    lastListenHandler?.({ payload: event });
  });
}

function stepStatus(id: string): string | null {
  return document.querySelector(`[data-step-id="${id}"]`)?.getAttribute('data-step-status') ?? null;
}

describe('FlowBoard', () => {
  it('starts a run and updates step statuses from streamed events', async () => {
    const user = userEvent.setup();
    render(<FlowBoard projectPath="/tmp/proj" />);

    await user.type(screen.getByLabelText('production brief'), '赛博朋克校园恋爱');
    await user.click(screen.getByRole('button', { name: '运行' }));

    // pipeline_start was invoked with the brief; an event subscription opened.
    await vi.waitFor(() => expect(mockedListen).toHaveBeenCalled());
    expect(mockedInvoke).toHaveBeenCalledWith('pipeline_start', {
      projectPath: '/tmp/proj',
      prompt: '赛博朋克校园恋爱',
    });
    expect(mockedListen).toHaveBeenCalledWith('pipeline:run_1', expect.any(Function));

    // Initially both steps are pending.
    expect(stepStatus('plan')).toBe('pending');
    expect(stepStatus('outline')).toBe('pending');

    // Stream the happy path: plan runs and succeeds, then outline, then done.
    emit({ type: 'runStarted', runId: 'run_1' });
    emit({ type: 'stepStarted', runId: 'run_1', stepId: 'plan', kind: 'plan' });
    expect(stepStatus('plan')).toBe('running');

    emit({ type: 'stepSucceeded', runId: 'run_1', stepId: 'plan', output: null });
    expect(stepStatus('plan')).toBe('succeeded');

    emit({ type: 'stepStarted', runId: 'run_1', stepId: 'outline', kind: 'outline' });
    emit({ type: 'stepSucceeded', runId: 'run_1', stepId: 'outline', output: null });
    expect(stepStatus('outline')).toBe('succeeded');

    emit({ type: 'runCompleted', runId: 'run_1' });
    expect(screen.getByTestId('flow-run-status').textContent).toBe('completed');
  });

  it('disables run while the brief is empty', () => {
    render(<FlowBoard projectPath="/tmp/proj" />);
    expect(screen.getByRole('button', { name: '运行' })).toBeDisabled();
  });

  it('switches to pause/resume controls while running and paused', async () => {
    const user = userEvent.setup();
    render(<FlowBoard projectPath="/tmp/proj" />);
    await user.type(screen.getByLabelText('production brief'), 'x');
    await user.click(screen.getByRole('button', { name: '运行' }));
    await vi.waitFor(() => expect(mockedListen).toHaveBeenCalled());

    emit({ type: 'runStarted', runId: 'run_1' });
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行' })).not.toBeInTheDocument();

    emit({ type: 'runPaused', runId: 'run_1' });
    expect(screen.getByRole('button', { name: '续跑' })).toBeInTheDocument();
  });
});
