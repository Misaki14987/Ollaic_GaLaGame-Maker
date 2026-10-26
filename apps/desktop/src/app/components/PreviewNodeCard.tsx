import { commandIcons, typeColors, getNodeSummary } from '../lib/node-display';
import { commandLabels, isMetadataComment } from '../lib/webgal-types';
import type { NodeDiffEntry } from '../lib/node-diff';

/**
 * Full-size, read-only node card for the in-canvas AI change preview
 * (added / removed / modified / context). Mirrors the editable command-stream
 * node so the preview reads as the real nodes on the main page, with a
 * green/red/yellow diff accent. Use MiniNodeCard for the compact chat-panel list.
 */
export function PreviewNodeCard({ entry }: { entry: NodeDiffEntry }) {
  const node = entry.after ?? entry.before;
  if (!node || isMetadataComment(node)) return null;
  const Icon = commandIcons[node.type];
  const baseColor = typeColors[node.type] || 'border-border bg-surface-bright';
  const summary = getNodeSummary(node);
  const oldSummary = entry.kind === 'modified' && entry.before ? getNodeSummary(entry.before) : undefined;

  const accent =
    entry.kind === 'added'
      ? 'border-green-400 bg-green-400/10'
      : entry.kind === 'removed'
        ? 'border-red-400 bg-red-400/10 opacity-60'
        : entry.kind === 'modified'
          ? 'border-yellow-400 bg-yellow-400/10'
          : baseColor;
  const tag =
    entry.kind === 'added' ? '新增'
      : entry.kind === 'removed' ? '删除'
        : entry.kind === 'modified' ? '修改'
          : null;
  const tagColor =
    entry.kind === 'added' ? 'text-green-500'
      : entry.kind === 'removed' ? 'text-red-500'
        : 'text-yellow-500';

  return (
    <div className="flex w-full flex-col items-center">
      <div
        className={`w-[420px] max-w-full rounded-lg border px-4 py-3 shadow-sm ${accent}`}
        title={oldSummary ? `修改前：${oldSummary}` : undefined}
      >
        <div className="mb-1 flex items-center gap-2.5">
          <div className="rounded bg-surface-container/60 p-1.5">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          </div>
          <span className="text-xs text-muted-foreground">{commandLabels[node.type] ?? node.type}</span>
          {tag && <span className={`ml-auto text-[10px] font-medium ${tagColor}`}>{tag}</span>}
        </div>
        {entry.kind === 'modified' && oldSummary !== undefined ? (
          <div className="space-y-1">
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground line-through decoration-red-400/50">
              <span className="select-none text-red-500/70">−</span>
              <span className="min-w-0 flex-1">{oldSummary || '(空)'}</span>
            </div>
            <div className="flex items-start gap-1.5 text-sm text-foreground">
              <span className="select-none text-green-500/80">+</span>
              <span className="min-w-0 flex-1">{summary || '(空)'}</span>
            </div>
          </div>
        ) : (
          <div className={`text-sm text-foreground ${entry.kind === 'removed' ? 'line-through' : ''}`}>
            {summary || '(空)'}
          </div>
        )}
      </div>
      <div className="h-4 w-px bg-border/60" />
    </div>
  );
}
