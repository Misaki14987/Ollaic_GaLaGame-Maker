import { useEffect, useState } from 'react';
import { FlowBoard } from './FlowBoard';
import { Button } from './ui/button';
import { Input } from './ui/input';

const STORAGE_KEY = 'flow-project-path';

/**
 * Thin page wrapper for the V2 FlowBoard: lets the user point at a project
 * directory (persisted in localStorage) and then drive its Agent Flow.
 * Eventually the FlowBoard becomes the project first screen; for the P0
 * shell this dedicated route is enough.
 */
export function FlowBoardPage() {
  const [projectPath, setProjectPath] = useState('');
  const [committed, setCommitted] = useState('');

  useEffect(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      setProjectPath(saved);
      setCommitted(saved);
    }
  }, []);

  const commit = () => {
    const trimmed = projectPath.trim();
    if (!trimmed) return;
    setCommitted(trimmed);
    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      // ignore storage errors
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-3">
        <span className="text-sm text-muted-foreground">项目目录</span>
        <Input
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
          placeholder="/path/to/webgal/project"
          className="max-w-md"
          aria-label="project path"
        />
        <Button onClick={commit} disabled={!projectPath.trim()}>
          打开
        </Button>
      </div>
      {committed ? (
        <div className="min-h-0 flex-1">
          <FlowBoard projectPath={committed} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          输入一个项目目录以开始 Agent Flow。
        </div>
      )}
    </div>
  );
}
