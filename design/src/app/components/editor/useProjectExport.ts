import { useCallback, useEffect, useRef, useState } from 'react';
import {
  exportProject,
  readProjectMetadata,
  saveProjectMetadata,
  type ProjectMetadata,
} from '@/app/lib/webgal/webgal-ipc';
import type { ExportTaskState } from '@/app/components/project/ProjectMetadataDialog';

const EMPTY_METADATA: ProjectMetadata = {
  synopsis: '',
  description: '',
  coverPath: '',
  tags: [],
  version: '0.1.0',
  releaseNotes: '',
  lastExportDir: '',
};

const IDLE_TASK: ExportTaskState = {
  status: 'idle',
  warnings: [],
  issues: [],
  failureCount: 0,
};

interface ProjectExportOptions {
  projectPath: string | null;
  ensureSaved: () => Promise<boolean>;
}

export function useProjectExport({ projectPath, ensureSaved }: ProjectExportOptions) {
  const [open, setOpen] = useState(false);
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [saving, setSaving] = useState(false);
  const [task, setTask] = useState<ExportTaskState>(IDLE_TASK);
  const lastPayloadRef = useRef<{
    metadata: ProjectMetadata;
    outputDir: string;
    asZip: boolean;
  } | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setMetadata(null);
      return;
    }
    readProjectMetadata(projectPath)
      .then((value) => setMetadata(value ?? EMPTY_METADATA))
      .catch(() => setMetadata(EMPTY_METADATA));
  }, [projectPath]);

  const saveMetadata = useCallback(
    async (next: ProjectMetadata) => {
      if (!projectPath) return;
      setSaving(true);
      try {
        await saveProjectMetadata(projectPath, next);
        setMetadata(next);
      } finally {
        setSaving(false);
      }
    },
    [projectPath],
  );

  const exportWithMetadata = useCallback(
    async (next: ProjectMetadata, outputDir: string, asZip: boolean) => {
      if (!projectPath) return;
      const failureCount = task.status === 'failed' ? task.failureCount : 0;
      lastPayloadRef.current = { metadata: next, outputDir, asZip };
      try {
        if (!(await ensureSaved())) return;
        const payload = { ...next, lastExportDir: outputDir };
        lastPayloadRef.current = { metadata: payload, outputDir, asZip };
        setTask({
          status: 'savingMetadata',
          warnings: [],
          issues: [],
          failureCount,
        });
        await saveProjectMetadata(projectPath, payload);
        setMetadata(payload);
        setTask({
          status: 'exporting',
          warnings: [],
          issues: [],
          failureCount,
        });
        const result = await exportProject(projectPath, outputDir, asZip, payload);
        setTask(
          result.success
            ? {
                status: 'succeeded',
                outputPath: result.outputPath || outputDir,
                warnings: result.warnings ?? [],
                issues: result.issues ?? [],
                failureCount: 0,
              }
            : {
                status: 'failed',
                warnings: result.warnings ?? [],
                issues: result.issues ?? [],
                error: '导出校验未通过，请处理错误后重试。',
                failureCount: failureCount + 1,
              },
        );
      } catch (cause) {
        setTask((previous) => ({
          status: 'failed',
          warnings: previous.warnings ?? [],
          issues: previous.issues ?? [],
          error: String(cause),
          failureCount: previous.failureCount + 1,
        }));
      }
    },
    [ensureSaved, projectPath, task.failureCount, task.status],
  );

  const retry = useCallback(async () => {
    const payload = lastPayloadRef.current;
    if (payload) await exportWithMetadata(payload.metadata, payload.outputDir, payload.asZip);
  }, [exportWithMetadata]);

  const openDialog = useCallback(() => {
    if (!projectPath) return;
    setTask(IDLE_TASK);
    setOpen(true);
  }, [projectPath]);

  return {
    open,
    setOpen,
    metadata,
    saving,
    task,
    saveMetadata,
    exportWithMetadata,
    retry,
    openDialog,
  };
}
