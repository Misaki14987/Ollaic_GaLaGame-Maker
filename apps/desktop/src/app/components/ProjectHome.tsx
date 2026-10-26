import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  BookOpen,
  Check,
  Clock,
  Edit,
  Folder,
  FolderOpen,
  Grid2x2,
  List,
  Loader2,
  MapPin,
  Moon,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  createManagedProject, getProjectStorage, importProjectArchive, initProject, openProject,
  type ProjectInfo, type ProjectStorage,
} from '../lib/webgal-ipc';
import { saveProjectMemory } from '../lib/project-memory';
import './ProjectHome.css';

export interface Project {
  id: string;
  name: string;
  description: string;
  lastModified: string;
  path: string;
  thumbnail?: string;
  isFavorite: boolean;
  sceneCount: number;
  deleted?: boolean;
}

const STORAGE_KEY = 'webgal-projects';

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

/**
 * Generates a unique, atmospheric Visual Novel SVG cover illustration for each project
 * based on its name/id hash so the gallery looks like an anime/visual-novel studio shelf
 * rather than monotonous grey folder icons.
 */
function ProjectCoverArt({ name }: { name: string }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const variant = Math.abs(hash) % 3;

  const palettes = [
    // Dusk Train Station (Twilight Violet & Warm Sunset)
    { skyTop: '#352F5B', skyMid: '#8E6C88', skyBot: '#F6C6A5', sun: '#FFF1C1', hill: '#2A2543', accent: '#E07A5F' },
    // Coastal Summer (Cyan Sea & Soft Azure)
    { skyTop: '#1D4E68', skyMid: '#5694A8', skyBot: '#D8F1E5', sun: '#FFF9D2', hill: '#18394B', accent: '#F4A261' },
    // Starlight Night (Deep Indigo & Sakura Mist)
    { skyTop: '#1A1B35', skyMid: '#483D6B', skyBot: '#C996AC', sun: '#F4F1DE', hill: '#141529', accent: '#E5989B' },
  ];
  const p = palettes[variant];

  return (
    <svg className="m3-cover-svg" viewBox="0 0 480 270" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="480" height="270" fill={p.skyTop} />
      <rect y="70" width="480" height="120" fill={p.skyMid} opacity="0.78" />
      <rect y="145" width="480" height="125" fill={p.skyBot} opacity="0.85" />
      {/* Sun / Moon */}
      <circle cx={variant === 1 ? 130 : 355} cy="96" r="34" fill={p.sun} opacity="0.88" />
      <circle cx={variant === 1 ? 130 : 355} cy="96" r="68" fill={p.sun} opacity="0.18" />
      {/* Clouds */}
      <path
        d="M50 75 Q95 62 140 72 T230 68 M290 54 Q340 45 395 56"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
        opacity="0.32"
      />
      {/* Distant City / Mountains Silhouette */}
      <path
        d="M0 190 L55 172 L95 182 L145 154 L205 178 L275 160 L340 180 L410 158 L480 176 L480 270 L0 270 Z"
        fill={p.hill}
        opacity="0.72"
      />
      {/* Foreground Station Platform & Overhead Wires */}
      <polygon points="0,210 480,194 480,270 0,270" fill={p.hill} />
      <line x1="0" y1="234" x2="480" y2="212" stroke={p.sun} strokeWidth="2" opacity="0.55" />
      <line x1="295" y1="35" x2="295" y2="215" stroke={p.hill} strokeWidth="3.5" opacity="0.75" />
      <path d="M0 30 Q160 85 295 65 T480 38" stroke={p.hill} strokeWidth="1.5" fill="none" opacity="0.55" />
      {/* Subtle Character Silhouettes */}
      <g transform="translate(195, 148)" fill={p.hill}>
        <circle cx="12" cy="10" r="8" />
        <path d="M2 22 Q12 18 22 22 L26 62 L-2 62 Z" />
      </g>
      <g transform="translate(232, 142)" fill={p.accent} opacity="0.9">
        <circle cx="12" cy="10" r="8.5" fill={p.hill} />
        <path d="M1 22 Q12 18 23 22 L27 68 L-3 68 Z" fill={p.hill} />
      </g>
    </svg>
  );
}

export function ProjectHome() {
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(() => localStorage.getItem('ollaic-home-theme') === 'dark');
  const [colorSeed, setColorSeed] = useState<'violet' | 'teal' | 'amber'>('violet');
  const [openError, setOpenError] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const projectsRef = useRef(projects);
  const [storage, setStorage] = useState<ProjectStorage | null>(() => isTauri() ? null : { managed: false });
  const [isOpening, setIsOpening] = useState(false);
  const managedStorage = storage?.managed ?? false;
  const [sidebarFilter, setSidebarFilter] = useState<'all' | 'favorites' | 'recent' | 'trash'>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const updateProjects = useCallback((update: (current: Project[]) => Project[]) => {
    const updated = update(projectsRef.current);
    // Persist before navigation can unmount the homepage.
    persistProjects(updated);
    projectsRef.current = updated;
    setProjects(updated);
  }, []);

  const rememberProject = useCallback((project: Project) => {
    localStorage.setItem(`project-path-${project.id}`, project.path);
    updateProjects((current) => [project, ...current.filter((p) => p.id !== project.id)]);
  }, [updateProjects]);

  const loadStorage = useCallback(async () => {
    setOpenError('');
    try {
      setStorage(await getProjectStorage());
    } catch (e) {
      setOpenError(`无法初始化项目存储: ${e}`);
    }
  }, []);

  useEffect(() => {
    if (isTauri()) void loadStorage();
  }, [loadStorage]);

  useEffect(() => {
    for (const p of projects) localStorage.setItem(`project-path-${p.id}`, p.path);
  }, [projects]);

  const activeProjects = projects.filter((project) => !project.deleted);
  const spotlightProject = activeProjects[0] ?? null;

  const filterLabel = useMemo(() => {
    if (searchQuery.trim()) return '搜索结果';
    switch (sidebarFilter) {
      case 'favorites':
        return '我的收藏';
      case 'recent':
        return '最近编辑';
      case 'trash':
        return '回收站';
      default:
        return '全部项目';
    }
  }, [sidebarFilter, searchQuery]);

  const filteredProjects = useMemo(() => {
    let list = projects;
    switch (sidebarFilter) {
      case 'favorites':
        list = list.filter((p) => p.isFavorite && !p.deleted);
        break;
      case 'trash':
        list = list.filter((p) => p.deleted);
        break;
      case 'recent':
        list = list.filter((p) => !p.deleted).slice(0, 5);
        break;
      default:
        list = list.filter((p) => !p.deleted);
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.path.toLowerCase().includes(query),
    );
  }, [projects, searchQuery, sidebarFilter]);

  const openCreateDialog = () => {
    setIsModalOpen(true);
    setProjectName('');
    setProjectDesc('');
    setSelectedDir(null);
    setCreateError('');
  };

  const openEditDialog = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(project);
    setEditName(project.name);
    setEditDesc(project.description);
  };

  const handleSaveEdit = () => {
    if (!editingProject) return;
    updateProjects((prev) =>
      prev.map((p) =>
        p.id === editingProject.id
          ? { ...p, name: editName.trim() || p.name, description: editDesc.trim() }
          : p,
      ),
    );
    setEditingProject(null);
  };

  const handlePickDir = useCallback(async () => {
    try {
      const dir = await openDialog({ title: '选择项目存放位置', directory: true });
      if (dir) setSelectedDir(dir);
    } catch (error) {
      setCreateError(`无法选择文件夹：${String(error)}`);
    }
  }, []);

  const handleCreateProject = useCallback(async () => {
    const name = projectName.trim();
    if (!name || !storage || (!managedStorage && !selectedDir) || isCreating) return;

    setIsCreating(true);
    setCreateError('');
    try {
      const info: ProjectInfo = managedStorage
        ? await createManagedProject(name)
        : await initProject(selectedDir!, name);
      const desc = projectDesc.trim();
      if (desc) {
        await saveProjectMemory(info.path, {
          worldSetting: desc,
          writingStyle: '',
          userPreferences: '',
          updatedAt: new Date().toISOString(),
        });
      }
      const newProject: Project = {
        id: Date.now().toString(),
        name: info.config.Game_name || name,
        description: desc || `WebGAL 项目 - ${name}`,
        lastModified: new Date().toLocaleString(),
        path: info.path,
        isFavorite: false,
        sceneCount: info.scenes.length,
      };
      rememberProject(newProject);
      setIsModalOpen(false);
      navigate(`/editor/${newProject.id}?agent=workflow`);
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setIsCreating(false);
    }
  }, [navigate, projectDesc, projectName, selectedDir, managedStorage, storage, isCreating, rememberProject]);

  const handleOpenProject = useCallback(async () => {
    if (!storage || isOpening) return;
    const projectsBeforeOpen = projectsRef.current;
    setIsOpening(true);
    setOpenError('');
    try {
      const selected = await openDialog(managedStorage ? {
        title: '导入 WebGAL 项目 ZIP',
        filters: [{ name: 'WebGAL 项目 ZIP', extensions: ['zip'] }],
      } : {
        title: '打开 WebGAL 项目文件夹',
        directory: true,
      });
      if (!selected) return;
      const info = managedStorage
        ? await importProjectArchive(selected)
        : await openProject(selected);
      const existing = projectsRef.current.find((p) => p.path === info.path);
      const previous = projectsBeforeOpen.find((p) => p.path === info.path);
      // Opening a trashed project is intentional; a later deletion cancels the open.
      if (previous && (!existing || (existing.deleted && existing !== previous))) return;
      if (existing) {
        rememberProject({
          ...existing, deleted: false, sceneCount: info.scenes.length, lastModified: new Date().toLocaleString(),
        });
        navigate(`/editor/${existing.id}`);
        return;
      }
      const newProject: Project = {
        id: Date.now().toString(),
        name: info.config.Game_name || info.path.split('/').pop() || '未命名项目',
        description: `${info.scenes.length} 个场景`,
        lastModified: new Date().toLocaleString(),
        path: info.path,
        isFavorite: false,
        sceneCount: info.scenes.length,
      };
      rememberProject(newProject);
      navigate(`/editor/${newProject.id}?agent=workflow`);
    } catch (e) {
      setOpenError(`无法${managedStorage ? '导入' : '打开'}项目: ${e}`);
    } finally {
      setIsOpening(false);
    }
  }, [navigate, storage, managedStorage, isOpening, rememberProject]);

  const enterProject = useCallback(async (project: Project) => {
    if (project.deleted || isOpening) return;
    setIsOpening(true);
    setOpenError('');
    try {
      const info = await openProject(project.path);
      const current = projectsRef.current.find((p) => p.id === project.id);
      if (!current || current.deleted) return;
      const updated = {
        ...current,
        sceneCount: info.scenes.length,
        lastModified: new Date().toLocaleString(),
      };
      rememberProject(updated);
      navigate(`/editor/${project.id}`);
    } catch (e) {
      setOpenError(`无法打开「${project.name}」: ${e}`);
    } finally {
      setIsOpening(false);
    }
  }, [isOpening, navigate, rememberProject]);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateProjects((prev) => prev.map((p) => (p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)));
  };

  const deleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('移入回收站？（不会删除磁盘上的文件）')) {
      updateProjects((prev) => prev.map((p) => (p.id === id ? { ...p, deleted: true } : p)));
    }
  };

  const restoreProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateProjects((prev) => prev.map((p) => (p.id === id ? { ...p, deleted: false } : p)));
  };

  const permanentlyDeleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定永久移除此项目？不会删除磁盘上的文件。')) {
      updateProjects((prev) => prev.filter((p) => p.id !== id));
      localStorage.removeItem(`project-path-${id}`);
    }
  };

  const theme = isDark ? 'dark' : 'light';
  const filters = [
    { id: 'all', label: '全部项目', short: '项目', icon: Folder, count: activeProjects.length },
    {
      id: 'favorites',
      label: '我的收藏',
      short: '收藏',
      icon: Star,
      count: activeProjects.filter((p) => p.isFavorite).length,
    },
    {
      id: 'recent',
      label: '最近编辑',
      short: '最近',
      icon: Clock,
      count: Math.min(activeProjects.length, 5),
    },
    {
      id: 'trash',
      label: '回收站',
      short: '回收站',
      icon: Trash2,
      count: projects.filter((p) => p.deleted).length,
    },
  ] as const;

  const toggleTheme = () => {
    setIsDark(!isDark);
    localStorage.setItem('ollaic-home-theme', isDark ? 'light' : 'dark');
  };

  const recordProps = (project: Project) => ({
    project,
    onOpen: () => enterProject(project),
    onFavorite: toggleFavorite,
    onEdit: openEditDialog,
    onDelete: deleteProject,
    onRestore: restoreProject,
    onPermanentDelete: permanentlyDeleteProject,
  });

  return (
    <div className="m3-home m3-home-shell" data-theme={theme} data-seed={colorSeed}>
      {/* ====================================================================
       * Left M3 Navigation Drawer (Eliminates nested boxes & giant top action cards)
       * ==================================================================== */}
      <aside className="m3-home-drawer" aria-label="创作工作台导航">
        <div className="m3-home-brand">
          <div className="m3-home-brand-logo">
            <BookOpen size={21} strokeWidth={2} />
          </div>
          <div className="m3-home-brand-text">
            <strong>
              <span>Ollaic</span>
              <span className="m3-home-brand-badge">M3 Studio</span>
            </strong>
            <small>视觉小说创作工作台</small>
          </div>
        </div>

        {/* M3 Extended FAB + Tonal Open Button */}
        <div className="m3-drawer-cta-group" role="region" aria-label="项目操作">
          <button type="button" className="m3-extended-fab" onClick={openCreateDialog}>
            <Plus size={22} />
            <div>
              <span>新建项目</span>
              <small>创建 WebGAL 工程</small>
            </div>
          </button>

          <button type="button" className="m3-drawer-secondary-btn" onClick={handleOpenProject} disabled={!storage || isOpening}>
            <FolderOpen size={17} />
            <span>{managedStorage ? '导入项目 ZIP' : '打开已有项目'}</span>
          </button>
        </div>

        {/* Library Filter Destinations */}
        <div>
          <div className="m3-drawer-section-label">项目库导航</div>
          <nav className="m3-drawer-nav" aria-label="项目筛选">
            {filters.map(({ id, label, short, icon: Icon, count }) => (
              <button
                key={id}
                type="button"
                className={`m3-drawer-filter-item ${sidebarFilter === id ? 'active' : ''}`}
                onClick={() => setSidebarFilter(id)}
                aria-current={sidebarFilter === id ? 'page' : undefined}
                aria-label={`${short}（${count}）`}
              >
                <Icon size={18} />
                <span>{label}</span>
                <span className="m3-drawer-filter-count">{count}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Bottom M3 Prototype Studio Entrance Card */}
        <button
          type="button"
          className="m3-drawer-proto-card"
          onClick={() => navigate('/editor/demo?prototype=1&variant=A')}
        >
          <div className="m3-drawer-proto-head">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Wand2 size={15} />
              <span>设计原型实验室</span>
            </span>
            <ArrowRight size={15} />
          </div>
          <p>体验 Material 3 精炼剧本流、行内属性展开与舞台直调原型</p>
        </button>
      </aside>

      {/* ====================================================================
       * Right Main M3 Surface Canvas
       * ==================================================================== */}
      <main className="m3-home-canvas">
        {/* Top Bar with Centered M3 Search Bar + Dynamic Color Seeds + View Switch */}
        <header className="m3-canvas-topbar">
          <label className="m3-search-bar">
            <Search size={18} />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索项目名称、故事简介或本地路径…"
              aria-label="搜索项目"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} aria-label="清除搜索">
                <X size={16} />
              </button>
            )}
          </label>

          <div className="m3-topbar-controls">
            <div className="m3-seed-group" aria-label="Material You 动态主题色">
              <Palette size={14} style={{ opacity: 0.7, marginLeft: 2 }} />
              {(['violet', 'teal', 'amber'] as const).map((seed) => (
                <button
                  key={seed}
                  type="button"
                  aria-label={`${seed} 主题色`}
                  className={`m3-seed-swatch ${colorSeed === seed ? 'active' : ''}`}
                  style={{
                    background: seed === 'violet' ? '#7F67BE' : seed === 'teal' ? '#008080' : '#C79100',
                  }}
                  onClick={() => setColorSeed(seed)}
                />
              ))}
            </div>

            <div className="m3-view-segmented" role="group" aria-label="项目显示方式">
              <button
                type="button"
                aria-label="网格视图"
                aria-pressed={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
                className={viewMode === 'grid' ? 'active' : ''}
              >
                {viewMode === 'grid' ? <Check size={13} /> : null}
                <Grid2x2 size={15} />
                <span>画廊</span>
              </button>
              <button
                type="button"
                aria-label="列表视图"
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
                className={viewMode === 'list' ? 'active' : ''}
              >
                {viewMode === 'list' ? <Check size={13} /> : null}
                <List size={15} />
                <span>列表</span>
              </button>
            </div>

            <button
              type="button"
              className="m3-circle-icon-btn"
              onClick={toggleTheme}
              aria-label={isDark ? '切换浅色模式' : '切换深色模式'}
              title={isDark ? '切换浅色模式' : '切换深色模式'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        {/* Scrollable Studio Body */}
        <div className="m3-canvas-scroll">
          {openError && (
            <div className="home-error" role="alert">
              <span>{openError}</span>
              <button
                type="button"
                className="m3-circle-icon-btn"
                style={{ width: 28, height: 28 }}
                onClick={() => setOpenError('')}
                aria-label="关闭错误提示"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {/* Hero Spotlight Banner: "Continue Directing" for the most recent active project */}
          {spotlightProject && sidebarFilter === 'all' && !searchQuery.trim() && (
            <section className="m3-spotlight-banner" aria-label="继续上次创作">
              <div className="m3-spotlight-art">
                <ProjectCoverArt name={spotlightProject.name} />
              </div>

              <div className="m3-spotlight-body">
                <span className="m3-spotlight-eyebrow">
                  <Sparkles size={13} />
                  <span>继续上次创作 · RECENT SPOTLIGHT</span>
                </span>
                <h2>{spotlightProject.name}</h2>
                <p>{spotlightProject.description || '点击右侧按钮直接回到剧本工作台继续排演。'}</p>
                <div className="m3-spotlight-meta">
                  <span>
                    <BookOpen size={13} />
                    {spotlightProject.sceneCount} 个场景
                  </span>
                  <span>
                    <Clock size={13} />
                    最近保存：{spotlightProject.lastModified || '刚刚'}
                  </span>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                    <MapPin size={13} />
                    {spotlightProject.path}
                  </span>
                </div>
              </div>

              <div className="m3-spotlight-actions">
                <button
                  type="button"
                  className="home-button tonal"
                  onClick={() => navigate(`/editor/${spotlightProject.id}?prototype=1&variant=A`)}
                >
                  <Wand2 size={16} />
                  <span>以 M3 新工作台打开</span>
                </button>
                <button
                  type="button"
                  className="home-button filled"
                  onClick={() => enterProject(spotlightProject)}
                >
                  <Play size={15} />
                  <span>继续创作</span>
                </button>
              </div>
            </section>
          )}

          {/* Project Gallery Section */}
          <section aria-labelledby="home-title">
            <div className="m3-section-header" style={{ marginBottom: 16 }}>
              <div className="m3-section-title-group">
                <h1 id="home-title">{filterLabel}</h1>
                <span className="m3-section-count-pill">{filteredProjects.length} 个项目</span>
              </div>

              {searchQuery.trim() && (
                <button type="button" className="home-button text" onClick={() => setSearchQuery('')}>
                  清除搜索
                </button>
              )}
            </div>

            {filteredProjects.length ? (
              <div className={viewMode === 'grid' ? 'm3-project-grid' : 'm3-project-list'}>
                {filteredProjects.map((project) => (
                  <ProjectRecord key={project.id} {...recordProps(project)} viewMode={viewMode} />
                ))}
              </div>
            ) : (
              <div className="m3-empty-state">
                <span className="m3-empty-icon-circle" aria-hidden="true">
                  {searchQuery ? (
                    <Search size={28} />
                  ) : sidebarFilter === 'trash' ? (
                    <Trash2 size={28} />
                  ) : sidebarFilter === 'favorites' ? (
                    <Star size={28} />
                  ) : (
                    <Folder size={28} />
                  )}
                </span>
                <h3>
                  {searchQuery
                    ? '没有找到匹配的项目'
                    : sidebarFilter === 'trash'
                      ? '回收站是空的'
                      : sidebarFilter === 'favorites'
                        ? '暂无收藏项目'
                        : sidebarFilter === 'recent'
                          ? '暂无最近打开的项目'
                          : '还没有创建任何视觉小说项目'}
                </h3>
                <p>
                  {searchQuery
                    ? '请尝试其他关键词或清除搜索条件。'
                    : sidebarFilter === 'trash'
                      ? '移入回收站的项目会暂存在这里，随时可以还原。'
                      : sidebarFilter === 'favorites'
                        ? '点击项目卡片右上角的星标即可将其加入收藏。'
                        : '点击左侧「新建项目」或「打开已有项目」，开启你的第一部作品。'}
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Dialog: Create Project */}
      <HomeDialog
        open={isModalOpen}
        onOpenChange={(open) => !isCreating && setIsModalOpen(open)}
        title="新建项目"
        description={managedStorage ? '在应用项目库中创建 WebGAL 视觉小说工程。' : '选择存放位置，创建标准 WebGAL 视觉小说工程。'}
        theme={theme}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateProject();
          }}
        >
          <label className="home-field">
            项目名称
            <input
              autoFocus
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="例如：夏川站的来信"
              disabled={isCreating}
            />
          </label>
          <label className="home-field">
            故事简介 <span>（选填，将作为 AI 初始世界观记忆）</span>
            <textarea
              value={projectDesc}
              onChange={(e) => setProjectDesc(e.target.value)}
              placeholder="简述时代背景、核心角色与故事基调…"
              rows={3}
              disabled={isCreating}
            />
          </label>
          {managedStorage ? (
            <p className="home-edit-path">项目将保存在应用项目库中。</p>
          ) : (
          <div className="home-field">
            存放位置
            <div className="home-directory">
              <span title={selectedDir || undefined}>{selectedDir || '选择一个本地文件夹'}</span>
              <button
                type="button"
                className="m3-circle-icon-btn"
                style={{ width: 32, height: 32 }}
                onClick={handlePickDir}
                aria-label="选择项目文件夹"
                disabled={isCreating}
              >
                <FolderOpen size={17} />
              </button>
            </div>
            {selectedDir && (
              <small>
                将创建：{selectedDir}/{projectName.trim() || '项目名称'}/game/
              </small>
            )}
          </div>
          )}
          {createError && (
            <p className="home-error" role="alert">
              {createError}
            </p>
          )}
          <div className="home-dialog-actions">
            <button
              type="button"
              className="home-button text"
              onClick={() => setIsModalOpen(false)}
              disabled={isCreating}
            >
              取消
            </button>
            <button
              type="submit"
              className="home-button filled"
              disabled={!projectName.trim() || !storage || (!managedStorage && !selectedDir) || isCreating}
            >
              {isCreating ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />}
              {isCreating ? '创建中…' : '创建项目'}
            </button>
          </div>
        </form>
      </HomeDialog>

      {/* Dialog: Edit Project Info */}
      <HomeDialog
        open={!!editingProject}
        onOpenChange={(open) => !open && setEditingProject(null)}
        title="编辑项目信息"
        description="修改项目展示名称与故事简介。"
        theme={theme}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSaveEdit();
          }}
        >
          <label className="home-field">
            项目名称
            <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} />
          </label>
          <label className="home-field">
            故事简介
            <textarea rows={3} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
          </label>
          <div className="home-field">
            项目位置
            <p className="home-edit-path">{editingProject?.path}</p>
          </div>
          <div className="home-dialog-actions">
            <button type="button" className="home-button text" onClick={() => setEditingProject(null)}>
              取消
            </button>
            <button className="home-button filled" type="submit" disabled={!editName.trim()}>
              保存修改
            </button>
          </div>
        </form>
      </HomeDialog>
    </div>
  );
}

interface ProjectRecordProps {
  project: Project;
  onOpen: () => void;
  onFavorite: (id: string, event: React.MouseEvent) => void;
  onEdit: (project: Project, event: React.MouseEvent) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onRestore: (id: string, event: React.MouseEvent) => void;
  onPermanentDelete: (id: string, event: React.MouseEvent) => void;
  viewMode: 'grid' | 'list';
}

function ProjectRecord({
  project,
  onOpen,
  onFavorite,
  onEdit,
  onDelete,
  onRestore,
  onPermanentDelete,
  viewMode,
}: ProjectRecordProps) {
  return (
    <article
      className={`m3-project-card ${project.deleted ? 'is-deleted' : ''} ${
        viewMode === 'list' ? 'as-row' : ''
      }`}
    >
      <button
        type="button"
        className="m3-project-open-surface"
        onClick={onOpen}
        disabled={!!project.deleted}
        aria-label={`打开项目 ${project.name}`}
      >
        <div className="m3-project-cover-wrap" aria-hidden="true">
          <ProjectCoverArt name={project.name} />
          <span className="m3-cover-scene-chip">
            <BookOpen size={12} />
            {project.sceneCount} 个场景
          </span>
        </div>

        <div className="m3-card-body">
          <div className="m3-card-title-row">
            <h3>{project.name}</h3>
          </div>
          <p className="m3-card-desc">{project.description || '暂无简介'}</p>
          <div className="m3-card-footer">
            <div className="m3-card-path" title={project.path}>
              <MapPin size={12} />
              <span>{project.path}</span>
            </div>
            <span className="m3-card-time">{project.lastModified}</span>
          </div>
        </div>
      </button>

      <div className="m3-card-actions">
        {project.deleted ? (
          <>
            <button
              type="button"
              className="m3-card-action-btn"
              onClick={(e) => onRestore(project.id, e)}
              aria-label={`还原项目 ${project.name}`}
              title="还原项目"
            >
              <RotateCcw size={15} />
            </button>
            <button
              type="button"
              className="m3-card-action-btn"
              onClick={(e) => onPermanentDelete(project.id, e)}
              aria-label={`永久移除 ${project.name}`}
              title="永久移除记录"
            >
              <Trash2 size={15} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`m3-card-action-btn ${project.isFavorite ? 'is-favorite' : ''}`}
              onClick={(e) => onFavorite(project.id, e)}
              aria-label={`${project.isFavorite ? '取消收藏' : '收藏'} ${project.name}`}
              aria-pressed={project.isFavorite}
              title={project.isFavorite ? '取消收藏' : '收藏'}
            >
              <Star size={15} fill={project.isFavorite ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className="m3-card-action-btn"
              onClick={(e) => onEdit(project, e)}
              aria-label={`编辑项目 ${project.name}`}
              title="编辑项目"
            >
              <Edit size={15} />
            </button>
            <button
              type="button"
              className="m3-card-action-btn"
              onClick={(e) => onDelete(project.id, e)}
              aria-label={`移入回收站 ${project.name}`}
              title="移入回收站"
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function HomeDialog({
  open,
  onOpenChange,
  title,
  description,
  theme,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  theme: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="home-dialog-backdrop" />
        <Dialog.Content className="m3-home home-dialog" data-theme={theme}>
          <Dialog.Title className="home-dialog-title">{title}</Dialog.Title>
          <Dialog.Description className="home-dialog-description">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
