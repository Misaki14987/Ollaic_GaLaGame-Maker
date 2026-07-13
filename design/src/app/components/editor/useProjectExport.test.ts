import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { exportProject, saveProjectMetadata } from '@/app/lib/webgal-ipc';
import { useProjectExport } from '@/app/components/editor/useProjectExport';

vi.mock('../../lib/webgal-ipc', () => ({
  exportProject: vi.fn(),
  readProjectMetadata: vi.fn().mockResolvedValue(null),
  saveProjectMetadata: vi.fn(),
}));

describe('useProjectExport', () => {
  it('saves the document and metadata before exporting', async () => {
    const ensureSaved = vi.fn().mockResolvedValue(true);
    vi.mocked(exportProject).mockResolvedValue({
      success: true,
      warnings: [],
      outputPath: '/release/game.zip',
    });
    const { result } = renderHook(() =>
      useProjectExport({
        projectPath: '/project',
        ensureSaved,
      }),
    );
    const metadata = {
      synopsis: '',
      description: '',
      coverPath: '',
      tags: [],
      version: '0.1.0',
      releaseNotes: '',
      lastExportDir: '',
    };

    await act(() => result.current.exportWithMetadata(metadata, '/release', true));
    expect(ensureSaved).toHaveBeenCalledOnce();
    expect(saveProjectMetadata).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({ lastExportDir: '/release' }),
    );
    expect(exportProject).toHaveBeenCalledOnce();
    expect(result.current.task.status).toBe('succeeded');
  });
});
