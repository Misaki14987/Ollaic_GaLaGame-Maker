import { sceneDisplayName, type SceneHeader } from '@/app/lib/webgal/webgal-ipc';
import { inputClass } from './detail-utils';
export function SceneSelect({
  value,
  scenes,
  sceneHeaders = {},
  onChange,
  placeholder = '选择目标场景…',
  allowEmpty = false,
  compact = false,
  showOutline = false,
  'aria-label': ariaLabel,
}: {
  value: string;
  scenes: string[];
  sceneHeaders?: Record<string, SceneHeader>;
  onChange: (scene: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  compact?: boolean;
  /** Show "章节 — 大纲" instead of just the chapter name in the option list. */
  showOutline?: boolean;
  'aria-label'?: string;
}) {
  const known = !value || scenes.includes(value);
  const cls = compact
    ? 'w-full px-2 py-1 bg-background border border-border/50 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary/50'
    : inputClass;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
      aria-label={ariaLabel ?? '目标场景'}
    >
      <option value="">{allowEmpty ? '（不跳转）' : placeholder}</option>
      {!known && value && <option value={value}>{value}（未找到）</option>}
      {scenes.map((s) => (
        <option key={s} value={s}>
          {showOutline
            ? sceneDisplayName(s, sceneHeaders[s])
            : sceneHeaders[s]?.chapter?.trim() || s}
        </option>
      ))}
    </select>
  );
}

