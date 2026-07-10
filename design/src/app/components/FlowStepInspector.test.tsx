import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FlowStepView } from '../lib/flow-state';
import { FlowStepInspector } from './FlowStepInspector';

const step: FlowStepView = {
  id: 'outline',
  kind: 'outline',
  status: 'pending',
  dependsOn: ['plan'],
  attempt: 1,
  prompt: '生成故事大纲',
  output: '{"chapters":["第一章"]}',
  error: null,
  startedAt: 10,
  finishedAt: 30,
  history: [{
    attempt: 1,
    inputSnapshot: '{"brief":"校园恋爱"}',
    output: 'plain text fallback',
    startedAt: 10,
    finishedAt: 30,
    durationMs: 20,
    diff: 'synopsis updated',
    cost: 0.02,
    warnings: ['输出经过规范化'],
    downgrade: 'fallback-agent',
  }],
};

describe('FlowStepInspector', () => {
  it('renders nothing without a selected step', () => {
    const { container } = render(
      <FlowStepInspector selected={null} busy={false} detached={false} onClose={vi.fn()} onRetry={vi.fn()} onSkip={vi.fn()} onPromptRerun={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows step data, formatted output, history, and available actions', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onSkip = vi.fn();
    const onPromptRerun = vi.fn();
    render(
      <FlowStepInspector selected={step} busy={false} detached={false} onClose={vi.fn()} onRetry={onRetry} onSkip={onSkip} onPromptRerun={onPromptRerun} />,
    );

    expect(screen.getByRole('complementary', { name: 'outline 步骤检查器' })).toBeInTheDocument();
    expect(screen.getByText('plan')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('outline 步骤 Prompt'));
    await user.type(screen.getByLabelText('outline 步骤 Prompt'), '改成三幕式大纲');
    await user.click(screen.getByRole('button', { name: '保存并重跑' }));
    expect(onPromptRerun).toHaveBeenCalledWith('outline', '改成三幕式大纲');
    await user.click(screen.getByRole('tab', { name: '输出' }));
    expect(screen.getByText(/"chapters": \[/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '记录' }));
    expect(screen.getByText('plain text fallback')).toBeInTheDocument();
    expect(screen.getByText('20 ms')).toBeInTheDocument();
    expect(screen.getByText('synopsis updated')).toBeInTheDocument();
    expect(screen.getByText('输出经过规范化')).toBeInTheDocument();
    expect(screen.getByText('fallback-agent')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '从此步重跑' }));
    await user.click(screen.getByRole('button', { name: '跳过' }));
    expect(onRetry).toHaveBeenCalledWith('outline');
    expect(onSkip).toHaveBeenCalledWith('outline');
  });

  it('hides retry while running and skip on a detached run', () => {
    const { rerender } = render(
      <FlowStepInspector selected={{ ...step, status: 'running' }} busy={false} detached={false} onClose={vi.fn()} onRetry={vi.fn()} onSkip={vi.fn()} onPromptRerun={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: '从此步重跑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '跳过' })).not.toBeInTheDocument();

    rerender(
      <FlowStepInspector selected={step} busy={false} detached onClose={vi.fn()} onRetry={vi.fn()} onSkip={vi.fn()} onPromptRerun={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '从此步重跑' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '跳过' })).not.toBeInTheDocument();
  });
});
