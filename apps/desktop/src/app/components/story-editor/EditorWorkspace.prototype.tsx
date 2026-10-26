// Ollaic · Material Design 3 Refined Existing-UX Prototype (Scheme 1 + Scheme 2)
// Preserves the proven Ollaic UX structure (Left Rail + Center Script Stream + Bottom Preview + Right AI/Workflow Dock)
// while solving the key friction points:
//   1. Merged single 56px M3 Top App Bar (replaces stacked double header)
//   2. Clean M3 Tonal Surface stream (compact / stream / script)
//   3. Inline Node Property Tray (replaces right-side DetailPanel that covered the script)
//   4. Slide-Out In-Context Asset/Character/Voice Drawer (bind assets without leaving the editor route)
//   5. Interactive Docked Stage Preview (click character sprites or sky in preview to change expression/position/bg)

import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  AudioLines,
  BookOpen,
  Boxes,
  Check,
  Clapperboard,
  Cloud,
  Code2,
  FileText,
  FolderOpen,
  GitBranch,
  Home,
  Image,
  LayoutList,
  Maximize2,
  Mic,
  Minimize2,
  Moon,
  MoveHorizontal,
  Music2,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Sun,
  Upload,
  Users,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import { PrototypeSwitcher } from '../ui/PrototypeSwitcher';
import './EditorWorkspace.prototype.css';

type TimeOfDay = '黄昏' | '雨夜' | '清晨';
type ActorPos = 'left' | 'center' | 'right';
type Expression = '克制' | '温柔' | '微嗔' | '动摇';
type ScriptDisplayMode = 'compact' | 'stream' | 'script';
type DrawerTab = 'scenes' | 'characters' | 'assets' | null;
type RightAgentTab = 'edit' | 'workflow';

interface ScriptNodeItem {
  id: number;
  kind: 'say' | 'changeBg' | 'bgm' | 'choice';
  speaker: '旁白' | '林夏' | '沈舟' | '分支选项' | '环境指令';
  text: string;
  expression?: Expression;
  position?: ActorPos;
  voiceFile?: string;
  assetName?: string;
}

interface SceneRecord {
  id: string;
  file: string;
  title: string;
  chapter: string;
  time: TimeOfDay;
  bgLabel: string;
  bgmLabel: string;
  linExp: Expression;
  shenExp: Expression;
  linPos: ActorPos;
  shenPos: ActorPos;
  nodes: ScriptNodeItem[];
}

const INITIAL_SCENES: SceneRecord[] = [
  {
    id: 'sc-1',
    file: 'start.txt',
    title: '雨后的站台',
    chapter: '第一章 · 重逢',
    time: '黄昏',
    bgLabel: 'station_dusk.webp (雨后站台·黄昏)',
    bgmLabel: 'after_rain_piano.mp3',
    linExp: '克制',
    shenExp: '温柔',
    linPos: 'left',
    shenPos: 'right',
    nodes: [
      {
        id: 1,
        kind: 'changeBg',
        speaker: '环境指令',
        text: '切换背景：station_dusk.webp（雨后站台 · 黄昏） / 渐入 1.2s',
        assetName: 'station_dusk.webp',
      },
      {
        id: 2,
        kind: 'say',
        speaker: '旁白',
        text: '最后一班电车驶过天桥，晚风把站台上的积水吹成细碎的金色。',
      },
      {
        id: 3,
        kind: 'say',
        speaker: '林夏',
        text: '我还以为，你今天也不会来了。',
        expression: '克制',
        position: 'left',
        voiceFile: 'lin_001.wav',
      },
      {
        id: 4,
        kind: 'say',
        speaker: '沈舟',
        text: '答应过你的事，我一直都记得。哪怕晚了整整五个夏天。',
        expression: '温柔',
        position: 'right',
        voiceFile: 'shen_001.wav',
      },
      {
        id: 5,
        kind: 'say',
        speaker: '旁白',
        text: '他从风衣口袋里取出那封折了又折的信，信封边角已经有些发白。',
      },
      {
        id: 6,
        kind: 'say',
        speaker: '林夏',
        text: '所以……这就是你当年说的，等到夏天再当面告诉我的话？',
        expression: '动摇',
        position: 'left',
      },
      {
        id: 7,
        kind: 'choice',
        speaker: '分支选项',
        text: '伸手接过那封信 -> chapter1_letter.txt | 问他这五年去了哪里 -> chapter1_ask.txt',
      },
    ],
  },
  {
    id: 'sc-2',
    file: 'chapter1_letter.txt',
    title: '没有寄出的信',
    chapter: '第一章 · 重逢',
    time: '雨夜',
    bgLabel: 'station_night_rain.webp (旧候车室·雨夜)',
    bgmLabel: 'ginkgo_waltz.mp3',
    linExp: '温柔',
    shenExp: '克制',
    linPos: 'center',
    shenPos: 'right',
    nodes: [
      {
        id: 21,
        kind: 'changeBg',
        speaker: '环境指令',
        text: '切换背景：station_night_rain.webp（旧候车室 · 雨夜）',
        assetName: 'station_night_rain.webp',
      },
      {
        id: 22,
        kind: 'say',
        speaker: '旁白',
        text: '信纸展开的时候，一片干燥的银杏叶轻轻落在她掌心。',
      },
      {
        id: 23,
        kind: 'say',
        speaker: '林夏',
        text: '原来那年秋天夹在书页里的叶子，你还一直留着。',
        expression: '温柔',
        position: 'center',
        voiceFile: 'lin_023.wav',
      },
      {
        id: 24,
        kind: 'say',
        speaker: '沈舟',
        text: '我想，总有一天能亲手交给你。',
        expression: '克制',
        position: 'right',
      },
    ],
  },
  {
    id: 'sc-3',
    file: 'chapter1_ask.txt',
    title: '下一站，夏天',
    chapter: '第二章 · 启程',
    time: '清晨',
    bgLabel: 'station_dawn.webp (跨海铁桥·清晨)',
    bgmLabel: 'first_train.mp3',
    linExp: '微嗔',
    shenExp: '温柔',
    linPos: 'left',
    shenPos: 'center',
    nodes: [
      {
        id: 31,
        kind: 'say',
        speaker: '旁白',
        text: '第二天清晨，他们坐上了同一班始发电车。窗外是正在醒来的海滨城市。',
      },
      {
        id: 32,
        kind: 'say',
        speaker: '林夏',
        text: '这次上车之后，可不许再迟到了。',
        expression: '微嗔',
        position: 'left',
        voiceFile: 'lin_032.wav',
      },
      {
        id: 33,
        kind: 'say',
        speaker: '沈舟',
        text: '好。下一站见。',
        expression: '温柔',
        position: 'center',
        voiceFile: 'shen_033.wav',
      },
    ],
  },
];

function StageArtworkSvg({ time }: { time: TimeOfDay }) {
  const uid = useId().replace(/:/g, '');
  const isNight = time === '雨夜';
  const isDawn = time === '清晨';

  const skyTop = isNight ? '#1b263b' : isDawn ? '#8ecae6' : '#6d8ea0';
  const skyMid = isNight ? '#415a77' : isDawn ? '#bde0fe' : '#e5989b';
  const skyBot = isNight ? '#778da9' : isDawn ? '#fffae5' : '#ffcdb2';

  return (
    <svg className="m3-stage-svg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skyTop} />
          <stop offset="58%" stopColor={skyMid} />
          <stop offset="100%" stopColor={skyBot} />
        </linearGradient>
      </defs>
      <rect width="960" height="540" fill={`url(#${uid}-sky)`} />
      <circle cx="700" cy="195" r={isNight ? 28 : 44} fill={isNight ? '#f8f9fa' : '#fff8d6'} opacity="0.86" />
      <path
        fill={isNight ? '#162032' : isDawn ? '#6c899c' : '#59546c'}
        opacity="0.7"
        d="M0 320 L90 320 L90 260 L165 260 L165 305 L240 305 L240 235 L320 235 L320 315 L520 315 L520 270 L610 270 L610 320 L960 320 L960 410 L0 410 Z"
      />
      <polygon points="0,355 960,330 960,540 0,540" fill={isNight ? '#222b38' : '#5c646d'} />
      <polygon points="0,335 560,355 0,445" fill={isNight ? '#33415c' : '#8a817c'} />
      <line x1="0" y1="435" x2="560" y2="355" stroke="#f4d35e" strokeWidth="4" opacity="0.85" />
      <polygon points="0,35 520,165 505,185 0,95" fill={isNight ? '#1d283a' : '#2b2d42'} />
      <g transform="translate(110, 185)">
        <rect width="92" height="40" rx="5" fill="#f8f9fa" stroke="#2b2d42" strokeWidth="2" />
        <text x="46" y="19" textAnchor="middle" fill="#1d3557" fontSize="11" fontWeight="700" letterSpacing="2">
          夏 川 站
        </text>
        <text x="46" y="32" textAnchor="middle" fill="#457b9d" fontSize="6.5" letterSpacing="1.5">
          NATSUKAWA
        </text>
      </g>
    </svg>
  );
}

function MiniSpriteSvg({ character, expression }: { character: '林夏' | '沈舟'; expression: Expression }) {
  const isLin = character === '林夏';
  const coat = isLin ? '#f4effa' : '#2f3e46';
  const scarf = isLin ? '#b56576' : '#457b9d';
  const hair = isLin ? '#3d2c2e' : '#1d2d44';
  return (
    <svg width="108" height="156" viewBox="0 0 150 220">
      <path d="M36 90 Q75 80 114 90 L122 210 L28 210 Z" fill={coat} stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
      <path d="M54 88 L75 124 L96 88 Z" fill={scarf} />
      <circle cx="75" cy="56" r="25" fill="#ffe5d9" />
      <path
        d={
          isLin
            ? 'M47 54 Q49 22 75 24 Q101 22 103 54 L106 94 L96 88 L95 56 Q75 42 55 56 L54 88 L44 94 Z'
            : 'M48 52 Q50 24 75 24 Q100 24 102 52 Q90 38 75 40 Q60 38 48 52 Z'
        }
        fill={hair}
      />
      <circle cx="67" cy="56" r="2.2" fill="#2b2d42" />
      <circle cx="83" cy="56" r="2.2" fill="#2b2d42" />
      {expression === '温柔' ? (
        <path d="M70 67 Q75 71 80 67" stroke="#e07a5f" strokeWidth="2.2" fill="none" />
      ) : (
        <line x1="70" y1="68" x2="80" y2="68" stroke="#b56576" strokeWidth="2.2" />
      )}
    </svg>
  );
}

const POS_PERCENT: Record<ActorPos, string> = {
  left: '27%',
  center: '50%',
  right: '73%',
};

export function EditorWorkspacePrototype() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const variant = params.get('variant') ?? 'A';

  // M3 Dynamic Color & Theme
  const [darkMode, setDarkMode] = useState(false);
  const [colorSeed, setColorSeed] = useState<'violet' | 'teal' | 'amber'>('violet');

  // Existing UX Core State
  const [scenes, setScenes] = useState<SceneRecord[]>(INITIAL_SCENES);
  const [sceneId, setSceneId] = useState<string>('sc-1');
  const [selectedNodeId, setSelectedNodeId] = useState<number>(4);
  const [displayMode, setDisplayMode] = useState<ScriptDisplayMode>('compact');
  const [searchQuery, setSearchQuery] = useState('');
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightAgentTab>('edit');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [snackbar, setSnackbar] = useState('');

  // AI Co-Pilot & Diff State
  const [aiInput, setAiInput] = useState('把这句台词改得更有重逢时的克制感，含蓄一点。');
  const [pendingDiff, setPendingDiff] = useState<{
    nodeId: number;
    before: string;
    after: string;
  } | null>({
    nodeId: 4,
    before: '答应过你的事，我一直都记得。哪怕晚了整整五个夏天。',
    after: '信一直揣在怀里。只是每次走到夏川站口，都怕你已经不在原来的地方了。',
  });

  const lineRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});

  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
  const selectedNode = scene.nodes.find((n) => n.id === selectedNodeId) ?? scene.nodes[0];

  // Sync preset variant A / B / C to highlight different aspects of the 1+2 solution
  useEffect(() => {
    if (variant === 'B') {
      setDrawerTab('assets');
      setPreviewExpanded(false);
    } else if (variant === 'C') {
      setDrawerTab(null);
      setPreviewExpanded(true);
    } else {
      setDrawerTab(null);
      setPreviewExpanded(false);
    }
  }, [variant]);

  useEffect(() => {
    if (!snackbar) return;
    const t = window.setTimeout(() => setSnackbar(''), 3000);
    return () => window.clearTimeout(t);
  }, [snackbar]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const idx = scene.nodes.findIndex((n) => n.id === selectedNodeId);
      const next = scene.nodes[idx + 1];
      if (!next) {
        setPlaying(false);
        setSnackbar('本场预览播放完毕');
        return;
      }
      setSelectedNodeId(next.id);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [playing, scene, selectedNodeId]);

  function notify(msg: string) {
    setSnackbar(msg);
  }

  function updateScene(patch: Partial<SceneRecord>) {
    setScenes((prev) => prev.map((s) => (s.id === scene.id ? { ...s, ...patch } : s)));
  }

  function updateNode(nodeId: number, patch: Partial<ScriptNodeItem>) {
    setScenes((prev) =>
      prev.map((s) =>
        s.id === scene.id
          ? {
              ...s,
              nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
            }
          : s,
      ),
    );
  }

  function insertNodeAfter(afterId = selectedNode.id) {
    const newId = Date.now();
    const nextSpeaker: ScriptNodeItem['speaker'] =
      selectedNode.speaker === '林夏' ? '沈舟' : '林夏';
    const newNode: ScriptNodeItem = {
      id: newId,
      kind: 'say',
      speaker: nextSpeaker,
      text: '',
      expression: '温柔',
      position: nextSpeaker === '林夏' ? 'left' : 'right',
    };
    setScenes((prev) =>
      prev.map((s) =>
        s.id === scene.id
          ? {
              ...s,
              nodes: s.nodes.flatMap((n) => (n.id === afterId ? [n, newNode] : [n])),
            }
          : s,
      ),
    );
    setSelectedNodeId(newId);
    window.setTimeout(() => lineRefs.current[newId]?.focus(), 20);
  }

  function applyPendingDiff() {
    if (!pendingDiff) return;
    updateNode(pendingDiff.nodeId, { text: pendingDiff.after });
    setPendingDiff(null);
    notify('已批准并落盘 AI 节点变更集');
  }

  function triggerAiDiff() {
    setPendingDiff({
      nodeId: selectedNode.id,
      before: selectedNode.text,
      after:
        selectedNode.speaker === '林夏'
          ? '我把时刻表背了一百遍……可真正在夕阳里看到你，却连一步都不敢迈出去。'
          : '信一直揣在怀里。只是每次走到夏川站口，都怕你已经不在原来的地方了。',
    });
    notify('AI 已生成行内节点 Diff 预览');
  }

  const rawScriptText = scene.nodes
    .map((n) => {
      if (n.kind === 'changeBg') return `changeBg:${n.assetName ?? 'station_dusk.webp'} -next;`;
      if (n.kind === 'choice') return `choose:${n.text};`;
      if (n.speaker === '旁白') return `:${n.text};`;
      return `${n.speaker}:${n.text}${n.voiceFile ? ` -voice=${n.voiceFile}` : ''};`;
    })
    .join('\n');

  const filteredNodes = scene.nodes.filter(
    (n) =>
      !searchQuery.trim() ||
      n.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.speaker.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className={`m3-root ${darkMode ? 'm3-dark' : ''}`} data-seed={colorSeed}>
      {/* ====================================================================
       * SCHEME 1A: Merged Single 56px M3 Top App Bar (replaces 2 stacked bars)
       * ==================================================================== */}
      <header className="m3-merged-topbar">
        <div className="m3-topbar-left">
          <div className="m3-app-mark" title="Ollaic Material 3">
            <Sparkles size={18} />
          </div>
          <div className="m3-project-title">
            <strong>夏日来信 · Ollaic</strong>
            <small>{scene.chapter}</small>
          </div>

          {/* Scene Switcher Chip right in Topbar */}
          <div className="m3-scene-chip">
            <FolderOpen size={14} style={{ color: 'var(--md-sys-color-primary)' }} />
            <select
              aria-label="当前场景"
              value={scene.id}
              onChange={(e) => {
                const next = scenes.find((s) => s.id === e.target.value);
                if (next) {
                  setSceneId(next.id);
                  setSelectedNodeId(next.nodes[0].id);
                }
              }}
            >
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.file}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Center: Existing 3 Script Modes (剧本视图 / 指令卡片 / 脚本源码) + Search */}
        <div className="m3-topbar-center">
          <div className="m3-segmented-group" role="tablist" aria-label="编辑器视图模式">
            <button
              type="button"
              role="tab"
              aria-selected={displayMode === 'compact'}
              className={`m3-seg-pill ${displayMode === 'compact' ? 'selected' : ''}`}
              onClick={() => setDisplayMode('compact')}
            >
              <FileText size={13} />
              <span>剧本视图</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={displayMode === 'stream'}
              className={`m3-seg-pill ${displayMode === 'stream' ? 'selected' : ''}`}
              onClick={() => setDisplayMode('stream')}
            >
              <LayoutList size={13} />
              <span>指令卡片</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={displayMode === 'script'}
              className={`m3-seg-pill ${displayMode === 'script' ? 'selected' : ''}`}
              onClick={() => setDisplayMode('script')}
            >
              <Code2 size={13} />
              <span>脚本源码</span>
            </button>
          </div>

          <label className="m3-search-pill">
            <Search size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索指令 / 角色 / 台词…"
              aria-label="搜索指令"
            />
          </label>
        </div>

        {/* Right: Auto-save status, M3 Dynamic Color Seeds, Preview & Export */}
        <div className="m3-topbar-right">
          <span className="m3-save-badge" title="自动保存已开启">
            <Cloud size={14} />
            <span>已自动保存</span>
          </span>

          <div className="m3-seed-picker" title="Material You 动态主题色">
            <Palette size={13} style={{ marginLeft: 3, opacity: 0.7 }} />
            {(['violet', 'teal', 'amber'] as const).map((seed) => (
              <button
                key={seed}
                type="button"
                aria-label={`${seed} 主题`}
                className={`m3-seed-dot ${colorSeed === seed ? 'active' : ''}`}
                style={{
                  background: seed === 'violet' ? '#7F67BE' : seed === 'teal' ? '#008080' : '#C79100',
                }}
                onClick={() => setColorSeed(seed)}
              />
            ))}
          </div>

          <button
            type="button"
            className="m3-icon-btn"
            aria-label="切换明暗主题"
            onClick={() => setDarkMode((d) => !d)}
          >
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <button
            type="button"
            className="m3-tonal-btn"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            <span>{playing ? '暂停预览' : '运行预览'}</span>
          </button>

          <button
            type="button"
            className="m3-filled-btn"
            onClick={() => notify('已唤起 WebGAL 导出打包流程（模拟）')}
          >
            <Upload size={14} />
            <span>打包发布</span>
          </button>

          <button
            type="button"
            className={`m3-icon-btn ${rightOpen ? 'active' : ''}`}
            aria-label="收起或展开右侧 AI 面板"
            title="收起/展开右侧 Agent 面板"
            onClick={() => setRightOpen((o) => !o)}
          >
            {rightOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
        </div>
      </header>

      {/* ====================================================================
       * Main Shell: Left M3 Navigation Rail + Slide Drawer + Center + Right
       * ==================================================================== */}
      <div className="m3-workspace-shell">
        {/* Left Navigation Rail */}
        <aside className="m3-nav-rail" aria-label="主导航">
          <button
            type="button"
            className="m3-rail-fab"
            title="在当前行后插入新对白 (Enter)"
            onClick={() => insertNodeAfter(selectedNode.id)}
          >
            <Plus size={20} />
          </button>

          <button
            type="button"
            className={`m3-rail-dest ${drawerTab === null ? 'active' : ''}`}
            onClick={() => setDrawerTab(null)}
          >
            <span className="m3-rail-dest-pill">
              <BookOpen size={18} />
            </span>
            <span>剧本</span>
          </button>

          <button
            type="button"
            className={`m3-rail-dest ${drawerTab === 'scenes' ? 'active' : ''}`}
            onClick={() => setDrawerTab((t) => (t === 'scenes' ? null : 'scenes'))}
          >
            <span className="m3-rail-dest-pill">
              <GitBranch size={18} />
            </span>
            <span>场景树</span>
          </button>

          <button
            type="button"
            className={`m3-rail-dest ${drawerTab === 'characters' ? 'active' : ''}`}
            onClick={() => setDrawerTab((t) => (t === 'characters' ? null : 'characters'))}
          >
            <span className="m3-rail-dest-pill">
              <Users size={18} />
            </span>
            <span>角色抽屉</span>
          </button>

          <button
            type="button"
            className={`m3-rail-dest ${drawerTab === 'assets' ? 'active' : ''}`}
            onClick={() => setDrawerTab((t) => (t === 'assets' ? null : 'assets'))}
          >
            <span className="m3-rail-dest-pill">
              <Boxes size={18} />
            </span>
            <span>素材抽屉</span>
          </button>

          <div style={{ marginTop: 'auto' }} />

          <button
            type="button"
            className="m3-rail-dest"
            title="切回旧版编辑器界面对比"
            onClick={() => {
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('prototype');
                return next;
              });
            }}
          >
            <span className="m3-rail-dest-pill">
              <RotateCcw size={17} />
            </span>
            <span>旧版对比</span>
          </button>

          <button
            type="button"
            className="m3-rail-dest"
            onClick={() => navigate('/')}
          >
            <span className="m3-rail-dest-pill">
              <Home size={18} />
            </span>
            <span>首页</span>
          </button>
        </aside>

        {/* ==================================================================
         * SCHEME 2B: Slide-Out In-Context Drawer (No route jump needed!)
         * ================================================================== */}
        {drawerTab && (
          <aside className="m3-context-drawer" aria-label="就地抽屉面板">
            <div className="m3-drawer-header">
              <h3>
                {drawerTab === 'scenes' && (
                  <>
                    <GitBranch size={16} style={{ color: 'var(--md-sys-color-primary)' }} />
                    <span>场景与世界线目录</span>
                  </>
                )}
                {drawerTab === 'characters' && (
                  <>
                    <Users size={16} style={{ color: 'var(--md-sys-color-primary)' }} />
                    <span>角色立绘与音色（就地绑定）</span>
                  </>
                )}
                {drawerTab === 'assets' && (
                  <>
                    <Boxes size={16} style={{ color: 'var(--md-sys-color-primary)' }} />
                    <span>背景 / BGM / 语音库抽屉</span>
                  </>
                )}
              </h3>
              <button
                type="button"
                className="m3-icon-btn"
                style={{ width: 28, height: 28 }}
                onClick={() => setDrawerTab(null)}
                aria-label="关闭抽屉"
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ fontSize: 11.5, color: 'var(--md-sys-color-on-surface-variant)' }}>
              无需离开当前剧本页，点击下方卡片即可直接绑定到当前选中的第{' '}
              <strong>#{scene.nodes.findIndex((n) => n.id === selectedNode.id) + 1}</strong> 行。
            </div>

            <div className="m3-drawer-list">
              {drawerTab === 'scenes' &&
                scenes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`m3-drawer-card ${s.id === scene.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSceneId(s.id);
                      setSelectedNodeId(s.nodes[0].id);
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.75 }}>
                      <span>{s.chapter}</span>
                      <span style={{ fontFamily: 'monospace' }}>{s.file}</span>
                    </div>
                    <strong style={{ fontSize: 13 }}>{s.title}</strong>
                    <small style={{ fontSize: 11, color: 'var(--md-sys-color-on-surface-variant)' }}>
                      {s.nodes.length} 条指令 · {s.time}
                    </small>
                  </button>
                ))}

              {drawerTab === 'characters' && (
                <>
                  {(['林夏', '沈舟'] as const).map((charName) => (
                    <div key={charName} className="m3-drawer-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: 13.5 }}>{charName}</strong>
                        <span className="m3-assist-chip active" style={{ height: 22, fontSize: 10.5 }}>
                          {charName === '林夏' ? '清亮女声 TTS' : '青年温润音 TTS'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--md-sys-color-on-surface-variant)', margin: '4px 0' }}>
                        点击立绘差分直接应用到当前选中行：
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {(['克制', '温柔', '微嗔', '动摇'] as Expression[]).map((exp) => (
                          <button
                            key={exp}
                            type="button"
                            className={`m3-chip-toggle ${
                              selectedNode.speaker === charName && selectedNode.expression === exp ? 'active' : ''
                            }`}
                            onClick={() => {
                              updateNode(selectedNode.id, { speaker: charName, expression: exp });
                              updateScene(charName === '林夏' ? { linExp: exp } : { shenExp: exp });
                              notify(`已将「${charName} · ${exp}」直接绑定到当前句`);
                            }}
                          >
                            {exp}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {drawerTab === 'assets' && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7 }}>场景背景 (Backgrounds)</div>
                  {(
                    [
                      { time: '黄昏', file: 'station_dusk.webp', label: '雨后站台 · 黄昏' },
                      { time: '雨夜', file: 'station_night_rain.webp', label: '旧候车室 · 雨夜' },
                      { time: '清晨', file: 'station_dawn.webp', label: '跨海铁桥 · 清晨' },
                    ] as const
                  ).map((bg) => (
                    <button
                      key={bg.file}
                      type="button"
                      className={`m3-drawer-card ${scene.time === bg.time ? 'selected' : ''}`}
                      onClick={() => {
                        updateScene({ time: bg.time, bgLabel: `${bg.file} (${bg.label})` });
                        notify(`已就地替换本场背景为 ${bg.file}`);
                      }}
                    >
                      <strong style={{ fontSize: 12.5 }}>{bg.label}</strong>
                      <small style={{ fontFamily: 'monospace', opacity: 0.7 }}>{bg.file}</small>
                    </button>
                  ))}

                  <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, marginTop: 6 }}>环境背景乐 (BGM)</div>
                  {['after_rain_piano.mp3', 'ginkgo_waltz.mp3', 'first_train.mp3'].map((bgm) => (
                    <button
                      key={bgm}
                      type="button"
                      className={`m3-drawer-card ${scene.bgmLabel === bgm ? 'selected' : ''}`}
                      onClick={() => {
                        updateScene({ bgmLabel: bgm });
                        notify(`已绑定背景音乐：${bgm}`);
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Music2 size={13} style={{ color: 'var(--md-sys-color-primary)' }} />
                        <strong style={{ fontSize: 12 }}>{bgm}</strong>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </aside>
        )}

        {/* ==================================================================
         * Center Column: Familiar Script Stream + Interactive Stage Preview
         * ================================================================== */}
        <div className="m3-center-column">
          <section className="m3-script-surface" aria-label="剧本流编辑区">
            {/* Compact Scene Context Header */}
            <div className="m3-scene-banner">
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--md-sys-color-primary)' }}>
                  {scene.chapter} · {scene.file}
                </div>
                <h1 style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 0' }}>{scene.title}</h1>
              </div>

              <div className="m3-scene-state-pills">
                <button
                  type="button"
                  className="m3-assist-chip"
                  onClick={() => setDrawerTab((t) => (t === 'assets' ? null : 'assets'))}
                  title="点击在左侧滑出背景/音乐抽屉"
                >
                  <Image size={13} />
                  <span>{scene.bgLabel}</span>
                </button>
                <button
                  type="button"
                  className="m3-assist-chip"
                  onClick={() => setDrawerTab((t) => (t === 'assets' ? null : 'assets'))}
                >
                  <Music2 size={13} />
                  <span>{scene.bgmLabel}</span>
                </button>
                <button
                  type="button"
                  className="m3-assist-chip active"
                  onClick={() => setDrawerTab((t) => (t === 'characters' ? null : 'characters'))}
                >
                  <Users size={13} />
                  <span>角色/素材抽屉</span>
                </button>
              </div>
            </div>

            {/* Main Stream or Raw Script View */}
            <div className="m3-stream-scroll">
              {displayMode === 'script' ? (
                <div className="m3-stream-list">
                  <div className="m3-tonal-box">
                    <div style={{ fontSize: 11.5, fontWeight: 650, marginBottom: 8, opacity: 0.75 }}>
                      WebGAL 原始脚本源码 · {scene.file}
                    </div>
                    <textarea
                      aria-label="WebGAL 脚本源码"
                       readOnly
                      value={rawScriptText}
                      style={{
                        width: '100%',
                        minHeight: 260,
                        border: 0,
                        background: 'transparent',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 13,
                        lineHeight: 1.75,
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="m3-stream-list">
                  {filteredNodes.map((node, index) => {
                    const isSelected = node.id === selectedNode.id;
                    const hasDiff = pendingDiff?.nodeId === node.id;
                    return (
                      <div
                        key={node.id}
                        className={`m3-node-card ${displayMode === 'stream' ? 'stream-mode' : ''} ${
                          isSelected ? 'selected' : ''
                        }`}
                      >
                        <div
                          className="m3-node-main-row"
                          onClick={() => setSelectedNodeId(node.id)}
                        >
                          <button
                            type="button"
                            className="m3-node-gutter-play"
                            title={`从第 ${index + 1} 行开始预览`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedNodeId(node.id);
                              setPlaying(true);
                              notify(`已跳转到第 ${index + 1} 行实时预览`);
                            }}
                          >
                            <span className="line-num">{String(index + 1).padStart(2, '0')}</span>
                            <Play size={12} className="play-icon" />
                          </button>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span
                                className={`m3-node-speaker-badge ${
                                  node.speaker === '林夏'
                                    ? 'lin'
                                    : node.speaker === '沈舟'
                                      ? 'shen'
                                      : ''
                                }`}
                              >
                                {node.speaker}
                              </span>

                              {node.expression && (
                                <span style={{ fontSize: 11, color: 'var(--md-sys-color-on-surface-variant)' }}>
                                  表情：{node.expression} · 站位：{node.position ?? 'center'}
                                </span>
                              )}

                              {node.voiceFile && (
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    color: 'var(--md-sys-color-success)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                  }}
                                >
                                  <Volume2 size={11} />
                                  {node.voiceFile}
                                </span>
                              )}
                            </div>

                            <textarea
                              ref={(el) => {
                                lineRefs.current[node.id] = el;
                              }}
                              aria-label={`编辑第 ${index + 1} 行内容`}
                              className="m3-node-textarea"
                              rows={node.text.length > 44 ? 2 : 1}
                              value={node.text}
                              onFocus={() => setSelectedNodeId(node.id)}
                              onChange={(e) => updateNode(node.id, { text: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                  e.preventDefault();
                                  insertNodeAfter(node.id);
                                }
                              }}
                            />

                            {/* Inline AI Diff Banner when AI proposes a change on this node */}
                            {hasDiff && pendingDiff && (
                              <div
                                style={{
                                  marginTop: 6,
                                  padding: '8px 12px',
                                  borderRadius: 10,
                                  background: 'var(--md-sys-color-tertiary-container)',
                                  color: 'var(--md-sys-color-on-tertiary-container)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 10,
                                  fontSize: 12,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Sparkles size={13} />
                                  <span>
                                    <strong>AI 建议改写：</strong>
                                    {pendingDiff.after}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    className="m3-chip-toggle"
                                    onClick={() => setPendingDiff(null)}
                                  >
                                    忽略
                                  </button>
                                  <button
                                    type="button"
                                    className="m3-chip-toggle active"
                                    onClick={applyPendingDiff}
                                  >
                                    应用
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            className="m3-icon-btn"
                            style={{ width: 28, height: 28 }}
                            title="让 AI 润色本行"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedNodeId(node.id);
                              triggerAiDiff();
                            }}
                          >
                            <Wand2 size={14} />
                          </button>
                        </div>

                        {/* =====================================================
                         * SCHEME 2A: Inline Node Property Tray
                         * Replaces the floating right DetailPanel that covered the script!
                         * ===================================================== */}
                        {isSelected && node.kind === 'say' && (
                          <div className="m3-inline-inspector">
                            <div className="m3-inline-field">
                              <span>说话人：</span>
                              {(['旁白', '林夏', '沈舟'] as const).map((sp) => (
                                <button
                                  key={sp}
                                  type="button"
                                  className={`m3-chip-toggle ${node.speaker === sp ? 'active' : ''}`}
                                  onClick={() => updateNode(node.id, { speaker: sp })}
                                >
                                  {sp}
                                </button>
                              ))}
                            </div>

                            {node.speaker !== '旁白' && (
                              <>
                                <div className="m3-inline-field">
                                  <span>立绘表情：</span>
                                  {(['克制', '温柔', '微嗔', '动摇'] as Expression[]).map((exp) => (
                                    <button
                                      key={exp}
                                      type="button"
                                      className={`m3-chip-toggle ${node.expression === exp ? 'active' : ''}`}
                                      onClick={() => {
                                        updateNode(node.id, { expression: exp });
                                        updateScene(
                                          node.speaker === '林夏' ? { linExp: exp } : { shenExp: exp },
                                        );
                                      }}
                                    >
                                      {exp}
                                    </button>
                                  ))}
                                </div>

                                <div className="m3-inline-field">
                                  <span>站位：</span>
                                  {(['left', 'center', 'right'] as ActorPos[]).map((pos) => (
                                    <button
                                      key={pos}
                                      type="button"
                                      className={`m3-chip-toggle ${node.position === pos ? 'active' : ''}`}
                                      onClick={() => {
                                        updateNode(node.id, { position: pos });
                                        updateScene(
                                          node.speaker === '林夏' ? { linPos: pos } : { shenPos: pos },
                                        );
                                      }}
                                    >
                                      {pos === 'left' ? '左' : pos === 'center' ? '中' : '右'}
                                    </button>
                                  ))}
                                </div>

                                <button
                                  type="button"
                                  className="m3-chip-toggle active"
                                  style={{ marginLeft: 'auto' }}
                                  onClick={() => {
                                    const file = `${node.speaker === '林夏' ? 'lin' : 'shen'}_${node.id}.wav`;
                                    updateNode(node.id, { voiceFile: file });
                                    notify(`已生成并绑定配音 ${file}`);
                                  }}
                                >
                                  <Mic size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                  {node.voiceFile ? '重录配音' : '生成 TTS 配音'}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    className="m3-tonal-btn"
                    style={{ alignSelf: 'flex-start', marginTop: 8 }}
                    onClick={() => insertNodeAfter(selectedNode.id)}
                  >
                    <Plus size={14} />
                    <span>添加下一行指令（或直接按 Enter）</span>
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* ==================================================================
           * SCHEME 2C: Interactive Docked RuntimePreviewPanel
           * Preserves the bottom preview dock, but makes sprites & sky clickable!
           * ================================================================== */}
          <section
            className={`m3-docked-preview ${previewExpanded ? 'expanded' : ''}`}
            aria-label="可交互实时预览窗"
          >
            <header className="m3-preview-toolbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--md-sys-color-success)',
                    display: 'inline-block',
                  }}
                />
                <strong>WebGAL 实时舞台预览（支持画面直接点选互动）</strong>
                <span style={{ opacity: 0.7 }}>
                  · 点击画面中的人物立绘可直接切换表情/站位并写回当前节点
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="m3-chip-toggle"
                  onClick={() => setPreviewExpanded((e) => !e)}
                >
                  {previewExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  <span style={{ marginLeft: 4 }}>{previewExpanded ? '恢复默认分屏' : '放大舞台导戏'}</span>
                </button>
              </div>
            </header>

            <div className="m3-preview-stage-body">
              <div className="m3-interactive-canvas">
                <StageArtworkSvg time={scene.time} />

                {/* Clickable Sprite: 林夏 */}
                <div
                  className={`m3-preview-sprite ${selectedNode.speaker === '林夏' ? 'active-speaker' : ''}`}
                  style={{ left: POS_PERCENT[scene.linPos] }}
                  title="点击直接切换林夏的表情并写回脚本"
                  onClick={() => {
                    const order: Expression[] = ['克制', '温柔', '微嗔', '动摇'];
                    const nextExp = order[(order.indexOf(scene.linExp) + 1) % order.length];
                    updateScene({ linExp: nextExp });
                    if (selectedNode.speaker === '林夏') {
                      updateNode(selectedNode.id, { expression: nextExp });
                    }
                    notify(`舞台互动：林夏表情切换为「${nextExp}」`);
                  }}
                >
                  <MiniSpriteSvg character="林夏" expression={scene.linExp} />
                  <span className="m3-sprite-pill">林夏 · {scene.linExp} (点击换表情)</span>
                </div>

                {/* Clickable Sprite: 沈舟 */}
                <div
                  className={`m3-preview-sprite ${selectedNode.speaker === '沈舟' ? 'active-speaker' : ''}`}
                  style={{ left: POS_PERCENT[scene.shenPos] }}
                  title="点击直接切换沈舟的表情并写回脚本"
                  onClick={() => {
                    const order: Expression[] = ['温柔', '克制', '动摇'];
                    const nextExp = order[(order.indexOf(scene.shenExp) + 1) % order.length];
                    updateScene({ shenExp: nextExp });
                    if (selectedNode.speaker === '沈舟') {
                      updateNode(selectedNode.id, { expression: nextExp });
                    }
                    notify(`舞台互动：沈舟表情切换为「${nextExp}」`);
                  }}
                >
                  <MiniSpriteSvg character="沈舟" expression={scene.shenExp} />
                  <span className="m3-sprite-pill">沈舟 · {scene.shenExp} (点击换表情)</span>
                </div>

                {/* Live Subtitle Preview Bar */}
                <div className="m3-preview-subtitle-bar">
                  <strong style={{ color: '#D0BCFF', whiteSpace: 'nowrap' }}>
                    {selectedNode.speaker}：
                  </strong>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedNode.text || '（空行）'}
                  </span>
                </div>
              </div>

              {/* Quick Stage Directing Side Controls */}
              <div className="m3-preview-quick-controls">
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75, marginBottom: 6 }}>
                    舞台天光直调 (同步 changeBg)
                  </div>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {(['黄昏', '雨夜', '清晨'] as TimeOfDay[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`m3-chip-toggle ${scene.time === t ? 'active' : ''}`}
                        onClick={() => {
                          updateScene({ time: t });
                          notify(`预览舞台天光已切为【${t}】`);
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75, marginBottom: 6 }}>
                    人物快速走位 (同步 changeFigure)
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="m3-chip-toggle"
                      onClick={() => {
                        updateScene({
                          linPos: scene.linPos === 'left' ? 'center' : 'left',
                        });
                      }}
                    >
                      <MoveHorizontal size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                      林夏：{scene.linPos}
                    </button>
                    <button
                      type="button"
                      className="m3-chip-toggle"
                      onClick={() => {
                        updateScene({
                          shenPos: scene.shenPos === 'right' ? 'center' : 'right',
                        });
                      }}
                    >
                      <MoveHorizontal size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                      沈舟：{scene.shenPos}
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: 'var(--md-sys-color-on-surface-variant)' }}>
                  当前同步：第 #{scene.nodes.findIndex((n) => n.id === selectedNode.id) + 1} 行 · WebGAL 16:9
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ==================================================================
         * Right Dock: Existing AI Assistant / Agent Flow Dual-Tab Panel (M3)
         * ================================================================== */}
        {rightOpen && (
          <aside className="m3-right-agent-dock" aria-label="AI 助手与生产流程面板">
            <div className="m3-segmented-group" role="tablist" style={{ width: '100%' }}>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'edit'}
                className={`m3-seg-pill ${rightTab === 'edit' ? 'selected' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setRightTab('edit')}
              >
                <Sparkles size={13} />
                <span>AI 写作助手</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'workflow'}
                className={`m3-seg-pill ${rightTab === 'workflow' ? 'selected' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setRightTab('workflow')}
              >
                <Clapperboard size={13} />
                <span>Agent Flow 生产</span>
              </button>
            </div>

            {rightTab === 'edit' ? (
              <div className="m3-agent-body">
                <div className="m3-tonal-box">
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--md-sys-color-primary)' }}>
                    当前上下文已自动挂载
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4, color: 'var(--md-sys-color-on-surface-variant)' }}>
                    场景：{scene.title} · 选中第 #{scene.nodes.findIndex((n) => n.id === selectedNode.id) + 1} 行（
                    {selectedNode.speaker}）
                  </div>
                </div>

                {pendingDiff && (
                  <div className="m3-diff-approval-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 12.5 }}>待确认变更集 (ChangeSet Diff)</strong>
                      <Sparkles size={14} />
                    </div>
                    <del style={{ fontSize: 11.5, opacity: 0.75 }}>{pendingDiff.before}</del>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{pendingDiff.after}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                      <button
                        type="button"
                        className="m3-chip-toggle"
                        onClick={() => setPendingDiff(null)}
                      >
                        拒绝
                      </button>
                      <button
                        type="button"
                        className="m3-filled-btn"
                        style={{ height: 28, padding: '0 12px' }}
                        onClick={applyPendingDiff}
                      >
                        <Check size={13} />
                        <span>确认落盘</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="m3-tonal-box" style={{ marginTop: 'auto' }}>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 650, marginBottom: 6 }}>
                    对话式修改脚本 / 角色 / 素材规划
                  </label>
                  <textarea
                    aria-label="AI 助手输入框"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: 68,
                      border: '1px solid var(--md-sys-color-outline-variant)',
                      borderRadius: 12,
                      padding: 8,
                      background: 'var(--md-sys-color-surface-container-low)',
                      resize: 'none',
                      fontSize: 12,
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>支持行内 Diff 预览确认</span>
                    <button
                      type="button"
                      className="m3-filled-btn"
                      style={{ height: 30, padding: '0 14px' }}
                      onClick={triggerAiDiff}
                    >
                      <Send size={12} />
                      <span>发送</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="m3-agent-body">
                <div className="m3-tonal-box">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13 }}>StoryPlan 生产流水线</strong>
                    <span className="m3-save-badge">4 / 5 步已就绪</span>
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--md-sys-color-on-surface-variant)', margin: '6px 0 0' }}>
                    保留原有的 FlowBoard 阶段推进体验，采用 M3 Tonal 卡片消除厚重边框。
                  </p>
                </div>

                {[
                  { step: '01 · 世界观与大纲规划', status: '已完成', done: true },
                  { step: '02 · 角色设定与立绘映射', status: '已完成', done: true },
                  { step: '03 · 场景脚本草稿生成 (3 场)', status: '已完成', done: true },
                  { step: '04 · 场景背景与 BGM 绑定', status: '已完成', done: true },
                  { step: '05 · 缺失语音批量 TTS 合成', status: '待执行 (2 条)', done: false },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="m3-tonal-box"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <div>
                      <strong style={{ fontSize: 12.5, display: 'block' }}>{item.step}</strong>
                      <small style={{ fontSize: 11, color: 'var(--md-sys-color-on-surface-variant)' }}>
                        {item.status}
                      </small>
                    </div>
                    {item.done ? (
                      <span className="m3-chip-toggle active">✓</span>
                    ) : (
                      <button
                        type="button"
                        className="m3-tonal-btn"
                        style={{ height: 28, padding: '0 10px' }}
                        onClick={() => notify('已启动步骤 05：批量合成缺失语音')}
                      >
                        运行该步
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      {snackbar && (
        <div className="m3-snackbar" role="status" aria-live="polite">
          <Sparkles size={14} />
          <span>{snackbar}</span>
        </div>
      )}

      <PrototypeSwitcher />
    </div>
  );
}
