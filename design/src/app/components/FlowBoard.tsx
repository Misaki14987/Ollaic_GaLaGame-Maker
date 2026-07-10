import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AlertCircle,
  Clock3,
  FileText,
  GitBranch,
  Hash,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  StepForward,
} from 'lucide-react';
import ReactFlow, {
  Background,
  Controls,
  type Connection,
  type Edge,
  type Node,
  type NodeDragHandler,
  type ReactFlowInstance,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { FlowStepInspector } from './FlowStepInspector';
import { PipelineEventLedger, type PipelineEventRecord } from './PipelineEventLedger';
import { StepNode, type StepNodeData } from './StepNode';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Progress } from './ui/progress';
import { initialFlowState, reduceFlowEvent } from '../lib/flow-state';
import { layoutFlowSteps, loadFlowPositions, saveFlowPositions } from '../lib/flow-layout';
import {
  listenPipelineEvents,
  pipelineGetPlan,
  pipelineGetState,
  pipelineListRuns,
  pipelinePause,
  pipelineResume,
  pipelineResumeRun,
  pipelineRetryStep,
  pipelineSkipStep,
  pipelineStart,
  pipelineStepOnce,
  pipelineStop,
  pipelineUpdateDependencies,
  pipelineUpdateStepPrompt,
} from '../lib/pipeline-ipc';
import type { PipelineEvent, RunState, RunStatus, StoryPlan } from '../lib/pipeline-types';

const NODE_TYPES = { step: StepNode };

const RUN_STATUS: Record<RunStatus, string> = {
  idle: '待创建',
  running: '生产中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
};

export interface FlowBoardProps {
  projectPath: string;
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function recordsFromSnapshot(snapshot: RunState): PipelineEventRecord[] {
  const events: PipelineEventRecord[] = [{
    event: { type: 'runStarted', runId: snapshot.runId },
    receivedAt: snapshot.startedAt,
  }];

  for (const step of snapshot.steps) {
    if (step.startedAt != null) {
      events.push({
        event: { type: 'stepStarted', runId: snapshot.runId, stepId: step.def.id, kind: step.def.kind },
        receivedAt: step.startedAt,
      });
    }
    if (step.status === 'succeeded') {
      events.push({
        event: { type: 'stepSucceeded', runId: snapshot.runId, stepId: step.def.id, output: step.output ?? null },
        receivedAt: step.finishedAt ?? snapshot.updatedAt,
      });
    } else if (step.status === 'failed') {
      events.push({
        event: { type: 'stepFailed', runId: snapshot.runId, stepId: step.def.id, error: step.error ?? '未知错误' },
        receivedAt: step.finishedAt ?? snapshot.updatedAt,
      });
    } else if (step.status === 'skipped') {
      events.push({
        event: { type: 'stepSkipped', runId: snapshot.runId, stepId: step.def.id },
        receivedAt: step.finishedAt ?? snapshot.updatedAt,
      });
    }
  }

  const terminalEvent: PipelineEvent | null = snapshot.status === 'completed'
    ? { type: 'runCompleted', runId: snapshot.runId }
    : snapshot.status === 'failed'
      ? { type: 'runFailed', runId: snapshot.runId, error: snapshot.steps.find((step) => step.error)?.error ?? '流程失败' }
      : snapshot.status === 'cancelled'
        ? { type: 'runStopped', runId: snapshot.runId }
        : snapshot.status === 'paused'
          ? { type: 'runPaused', runId: snapshot.runId }
          : null;
  if (terminalEvent) events.push({ event: terminalEvent, receivedAt: snapshot.updatedAt });
  return events;
}

export function FlowBoard({ projectPath }: FlowBoardProps) {
  const [state, dispatch] = useReducer(reduceFlowEvent, undefined, initialFlowState);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNodeData>([]);
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [events, setEvents] = useState<PipelineEventRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detached, setDetached] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const unlistenRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef<string | null>(null);
  const layoutKeyRef = useRef<string | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<StepNodeData> | null>(null);

  const refreshPlan = useCallback(async () => {
    setPlan(await pipelineGetPlan(projectPath));
  }, [projectPath]);

  const subscribe = useCallback(async (runId: string) => {
    unlistenRef.current?.();
    unlistenRef.current = await listenPipelineEvents(runId, (event) => {
      dispatch(event);
      setEvents((current) => [...current, { event, receivedAt: Date.now() }]);
      if (event.type === 'stepSucceeded' || event.type === 'runCompleted') void refreshPlan();
    });
    runIdRef.current = runId;
  }, [refreshPlan]);

  const refresh = useCallback(async (runId: string) => {
    const snapshot = await pipelineGetState(runId);
    if (!snapshot) return;
    dispatch({ type: 'stateHydrated', state: snapshot });
    setEvents((current) => current.length ? current : recordsFromSnapshot(snapshot));
  }, []);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runs, storyPlan] = await Promise.all([
        pipelineListRuns(projectPath),
        pipelineGetPlan(projectPath),
      ]);
      setPlan(storyPlan);
      const latest = runs[0];
      if (!latest) {
        dispatch({ type: 'reset' });
        setEvents([]);
        setDetached(false);
        runIdRef.current = null;
        return;
      }
      dispatch({ type: 'stateHydrated', state: latest });
      setPrompt(latest.prompt);
      setEvents(recordsFromSnapshot(latest));
      runIdRef.current = latest.runId;
      setDetached(true);
      if (latest.status === 'running' || latest.status === 'paused') await subscribe(latest.runId);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectPath, subscribe]);

  useEffect(() => {
    void loadLatest();
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [loadLatest]);

  useEffect(() => {
    if (state.runStatus !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.runStatus]);

  useEffect(() => {
    const layoutKey = `${projectPath}:${state.runId ?? 'draft'}`;
    const isNewLayout = layoutKeyRef.current !== layoutKey;
    const stored = isNewLayout ? loadFlowPositions(projectPath, state.runId) : {};
    const layout = layoutFlowSteps(state.steps, stored);
    setNodes((current) => state.steps.map((step) => {
      const existing = isNewLayout ? null : current.find((node) => node.id === step.id);
      return {
        id: step.id,
        type: 'step',
        position: existing?.position ?? layout[step.id],
        data: {
          id: step.id,
          kind: step.kind,
          status: step.status,
          attempt: step.attempt,
          cost: step.history.some((attempt) => attempt.cost != null)
            ? step.history.reduce((sum, attempt) => sum + (attempt.cost ?? 0), 0)
            : undefined,
          selected: step.id === selectedStepId,
        },
      };
    }));
    layoutKeyRef.current = layoutKey;
  }, [projectPath, selectedStepId, setNodes, state.runId, state.steps]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void flowInstanceRef.current?.fitView({ padding: 0.2, duration: 180 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedStepId]);

  const runCommand = useCallback(async (command: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await command();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const start = useCallback(async () => {
    if (!prompt.trim()) return;
    await runCommand(async () => {
      setSelectedStepId(null);
      setEvents([]);
      dispatch({ type: 'reset' });
      const runId = await pipelineStart(projectPath, prompt.trim());
      await subscribe(runId);
      setDetached(false);
      await Promise.all([refresh(runId), refreshPlan()]);
    });
  }, [projectPath, prompt, refresh, refreshPlan, runCommand, subscribe]);

  const pause = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    await runCommand(async () => {
      await pipelinePause(runId);
      await refresh(runId);
    });
  }, [refresh, runCommand]);

  const resume = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    await runCommand(async () => {
      if (detached) {
        await pipelineResumeRun(projectPath, runId);
        setDetached(false);
      } else {
        await pipelineResume(runId);
      }
      await subscribe(runId);
      await refresh(runId);
    });
  }, [detached, projectPath, refresh, runCommand, subscribe]);

  const stepOnce = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    await runCommand(async () => {
      await subscribe(runId);
      await pipelineStepOnce(runId, projectPath);
      setDetached(false);
      await refresh(runId);
    });
  }, [projectPath, refresh, runCommand, subscribe]);

  const stop = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    await runCommand(async () => {
      await pipelineStop(runId);
      await refresh(runId);
    });
  }, [refresh, runCommand]);

  const retryStep = useCallback(async (stepId: string) => {
    const runId = runIdRef.current;
    if (!runId) return;
    await runCommand(async () => {
      await subscribe(runId);
      await pipelineRetryStep(runId, stepId, projectPath);
      setDetached(false);
      await refresh(runId);
    });
  }, [projectPath, refresh, runCommand, subscribe]);

  const updatePromptAndRetry = useCallback(async (stepId: string, stepPrompt: string) => {
    const runId = runIdRef.current;
    if (!runId) return;
    await runCommand(async () => {
      await subscribe(runId);
      await pipelineUpdateStepPrompt(runId, stepId, stepPrompt, projectPath);
      await pipelineRetryStep(runId, stepId, projectPath);
      setDetached(false);
      await refresh(runId);
    });
  }, [projectPath, refresh, runCommand, subscribe]);

  const skipStep = useCallback(async (stepId: string) => {
    const runId = runIdRef.current;
    if (!runId) return;
    await runCommand(async () => {
      await pipelineSkipStep(runId, stepId);
      await refresh(runId);
    });
  }, [refresh, runCommand]);

  const updateDependencies = useCallback(async (stepId: string, dependsOn: string[]) => {
    const runId = runIdRef.current;
    if (!runId) return;
    await runCommand(async () => {
      await pipelineUpdateDependencies(runId, stepId, dependsOn);
      await refresh(runId);
    });
  }, [refresh, runCommand]);

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
      const removedSources = new Set(deleted.filter((edge) => edge.target === targetId).map((edge) => edge.source));
      void updateDependencies(targetId, target.dependsOn.filter((dependency) => !removedSources.has(dependency)));
    }
  }, [state.steps, updateDependencies]);

  const persistNodePositions = useCallback<NodeDragHandler>((_event, dragged) => {
    const positions = Object.fromEntries(nodes.map((node) => [
      node.id,
      node.id === dragged.id ? dragged.position : node.position,
    ]));
    saveFlowPositions(projectPath, state.runId, positions);
  }, [nodes, projectPath, state.runId]);

  const edges = useMemo(() => state.steps.flatMap((step) => step.dependsOn.map((dependency) => ({
    id: `${dependency}-${step.id}`,
    source: dependency,
    target: step.id,
    animated: step.status === 'running',
    style: { strokeWidth: 1.5 },
  }))), [state.steps]);

  const selectedStep = state.steps.find((step) => step.id === selectedStepId) ?? null;
  const running = state.runStatus === 'running';
  const paused = state.runStatus === 'paused';
  const recoverable = detached && (running || paused);
  const locallyControllable = (running || paused) && !detached;
  const finishedSteps = state.steps.filter((step) => ['succeeded', 'failed', 'skipped'].includes(step.status)).length;
  const progress = state.steps.length ? Math.round((finishedSteps / state.steps.length) * 100) : 0;
  const totalCost = state.steps.reduce((sum, step) => sum + step.history.reduce((stepSum, attempt) => stepSum + (attempt.cost ?? 0), 0), 0);
  const elapsedUntil = running ? now : (state.updatedAt ?? now);
  const elapsed = state.startedAt == null ? 0 : elapsedUntil - state.startedAt;
  const canCreate = !running && !paused;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-container-lowest">
      <header className="shrink-0 border-b border-border bg-surface-container-lowest">
        <div className="flex flex-col gap-2 px-3 py-3 lg:flex-row lg:items-center">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block font-mono-family text-[10px] font-semibold text-muted-foreground">PRODUCTION BRIEF</span>
            <Input
              placeholder="题材、风格、篇幅、角色关系与目标体验"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="h-9 w-full rounded-sm bg-surface-container-low"
              aria-label="production brief"
            />
          </label>
          <div className="flex min-h-9 flex-wrap items-center gap-2 lg:self-end">
            {canCreate && (
              <Button onClick={start} disabled={busy || loading || !prompt.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Play />}
                {state.runId ? '新建流程' : '创建流程'}
              </Button>
            )}
            {running && !recoverable && (
              <Button variant="outline" onClick={pause} disabled={busy} title="当前步骤结束后暂停">
                <Pause /> 暂停
              </Button>
            )}
            {(paused || recoverable) && (
              <>
                <Button onClick={resume} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Play />}
                  {recoverable ? '恢复运行' : state.steps.some((step) => step.attempt > 0) ? '继续运行' : '运行'}
                </Button>
                <Button variant="outline" onClick={stepOnce} disabled={busy} title="执行下一个可运行步骤后暂停">
                  <StepForward /> 单步
                </Button>
              </>
            )}
            {locallyControllable && (
              <Button variant="outline" onClick={stop} disabled={busy} className="text-destructive" title="停止当前生产流程">
                <Square /> 停止
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-y divide-border border-t border-border sm:grid-cols-4 sm:divide-y-0">
          <div className="min-w-0 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><Hash className="size-3" />运行编号</div>
            <div className="mt-1 truncate font-mono-family text-xs" title={state.runId ?? undefined}>{state.runId ?? '尚未创建'}</div>
          </div>
          <div className="px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><GitBranch className="size-3" />运行状态</div>
            <div className="mt-1 flex items-center gap-2 text-xs font-semibold" data-testid="flow-run-status">
              <span className={`size-1.5 rounded-full ${running ? 'animate-pulse bg-primary' : state.runStatus === 'failed' ? 'bg-destructive' : state.runStatus === 'completed' ? 'bg-emerald-600' : 'bg-muted-foreground'}`} />
              {RUN_STATUS[state.runStatus]}
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>总体进度</span><span>{finishedSteps}/{state.steps.length}</span></div>
            <Progress value={progress} className="mt-2 h-1 rounded-none" aria-label="总体进度" />
          </div>
          <div className="px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><Clock3 className="size-3" />已用时间 / 成本</div>
            <div className="mt-1 flex items-center justify-between gap-2 font-mono-family text-xs">
              <span>{formatElapsed(elapsed)}</span>
              <span className="text-muted-foreground">${totalCost.toFixed(4)}</span>
            </div>
          </div>
        </div>

        <div className="flex min-h-10 items-start gap-2 border-t border-border bg-surface-container-low px-3 py-2 text-xs">
          <FileText className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <strong className="shrink-0">StoryPlan</strong>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={plan?.synopsis || undefined}>
            {plan?.synopsis || '等待策划步骤生成故事梗概'}
          </span>
          <span className="shrink-0 font-mono-family text-[10px] text-muted-foreground">
            {plan?.chapters.length ?? 0} 章 / {plan?.scenes.length ?? 0} 场景
          </span>
        </div>
      </header>

      {recoverable && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertCircle className="size-3.5" />
          发现上次未结束的运行。恢复后会从最后一个安全状态继续。
        </div>
      )}
      {error && (
        <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button size="sm" variant="outline" onClick={loadLatest} disabled={loading}>
            <RotateCcw /> 重试加载
          </Button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <section className="relative min-h-[260px] flex-1" aria-label="生产流程图">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex min-h-9 items-center justify-between border-b border-border/70 bg-surface-container-lowest/85 px-3 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs font-semibold"><GitBranch className="size-3.5 text-primary" />流程地图</div>
              <span className="text-[10px] text-muted-foreground">
                {paused && !detached ? '可拖动节点、连接端点或删除连线来调整依赖' : '拖动节点可整理布局'}
              </span>
            </div>
            <div className="h-full pt-9 story-os-dot-grid" data-testid="flow-canvas">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onInit={(instance) => { flowInstanceRef.current = instance; }}
                onNodesChange={onNodesChange}
                onNodeDragStop={persistNodePositions}
                onNodeClick={(_event, node: Node) => setSelectedStepId(node.id)}
                onConnect={connect}
                onEdgesDelete={deleteEdges}
                nodesConnectable={paused && !detached}
                edgesReconnectable={false}
                edgesDeletable={paused && !detached}
                minZoom={0.35}
                maxZoom={1.75}
                onlyRenderVisibleElements
                fitView
                fitViewOptions={{ padding: 0.2 }}
              >
                <Background gap={24} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>

            {loading && (
              <div role="status" className="absolute inset-0 z-20 flex items-center justify-center bg-surface-container-lowest/80 text-sm text-muted-foreground backdrop-blur-sm">
                <Loader2 className="mr-2 size-4 animate-spin" />正在读取生产记录
              </div>
            )}
            {!loading && !state.runId && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 text-center">
                <div className="max-w-sm border-y border-border bg-surface-container-lowest/90 px-6 py-5">
                  <p className="text-sm font-semibold">从生产简报建立第一条流程</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">默认流程会先完成故事规划，再生成章节大纲。创建后可先检查依赖再运行。</p>
                </div>
              </div>
            )}
          </section>

          <div className="h-36 shrink-0 border-t border-border sm:h-44">
            <PipelineEventLedger
              events={events}
              steps={state.steps.map((step) => ({ id: step.id, kind: step.kind as RunState['steps'][number]['def']['kind'] }))}
            />
          </div>
        </div>

        {selectedStep && (
          <div className="absolute inset-y-0 right-0 z-30 w-full max-w-[420px] border-l border-border bg-surface-container-lowest shadow-[-10px_0_30px_var(--shadow-soft)] xl:static xl:w-[380px] xl:shrink-0 xl:shadow-none">
            <FlowStepInspector
              selected={selectedStep}
              busy={busy}
              detached={detached}
              onClose={() => setSelectedStepId(null)}
              onRetry={retryStep}
              onSkip={skipStep}
              onPromptRerun={updatePromptAndRetry}
            />
          </div>
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        当前运行状态：{RUN_STATUS[state.runStatus]}，总体进度 {progress}%
      </span>
    </div>
  );
}
