import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectSnapshot, listProjectSnapshots } from '../../lib/webgal-ipc';
import { useProjectSnapshots } from './useProjectSnapshots';

vi.mock('../../lib/webgal-ipc', () => ({
  createProjectSnapshot: vi.fn(),
  deleteProjectSnapshot: vi.fn(),
  listProjectSnapshots: vi.fn(),
  renameProjectSnapshot: vi.fn(),
  restoreProjectSnapshot: vi.fn(),
}));

describe('useProjectSnapshots', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves before creating and refreshes the list', async () => {
    const ensureSaved = vi.fn().mockResolvedValue(true);
    vi.mocked(createProjectSnapshot).mockResolvedValue({ id: '1', label: 'checkpoint' } as never);
    vi.mocked(listProjectSnapshots).mockResolvedValue([]);
    const { result } = renderHook(() => useProjectSnapshots({
      projectPath: '/project',
      ensureSaved,
      onRestored: vi.fn(),
    }));

    await act(() => result.current.create('checkpoint'));
    expect(ensureSaved).toHaveBeenCalledOnce();
    expect(createProjectSnapshot).toHaveBeenCalledWith('/project', 'checkpoint', 'manual');
    expect(listProjectSnapshots).toHaveBeenCalledWith('/project');
  });
});
