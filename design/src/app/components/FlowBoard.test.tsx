import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as React from 'react';
import type { PipelineEvent, RunState } from '../lib/pipeline-types';
import { FlowBoard } from './FlowBoard';

// React Flow's real renderer needs DOM measurements jsdom doesn't provide.
// Mock it as a passthrough that renders each node through its `nodeTypes`
// component, so we test our wiring + StepNode, not the library.
vi.mock('reactflow', () => ({
  default: ({ nodes, nodeTypes, onNodeClick }: { nodes: any[]; nodeTypes: Record<string, any>; onNodeClick?: Function }) =>
    React.createElement(
      'div',
      { 'data-testid': 'reactflow-mock' },
      nodes.map((n) =>
        nodeTypes?.[n.type]
          ? React.createElement(
            'button',
            { key: n.id, 'aria-label': `open-${n.id}`, onClick: (event) => onNodeClick?.(event, n) },
            React.createElement(nodeTypes[n.type], { data: n.data }),
          )
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

function runState(status: RunState['status'] = 'running'): RunState {
  return {
    runId: 'run_1',
    projectPath: '/tmp/proj',
    prompt: 'brief',
    status,
    startedAt: 1,
    updatedAt: 2,
    steps: [
      {
        def: { id: 'plan', kind: 'plan', dependsOn: [], agent: null, prompt: '' },
        status: status === 'completed' ? 'succeeded' : 'pending',
        attempt: status === 'completed' ? 1 : 0,
        output: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
      {
        def: { id: 'outline', kind: 'outline', dependsOn: ['plan'], agent: null, prompt: '' },
        status: status === 'completed' ? 'succeeded' : 'pending',
        attempt: status === 'completed' ? 1 : 0,
        output: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
    ],
  };
}

beforeEach(() => {
  lastListenHandler = null;
  mockedInvoke.mockReset();
  mockedListen.mockReset();
  mockedInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'pipeline_start') return Promise.resolve('run_1' as unknown);
    if (cmd === 'pipeline_get_state') return Promise.resolve(runState() as unknown);
    if (cmd === 'pipeline_list_runs') return Promise.resolve([] as unknown);
    return Promise.resolve(undefined);
  });
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
    await user.click(screen.getByRole('button', { name: '创建流程' }));

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
    expect(screen.getByRole('button', { name: '创建流程' })).toBeDisabled();
  });

  it('prepares a paused flow before the user starts execution', async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'pipeline_start') return Promise.resolve('run_1' as unknown);
      if (cmd === 'pipeline_get_state') return Promise.resolve(runState('paused') as unknown);
      if (cmd === 'pipeline_list_runs') return Promise.resolve([] as unknown);
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    render(<FlowBoard projectPath="/tmp/proj" />);

    await user.type(screen.getByLabelText('production brief'), 'x');
    await user.click(screen.getByRole('button', { name: '创建流程' }));
    await user.click(await screen.findByRole('button', { name: '运行' }));

    expect(mockedInvoke).toHaveBeenCalledWith('pipeline_resume', { runId: 'run_1' });
  });

  it('switches to pause/resume controls while running and paused', async () => {
    const user = userEvent.setup();
    render(<FlowBoard projectPath="/tmp/proj" />);
    await user.type(screen.getByLabelText('production brief'), 'x');
    await user.click(screen.getByRole('button', { name: '创建流程' }));
    await vi.waitFor(() => expect(mockedListen).toHaveBeenCalled());

    emit({ type: 'runStarted', runId: 'run_1' });
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建流程' })).not.toBeInTheDocument();

    emit({ type: 'stepStarted', runId: 'run_1', stepId: 'plan', kind: 'plan' });
    emit({ type: 'runPaused', runId: 'run_1' });
    expect(screen.getByRole('button', { name: '续跑' })).toBeInTheDocument();
  });

  it('hydrates completed state when fast steps finished before event subscription', async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'pipeline_start') return Promise.resolve('run_1' as unknown);
      if (cmd === 'pipeline_get_state') return Promise.resolve(runState('completed') as unknown);
      if (cmd === 'pipeline_list_runs') return Promise.resolve([] as unknown);
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    render(<FlowBoard projectPath="/tmp/proj" />);

    await user.type(screen.getByLabelText('production brief'), 'x');
    await user.click(screen.getByRole('button', { name: '创建流程' }));

    await vi.waitFor(() => expect(screen.getByTestId('flow-run-status')).toHaveTextContent('completed'));
    expect(stepStatus('plan')).toBe('succeeded');
    expect(stepStatus('outline')).toBe('succeeded');
  });

  it('discovers a persisted paused run and resumes it through crash recovery', async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'pipeline_list_runs') return Promise.resolve([runState('paused')] as unknown);
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    render(<FlowBoard projectPath="/tmp/proj" />);

    const resume = await screen.findByRole('button', { name: '续跑' });
    await user.click(resume);

    expect(mockedInvoke).toHaveBeenCalledWith('pipeline_resume_run', {
      projectPath: '/tmp/proj',
      runId: 'run_1',
    });
    expect(mockedInvoke).not.toHaveBeenCalledWith('pipeline_resume', { runId: 'run_1' });
  });

  it('retries a selected failed step with enough context to attach a persisted run', async () => {
    const failed = runState('failed');
    failed.steps[0].status = 'failed';
    failed.steps[0].error = 'boom';
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'pipeline_list_runs') return Promise.resolve([failed] as unknown);
      if (cmd === 'pipeline_get_state') return Promise.resolve(failed as unknown);
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    render(<FlowBoard projectPath="/tmp/proj" />);

    await user.click(await screen.findByRole('button', { name: 'open-plan' }));
    await user.click(screen.getByRole('button', { name: '从此步重跑' }));

    expect(mockedInvoke).toHaveBeenCalledWith('pipeline_retry_step', {
      runId: 'run_1',
      stepId: 'plan',
      projectPath: '/tmp/proj',
    });
  });
});
