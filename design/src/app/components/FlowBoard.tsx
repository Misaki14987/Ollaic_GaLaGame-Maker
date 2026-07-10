import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import ReactFlow, { Background, Controls, type Connection, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { StepNode, type StepNodeData } from './StepNode';
import { initialFlowState, reduceFlowEvent } from '../lib/flow-state';
import {
  listenPipelineEvents,
  pipelineGetState,
  pipelineListRuns,
  pipelinePause,
  pipelineResume,
  pipelineResumeRun,
  pipelineRetryStep,
  pipelineSkipStep,
  pipelineStart,
  pipelineUpdateDependencies,
} from '../lib/pipeline-ipc';
import type { PipelineEvent } from '../lib/pipeline-types';

const NODE_TYPES = { step: StepNode };

export interface FlowBoardProps {
  projectPath: string;
}

export function FlowBoard({ projectPath }: FlowBoardProps) {
  const [state, dispatch] = useReducer(reduceFlowEvent, undefined, initialFlowState);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [detached, setDetached] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef<string | null>(null);

  const subscribe = useCallback(async (runId: string) => {
    unlistenRef.current?.();
    unlistenRef.current = await listenPipelineEvents(runId, (event: PipelineEvent) => {
      dispatch(event);
    });
    runIdRef.current = runId;
  }, []);

  const refresh = useCallback(async (runId: string) => {
    const snapshot = await pipelineGetState(runId);
    if (snapshot) dispatch({ type: 'stateHydrated', state: snapshot });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    pipelineListRuns(projectPath)
      .then(async ([latest]) => {
        if (!latest || cancelled) return;
        dispatch({ type: 'stateHydrated', state: latest });
        setPrompt(latest.prompt);
        runIdRef.current = latest.runId;
        setDetached(true);
        if (latest.status === 'running' || latest.status === 'paused') {
          await subscribe(latest.runId);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [projectPath, subscribe]);

  const start = useCallback(async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSelectedStepId(null);
    dispatch({ type: 'reset' });
    try {
      const runId = await pipelineStart(projectPath, prompt);
      await subscribe(runId);
      setDetached(false);
      await refresh(runId);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, projectPath, refresh, subscribe]);

  const pause = useCallback(async () => {
    if (!runIdRef.current) return;
    setError(null);
    try {
      await pipelinePause(runIdRef.current);
      await refresh(runIdRef.current);
    } catch (err) {
      setError(String(err));
    }
  }, [refresh]);

  const resume = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    setBusy(true);
    setError(null);
    try {
      if (detached) {
        await pipelineResumeRun(projectPath, runId);
        setDetached(false);
      } else {
        await pipelineResume(runId);
      }
      await refresh(runId);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [detached, projectPath, refresh]);

  const retryStep = useCallback(async (stepId: string) => {
    const runId = runIdRef.current;
    if (!runId) return;
    setBusy(true);
    setError(null);
    try {
      await subscribe(runId);
      await pipelineRetryStep(runId, stepId, projectPath);
      setDetached(false);
      await refresh(runId);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [projectPath, refresh, subscribe]);

  const skipStep = useCallback(async (stepId: string) => {
    const runId = runIdRef.current;
    if (!runId) return;
    setBusy(true);
    setError(null);
    try {
      await pipelineSkipStep(runId, stepId);
      await refresh(runId);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const updateDependencies = useCallback(async (stepId: string, dependsOn: string[]) => {
    const runId = runIdRef.current;
    if (!runId) return;
    setError(null);
    try {
      await pipelineUpdateDependencies(runId, stepId, dependsOn);
      await refresh(runId);
    } catch (err) {
      setError(String(err));
    }
  }, [refresh]);

  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const target = state.steps.find((step) => step.id === connection.target);
    if (!target || target.status !== 'pending') return;
    void updateDependencies(target.id, Array.from(new Set([...target.dependsOn, connection.source])));
  }, [state.steps, updateDependencies]);

  const deleteEdges = useCallback((deleted: Edge[]) => {
    const targets = new Set(deleted.map((edge) => edge.target));
    for (const targetId of targets) {
      const target = state.steps.find((step) => step.id === targetId);
      if (!target || target.status !== 'pending') continue;
      const removedSources = new Set(
        deleted.filter((edge) => edge.target === targetId).map((edge) => edge.source),
      );
      void updateDependencies(targetId, target.dependsOn.filter((dependency) => !removedSources.has(dependency)));
    }
  }, [state.steps, updateDependencies]);

  const nodes = useMemo(() => state.steps.map((step, index) => ({
    id: step.id,
    type: 'step',
    position: { x: (index % 2) * 260, y: Math.floor(index / 2) * 180 },
    data: {
      id: step.id,
      kind: step.kind,
      status: step.status,
      selected: step.id === selectedStepId,
    } as StepNodeData,
  })), [selectedStepId, state.steps]);

  const edges = useMemo(() => state.steps.flatMap((step) =>
    step.dependsOn.map((dependency) => ({
      id: `${dependency}-${step.id}`,
      source: dependency,
      target: step.id,
    }))), [state.steps]);

  const selectedStep = state.steps.find((step) => step.id === selectedStepId) ?? null;
  const running = state.runStatus === 'running';
  const paused = state.runStatus === 'paused';
  const recoverable = detached && (running || paused);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border bg-surface-container-low px-3 py-2">
        <Input
          placeholder="题材、风格、篇幅、女主数、语言"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-w-64 max-w-xl flex-1"
          aria-label="production brief"
        />
        {!running && !paused && (
          <Button onClick={start} disabled={busy || !prompt.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            {state.runId ? '新建流程' : '创建流程'}
          </Button>
        )}
        {running && !recoverable && (
          <Button variant="outline" onClick={pause} disabled={busy}>
            <Pause /> 暂停
          </Button>
        )}
        {(paused || recoverable) && (
          <Button onClick={resume} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            {detached || state.steps.some((step) => step.attempt > 0) ? '续跑' : '运行'}
          </Button>
        )}
        <span className="ml-auto font-mono-family text-xs text-muted-foreground" data-testid="flow-run-status">
          {state.runStatus}
        </span>
      </div>
      {error && (
        <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1" data-testid="flow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_event, node: Node) => setSelectedStepId(node.id)}
            onConnect={connect}
            onEdgesDelete={deleteEdges}
            nodesConnectable={paused && !detached}
            edgesReconnectable={false}
            onlyRenderVisibleElements
            fitView
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {selectedStep && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-border bg-surface-container-low p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{selectedStep.id}</h2>
                <p className="text-xs text-muted-foreground">{selectedStep.kind} · {selectedStep.status}</p>
              </div>
              <span className="font-mono-family text-xs text-muted-foreground">#{selectedStep.attempt}</span>
            </div>
            {selectedStep.prompt && (
              <pre className="mb-3 whitespace-pre-wrap border-t border-border pt-3 text-xs">{selectedStep.prompt}</pre>
            )}
            {selectedStep.error && (
              <pre className="mb-3 whitespace-pre-wrap text-xs text-destructive">{selectedStep.error}</pre>
            )}
            {selectedStep.output && (
              <pre className="mb-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{selectedStep.output}</pre>
            )}
            {selectedStep.history.length > 0 && (
              <div className="mb-3 border-t border-border pt-3">
                {selectedStep.history.map((attempt) => (
                  <div key={attempt.attempt} className="mb-2 flex items-start justify-between gap-3 text-xs">
                    <span>#{attempt.attempt}</span>
                    <span className={attempt.error ? 'text-destructive' : 'text-muted-foreground'}>
                      {attempt.error ?? `${attempt.durationMs ?? 0} ms`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {selectedStep.status !== 'running' && (
                <Button size="sm" variant="outline" onClick={() => retryStep(selectedStep.id)} disabled={busy}>
                  <RotateCcw /> 从此步重跑
                </Button>
              )}
              {selectedStep.status === 'pending' && !detached && (
                <Button size="sm" variant="outline" onClick={() => skipStep(selectedStep.id)} disabled={busy}>
                  <SkipForward /> 跳过
                </Button>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
