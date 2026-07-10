import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Badge } from './ui/badge';
import { cn } from './ui/utils';
import type { StepStatus } from '../lib/pipeline-types';

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: '待运行',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  awaitingInput: '待输入',
  skipped: '已跳过',
};

const STATUS_CLASS: Record<StepStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'border-blue-500/50 bg-blue-500/15 text-blue-600',
  succeeded: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600',
  failed: 'border-destructive/50 bg-destructive/15 text-destructive',
  awaitingInput: 'border-amber-500/50 bg-amber-500/15 text-amber-600',
  skipped: 'bg-muted text-muted-foreground',
};

export interface StepNodeData {
  id: string;
  kind: string;
  status: StepStatus;
  selected?: boolean;
}

function StepNodeComponent({ data }: { data: StepNodeData }) {
  return (
    <div
      className={cn(
        'min-w-40 rounded-lg border bg-card p-3 shadow-sm',
        data.selected && 'border-primary ring-2 ring-primary/20',
      )}
      data-step-id={data.id}
      data-step-status={data.status}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-muted-foreground" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{data.id}</div>
          <div className="text-xs text-muted-foreground">{data.kind}</div>
        </div>
        <Badge variant="outline" className={cn(STATUS_CLASS[data.status])}>
          {STATUS_LABEL[data.status]}
        </Badge>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-muted-foreground" />
    </div>
  );
}

export const StepNode = memo(StepNodeComponent);
