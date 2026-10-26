import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SnapshotManagerDialog } from './SnapshotManagerDialog';
import type { SnapshotInfo } from '../lib/webgal-ipc';

const snapshots: SnapshotInfo[] = [
  {
    id: '1000-manual',
    label: '手动检查点',
    createdAt: '1000',
    path: '/tmp/snapshots/1000-manual',
    kind: 'manual',
    includesEditorState: true,
    metadataIncluded: true,
    fileCount: 12,
  },
  {
    id: '2000-candidate',
    label: '候选版本',
    createdAt: '2000',
    path: '/tmp/snapshots/2000-candidate',
    kind: 'exportCandidate',
    includesEditorState: true,
    metadataIncluded: true,
    fileCount: 16,
  },
];

function renderDialog(overrides: Partial<ComponentProps<typeof SnapshotManagerDialog>> = {}) {
  const props: ComponentProps<typeof SnapshotManagerDialog> = {
    open: true,
    snapshots,
    busy: false,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onCreate: vi.fn(),
    onCreateExportCandidate: vi.fn(),
    onRestore: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<SnapshotManagerDialog {...props} />);
  return props;
}

describe('SnapshotManagerDialog', () => {
  it('filters snapshots by kind and query', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(screen.getByLabelText('筛选快照类型'), 'exportCandidate');
    expect(screen.getAllByText('候选版本').length).toBeGreaterThan(0);
    expect(screen.queryByText('手动检查点')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('搜索快照'), 'missing');
    expect(screen.getByText('没有匹配的快照。')).toBeInTheDocument();
  });

  it('creates export candidate snapshots from the quick action', async () => {
    const user = userEvent.setup();
    const onCreateExportCandidate = vi.fn();
    renderDialog({ onCreateExportCandidate });

    await user.click(screen.getByRole('button', { name: '标记候选' }));
    expect(onCreateExportCandidate).toHaveBeenCalledTimes(1);
  });

  it('renames a snapshot inline', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    renderDialog({ onRename });

    await user.click(screen.getAllByRole('button', { name: '重命名' })[0]);
    const input = screen.getByLabelText('编辑快照名称');
    await user.clear(input);
    await user.type(input, '新的快照名');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(onRename).toHaveBeenCalledWith(snapshots[0], '新的快照名');
  });

  it('confirms restore before calling the handler', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    renderDialog({ onRestore });

    await user.click(screen.getAllByRole('button', { name: '回滚' })[0]);
    expect(screen.getByText('确认回滚快照')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onRestore).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole('button', { name: '回滚' })[0]);
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(onRestore).toHaveBeenCalledWith(snapshots[0]);
  });

  it('confirms delete before calling the handler', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderDialog({ onDelete });

    await user.click(screen.getAllByRole('button', { name: '删除' })[1]);
    expect(screen.getByText('确认删除快照')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole('button', { name: '删除' })[1]);
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(onDelete).toHaveBeenCalledWith(snapshots[1]);
  });
});
