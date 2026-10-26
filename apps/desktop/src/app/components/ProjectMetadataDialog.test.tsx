import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectMetadataDialog, type ExportTaskState } from './ProjectMetadataDialog';
import type { ProjectMetadata } from '../lib/webgal-ipc';

const metadata: ProjectMetadata = {
  synopsis: '故事摘要',
  description: '项目简介',
  coverPath: '',
  tags: ['悬疑'],
  version: '0.1.0',
  releaseNotes: '初版',
  lastExportDir: '/tmp/export',
};

function renderDialog(overrides: Partial<ComponentProps<typeof ProjectMetadataDialog>> = {}) {
  const props: ComponentProps<typeof ProjectMetadataDialog> = {
    open: true,
    projectName: '测试项目',
    initialMetadata: metadata,
    saving: false,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onExport: vi.fn(),
    onRetryExport: vi.fn(),
    ...overrides,
  };
  render(<ProjectMetadataDialog {...props} />);
  return props;
}

describe('ProjectMetadataDialog', () => {
  it('passes normalized metadata, output directory, and zip flag when exporting', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    renderDialog({ onExport });

    await user.click(screen.getByLabelText('同时打包为 zip 文件'));
    await user.click(screen.getByRole('button', { name: '导出项目' }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        version: '0.1.0',
        tags: ['悬疑'],
      }),
      '/tmp/export',
      true,
    );
  });

  it('disables export while output directory is empty', () => {
    renderDialog({
      initialMetadata: {
        ...metadata,
        lastExportDir: '',
      },
    });

    expect(screen.getByRole('button', { name: '导出项目' })).toBeDisabled();
  });

  it('shows failed export details and retries through callback', async () => {
    const user = userEvent.setup();
    const onRetryExport = vi.fn();
    const exportTask: ExportTaskState = {
      status: 'failed',
      warnings: ['素材缺失'],
      issues: [
        {
          level: 'error',
          code: 'missing_config',
          message: '缺少 config.txt',
          path: 'game/config.txt',
        },
      ],
      error: '导出校验未通过',
      failureCount: 2,
    };

    renderDialog({ exportTask, onRetryExport });

    expect(screen.getByText('导出失败（第 2 次）')).toBeInTheDocument();
    expect(screen.getByText('导出校验未通过')).toBeInTheDocument();
    expect(screen.getByText(/缺少 config\.txt/)).toBeInTheDocument();
    expect(screen.getByText(/素材缺失/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetryExport).toHaveBeenCalledTimes(1);
  });

  it('shows succeeded export output and warnings', () => {
    const exportTask: ExportTaskState = {
      status: 'succeeded',
      outputPath: '/tmp/export/game.zip',
      warnings: ['引用不存在的素材'],
      issues: [],
      failureCount: 0,
    };

    renderDialog({ exportTask });

    expect(screen.getByText('导出成功')).toBeInTheDocument();
    expect(screen.getByText('/tmp/export/game.zip')).toBeInTheDocument();
    expect(screen.getByText(/引用不存在的素材/)).toBeInTheDocument();
  });
});
