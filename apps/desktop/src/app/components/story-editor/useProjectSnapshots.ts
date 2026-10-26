import { useCallback, useState } from 'react';
import {
  createProjectSnapshot,
  deleteProjectSnapshot,
  listProjectSnapshots,
  renameProjectSnapshot,
  restoreProjectSnapshot,
  type SnapshotInfo,
} from '../../lib/webgal-ipc';

interface ProjectSnapshotsOptions {
  projectPath: string | null;
  ensureSaved: () => Promise<boolean>;
  onRestored: (snapshot: SnapshotInfo) => Promise<void>;
}

export function useProjectSnapshots({
  projectPath,
  ensureSaved,
  onRestored,
}: ProjectSnapshotsOptions) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    try {
      setError(null);
      setSnapshots(await listProjectSnapshots(projectPath));
    } catch (cause) {
      setError(`读取快照失败: ${cause}`);
    }
  }, [projectPath]);

  const openManager = useCallback(() => {
    if (!projectPath) return;
    setError(null);
    setStatus(null);
    setOpen(true);
  }, [projectPath]);

  const run = useCallback(async (operation: () => Promise<void>, label: string) => {
    if (!projectPath || busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(`${label}失败: ${cause}`);
    } finally {
      setBusy(false);
    }
  }, [busy, projectPath, refresh]);

  const create = useCallback(async (label: string, kind: SnapshotInfo['kind'] = 'manual') => {
    await run(async () => {
      if (!(await ensureSaved())) return;
      const snapshot = await createProjectSnapshot(projectPath!, label, kind);
      setStatus(`快照已创建: ${snapshot.label}`);
    }, '创建快照');
  }, [ensureSaved, projectPath, run]);

  const restore = useCallback(async (snapshot: SnapshotInfo) => {
    await run(async () => {
      if (!(await ensureSaved())) return;
      await createProjectSnapshot(
        projectPath!,
        'before-restore',
        'beforeRestore',
        `回滚到"${snapshot.label}"前自动备份`,
      );
      await restoreProjectSnapshot(projectPath!, snapshot.id);
      await onRestored(snapshot);
      setStatus(`已回滚到"${snapshot.label}"，并自动创建 before-restore 备份。`);
    }, '回滚快照');
  }, [ensureSaved, onRestored, projectPath, run]);

  const rename = useCallback(async (snapshot: SnapshotInfo, label: string) => {
    await run(async () => {
      const renamed = await renameProjectSnapshot(projectPath!, snapshot.id, label);
      setStatus(`快照已重命名: ${renamed.label}`);
    }, '重命名快照');
  }, [projectPath, run]);

  const remove = useCallback(async (snapshot: SnapshotInfo) => {
    await run(async () => {
      await deleteProjectSnapshot(projectPath!, snapshot.id);
      setStatus(`快照已删除: ${snapshot.label}`);
    }, '删除快照');
  }, [projectPath, run]);

  const createExportCandidate = useCallback(
    () => create(`candidate-${new Date().toISOString().slice(0, 10)}`, 'exportCandidate'),
    [create],
  );

  return {
    open,
    setOpen,
    snapshots,
    busy,
    error,
    status,
    refresh,
    openManager,
    create,
    restore,
    rename,
    remove,
    createExportCandidate,
  };
}
