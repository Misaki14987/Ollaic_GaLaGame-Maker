import type { FlowStepView } from '@/app/lib/flow-state';

export interface FlowNodePosition {
  x: number;
  y: number;
}

export type FlowNodePositions = Record<string, FlowNodePosition>;

const COLUMN_GAP = 300;
const ROW_GAP = 160;
const STORAGE_PREFIX = 'ollaic:flow-layout';

export function layoutFlowSteps(
  steps: FlowStepView[],
  savedPositions: FlowNodePositions = {},
): FlowNodePositions {
  const ids = new Set(steps.map((step) => step.id));
  const levels = new Map(steps.map((step) => [step.id, 0]));
  const dependents = new Map<string, string[]>();
  const indegrees = new Map<string, number>();

  for (const step of steps) {
    const dependencies = [...new Set(step.dependsOn.filter((id) => ids.has(id)))];
    indegrees.set(step.id, dependencies.length);
    for (const dependency of dependencies) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), step.id]);
    }
  }

  const queue = steps.filter((step) => indegrees.get(step.id) === 0).map((step) => step.id);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const source = queue[cursor];
    for (const target of dependents.get(source) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, (levels.get(source) ?? 0) + 1));
      const remaining = (indegrees.get(target) ?? 1) - 1;
      indegrees.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }

  const rows = new Map<number, number>();
  return Object.fromEntries(
    steps.map((step) => {
      const level = levels.get(step.id) ?? 0;
      const row = rows.get(level) ?? 0;
      rows.set(level, row + 1);
      const saved = savedPositions[step.id];
      return [step.id, isPosition(saved) ? saved : { x: level * COLUMN_GAP, y: row * ROW_GAP }];
    }),
  );
}

export function flowLayoutStorageKey(projectPath: string, runId: string | null): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(projectPath)}:${encodeURIComponent(runId ?? 'draft')}`;
}

export function loadFlowPositions(
  projectPath: string,
  runId: string | null,
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): FlowNodePositions {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(flowLayoutStorageKey(projectPath, runId)) ?? '{}',
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, FlowNodePosition] =>
        isPosition(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function saveFlowPositions(
  projectPath: string,
  runId: string | null,
  positions: FlowNodePositions,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    const valid = Object.fromEntries(
      Object.entries(positions).filter(([, value]) => isPosition(value)),
    );
    storage.setItem(flowLayoutStorageKey(projectPath, runId), JSON.stringify(valid));
  } catch {
    // localStorage may be disabled or full; the default layout remains usable.
  }
}

function browserStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function isPosition(value: unknown): value is FlowNodePosition {
  if (!value || typeof value !== 'object') return false;
  const position = value as Partial<FlowNodePosition>;
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}
