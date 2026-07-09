import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { StepNode, type StepNodeData } from './StepNode';
import { initialFlowState, reduceFlowEvent } from '../lib/flow-state';
import {
  listenPipelineEvents,
  pipelinePause,
  pipelineResume,
  pipelineStart,
} from '../lib/pipeline-ipc';
import type { PipelineEvent } from '../lib/pipeline-types';

// nodeTypes must be stable across renders (React Flow requirement).
const NODE_TYPES = { step: StepNode };

export interface FlowBoardProps {
  projectPath: string;
}

export function FlowBoard({ projectPath }: FlowBoardProps) {
  const [state, dispatch] = useReducer(reduceFlowEvent, undefined, initialFlowState);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef<string | null>(null);

  // Unsubscribe on unmount.
  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const start = useCallback(async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const runId = await pipelineStart(projectPath, prompt);
      runIdRef.current = runId;
      const unlisten = await listenPipelineEvents(runId, (event: PipelineEvent) => dispatch(event));
      unlistenRef.current = typeof unlisten === 'function' ? unlisten : null;
    } catch (err) {
      console.error('[FlowBoard] failed to start pipeline:', err);
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, projectPath]);

  const pause = useCallback(async () => {
    if (runIdRef.current) await pipelinePause(runIdRef.current);
  }, []);

  const resume = useCallback(async () => {
    if (runIdRef.current) await pipelineResume(runIdRef.current);
  }, []);

  const nodes = state.steps.map((step, index) => ({
    id: step.id,
    type: 'step',
    position: { x: 0, y: index * 170 },
    data: { id: step.id, kind: step.kind, status: step.status } as StepNodeData,
  }));

  const edges = state.steps.slice(1).map((step, index) => ({
    id: `${state.steps[index].id}-${step.id}`,
    source: state.steps[index].id,
    target: step.id,
  }));

  const running = state.runStatus === 'running';
  const paused = state.runStatus === 'paused';

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Input
          placeholder="输入题材 / 风格 / 篇幅 / 女主数 / 语言…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="max-w-md"
          aria-label="production brief"
        />
        {!running && !paused && (
          <Button onClick={start} disabled={busy || !prompt.trim()}>
            {busy ? '启动中…' : '运行'}
          </Button>
        )}
        {running && (
          <Button variant="outline" onClick={pause}>
            暂停
          </Button>
        )}
        {paused && <Button onClick={resume}>续跑</Button>}
        <span className="ml-auto text-sm text-muted-foreground" data-testid="flow-run-status">
          {state.runStatus}
        </span>
      </div>
      <div className="flex-1" data-testid="flow-canvas">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} fitView>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
