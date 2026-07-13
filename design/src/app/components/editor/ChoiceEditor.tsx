import { Plus, Trash2 } from 'lucide-react';
import type { WebGalNode } from '@/app/lib/webgal/webgal-types';
import type { SceneHeader } from '@/app/lib/webgal/webgal-ipc';
import { labelClass } from './detail-utils';
import { SceneSelect } from './SceneSelect';
export function ChoiceEditor({
  node,
  onUpdate,
  scenes = [],
  sceneHeaders = {},
}: {
  node: WebGalNode;
  onUpdate: (u: Partial<WebGalNode>) => void;
  scenes?: string[];
  sceneHeaders?: Record<string, SceneHeader>;
}) {
  const choices = node.choices || [];

  const add = () => {
    onUpdate({ choices: [...choices, { text: '新选项', target: '' }] });
  };

  const update = (idx: number, field: 'text' | 'target', value: string) => {
    const next = [...choices];
    next[idx] = { ...next[idx], [field]: value };
    onUpdate({
      choices: next,
      content: next.map((c) => (c.target ? `${c.text}:${c.target}` : c.text)).join('|'),
    });
  };

  const remove = (idx: number) => {
    const next = choices.filter((_, i) => i !== idx);
    onUpdate({
      choices: next,
      content: next.map((c) => (c.target ? `${c.text}:${c.target}` : c.text)).join('|'),
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className={`${labelClass} font-mono-family mb-0`}>选项分支</label>
        <button
          onClick={add}
          className="px-2 py-0.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors flex items-center gap-1"
          aria-label="添加选项"
        >
          <Plus className="w-3 h-3" />
          添加
        </button>
      </div>

      <div className="space-y-2">
        {choices.map((choice, idx) => (
          <div key={idx} className="p-2.5 bg-input-background border border-border rounded-md">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-muted-foreground font-mono-family">
                选项 {idx + 1}
              </span>
              <button
                onClick={() => remove(idx)}
                className="p-0.5 hover:bg-destructive/10 rounded transition-colors group"
                aria-label={`Delete option ${idx + 1}`}
              >
                <Trash2 className="w-3 h-3 text-muted-foreground group-hover:text-destructive transition-colors" />
              </button>
            </div>
            <input
              type="text"
              value={choice.text}
              onChange={(e) => update(idx, 'text', e.target.value)}
              className="w-full px-2 py-1 mb-1.5 bg-background border border-border/50 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="选项文本"
              aria-label={`Option ${idx + 1} text`}
            />
            <SceneSelect
              value={choice.target}
              scenes={scenes}
              sceneHeaders={sceneHeaders}
              onChange={(name) => update(idx, 'target', name)}
              placeholder="跳转到场景…（留空则不跳转）"
              allowEmpty
              compact
              showOutline
              aria-label={`Option ${idx + 1} target scene`}
            />
          </div>
        ))}

        {choices.length === 0 && (
          <div className="text-center py-4 text-muted-foreground text-xs">点击上方添加选项分支</div>
        )}
      </div>
    </div>
  );
}
