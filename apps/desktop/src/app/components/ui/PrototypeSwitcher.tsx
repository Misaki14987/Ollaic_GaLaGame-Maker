import { useEffect } from 'react';
import { ArrowLeft, ArrowRight, FileText, Layers, Play, Sparkles } from 'lucide-react';
import { useSearchParams } from 'react-router';

export const prototypeVariants = [
  {
    key: 'A',
    name: 'M3 精炼全工作台 · 默认分屏',
    badge: '方案 1+2 标准态',
    description: '单顶栏收拢 · 行内属性展开 · 底部可交互预览窗 + 右侧 AI/Flow 双模面板',
    icon: Layers,
  },
  {
    key: 'B',
    name: 'M3 沉浸剧本流 + 抽屉素材库',
    badge: '零跳转绑素材',
    description: '左侧直接滑出角色/素材/配音抽屉 · 拖拽或一键绑定到当前行，无需切路由',
    icon: FileText,
  },
  {
    key: 'C',
    name: 'M3 大舞台联动预览 · 导戏态',
    badge: '预览窗直接互动',
    description: '放大 RuntimePreview 舞台 · 直接点画面里的立绘改表情/挪站位并自动写回节点',
    icon: Play,
  },
];

export function PrototypeSwitcher() {
  const [params, setParams] = useSearchParams();
  const index = Math.max(0, prototypeVariants.findIndex((v) => v.key === params.get('variant')));
  const current = prototypeVariants[index];

  function selectVariant(key: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('variant', key);
        return next;
      },
      { replace: true },
    );
  }

  function change(offset: number) {
    const nextIndex = (index + offset + prototypeVariants.length) % prototypeVariants.length;
    selectVariant(prototypeVariants[nextIndex].key);
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        (event.target as HTMLElement).closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"]',
        )
      ) {
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        change(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  return (
    <div className="m3-proto-dock" role="region" aria-label="Material 3 方案 1+2 焦点切换器">
      <div className="m3-proto-dock-tag">
        <Sparkles size={13} />
        <span>方案 1+2 · M3 演进原型</span>
      </div>

      <div className="m3-proto-segmented" role="tablist" aria-label="切换工作台预设焦点">
        {prototypeVariants.map((v, i) => {
          const Icon = v.icon;
          const active = i === index;
          return (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`m3-proto-seg-btn ${active ? 'active' : ''}`}
              onClick={() => selectVariant(v.key)}
            >
              <Icon size={14} />
              <span>{v.name}</span>
            </button>
          );
        })}
      </div>

      <div className="m3-proto-dock-desc" title={current.description}>
        {current.description}
      </div>

      <div className="m3-proto-dock-arrows">
        <button type="button" onClick={() => change(-1)} aria-label="上一个预设视角" title="上一个视角 (←)">
          <ArrowLeft size={15} />
        </button>
        <span className="m3-proto-count">
          0{index + 1} / 0{prototypeVariants.length}
        </span>
        <button type="button" onClick={() => change(1)} aria-label="下一个预设视角" title="下一个视角 (→)">
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
