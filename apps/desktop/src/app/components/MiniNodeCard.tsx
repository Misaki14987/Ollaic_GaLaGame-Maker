import { Plus, Minus, Pencil } from 'lucide-react';
import { commandIcons, typeColors, getNodeSummary } from '../lib/node-display';
import { commandLabels } from '../lib/webgal-types';
import type { NodeDiffEntry } from '../lib/node-diff';

/** Compact node card for the AI change preview: diff badge + type icon + summary. */
export function MiniNodeCard({ entry }: { entry: NodeDiffEntry }) {
  const node = entry.after ?? entry.before;
  if (!node) return null;

  const Icon = commandIcons[node.type];
  const typeColor = typeColors[node.type] ?? 'border-border bg-background/40';
  const summary = getNodeSummary(node);
  const oldSummary = entry.kind === 'modified' && entry.before ? getNodeSummary(entry.before) : undefined;

  const badge =
    entry.kind === 'added'
      ? { Icon: Plus, cls: 'text-green-400' }
      : entry.kind === 'removed'
        ? { Icon: Minus, cls: 'text-red-400' }
        : entry.kind === 'modified'
          ? { Icon: Pencil, cls: 'text-yellow-400' }
          : null;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-md border-l-2 ${typeColor} px-2 py-1 text-[11px] ${
        entry.kind === 'removed' ? 'opacity-70' : ''
      }`}
      title={oldSummary ? `旧：${oldSummary}` : undefined}
    >
      {badge && <badge.Icon className={`h-3 w-3 shrink-0 ${badge.cls}`} />}
      {Icon && <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />}
      <span className="shrink-0 text-muted-foreground">{commandLabels[node.type] ?? node.type}</span>
      {entry.kind === 'modified' && oldSummary !== undefined ? (
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex min-w-0 items-center gap-1 text-muted-foreground line-through decoration-red-400/50">
            <span className="shrink-0 text-red-400/70">-</span>
            <span className="min-w-0 flex-1 truncate">{oldSummary || '(空)'}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1 text-foreground">
            <span className="shrink-0 text-green-400/80">+</span>
            <span className="min-w-0 flex-1 truncate">{summary || '(空)'}</span>
          </span>
        </span>
      ) : (
        <span className={`min-w-0 flex-1 truncate text-foreground ${entry.kind === 'removed' ? 'line-through' : ''}`}>
          {summary}
        </span>
      )}
    </div>
  );
}
