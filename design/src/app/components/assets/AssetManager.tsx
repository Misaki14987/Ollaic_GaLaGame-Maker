import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  Upload,
  Search,
  Image,
  Music,
  Users,
  FolderOpen,
  Grid3x3,
  List,
  Play,
  Pause,
  Trash2,
  Edit3,
  Plus,
  Sparkles,
  Loader2,
  AlertTriangle,
  Copy,
  X,
  Award,
  Eye,
} from 'lucide-react';
import {
  listAssets,
  listAllAssets,
  importAsset,
  saveGeneratedAsset,
  deleteAsset,
  findAssetUsages,
  renameAsset,
  type AssetInfo,
  type AssetUsage,
  type SceneAssetCard,
  type VoiceAssetCard,
} from '@/app/lib/assets/assets-ipc';
import {
  assetMetadataEntry,
  emptyAssetMetadata,
  flushAssetMetadataSaves,
  loadAssetMetadata,
  referenceCategoryForAsset,
  referenceFilePath,
  renameAssetMetadataFilename,
  saveAssetMetadata,
  setAssetAlias,
  setAssetDescription,
  setAssetReferences,
  sceneCardId,
  defaultSceneTargetStem,
  defaultCgTargetStem,
  extractSceneBgmAssets,
  type AssetMetadata,
} from '@/app/lib/assets/asset-metadata';
import {
  getAiImageConfig,
  getAiTtsConfig,
  getAiMusicConfig,
  aiGenerateImage,
  aiGenerateTts,
  generateMusic,
  listenAiMediaGenerationProgress,
  type AiProviderConfig,
  type AiMediaGenerationProgress,
} from '@/app/lib/ai/ai-ipc';
import { getScenePath, loadScene, openProject, saveScene } from '@/app/lib/webgal/webgal-ipc';
import type { WebGalNode } from '@/app/lib/webgal/webgal-types';
import { listCharacters } from '@/app/lib/character/character-ipc';
import { CharacterPanel } from '@/app/components/character/CharacterPanel';
import { StoryOsSideNav, StoryOsTopBar } from '@/app/components/shell/StoryOsChrome';
import { VoiceDubbingPanel } from '@/app/components/assets/VoiceDubbingPanel';
import {
  musicTabs,
  musicCategoryLabels,
  voiceEmotionOptions,
  tabConfig,
  tabToCategories,
  isImageExt,
  isAudioExt,
  formatSize,
  formatCategory,
  formatDuration,
  getSafeAudioDuration,
  sceneCardTargetFilename,
  hashText,
  safeStem,
  voiceCardId,
  voiceTargetStem,
  legacyVoiceTargetStem,
  normalizeVoiceFilename,
  voiceFilenameStem,
  countUsages,
  getImportConfig,
  getAudioDurationLabel,
  normalizeRenamedAssetFilename,
  replaceBackgroundReferencesInScenes,
  type TabId,
  type MusicCategory,
} from './asset-utils';
import { AssetAiGenerateDialog } from './AssetAiGenerateDialog';
import { VoiceCardDetails } from './VoiceCardDetails';
import { SceneCardDetails } from './SceneCardDetails';

type SceneLibraryItem =
  | { kind: 'sceneCard'; card: SceneAssetCard; asset?: AssetInfo }
  | { kind: 'asset'; asset: AssetInfo };
type VoiceLibraryItem = { kind: 'asset'; asset: AssetInfo };


export function AssetManager() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabId>(
    searchParams.get('tab') === 'character' ? 'character' : 'scene',
  );
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<AssetInfo | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [musicCategory, setMusicCategory] = useState<MusicCategory>('bgm');
  const [characterCount, setCharacterCount] = useState(0);
  const [figureLibraryRefreshToken, setFigureLibraryRefreshToken] = useState(0);
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
  const [audioMetadataErrors, setAudioMetadataErrors] = useState<Record<string, boolean>>({});
  const [audioProgress, setAudioProgress] = useState<Record<string, number>>({});
  const [assetUsages, setAssetUsages] = useState<AssetUsage[]>([]);
  const [metadata, setMetadata] = useState<AssetMetadata>(() => emptyAssetMetadata());
  const metadataRef = useRef<AssetMetadata>(emptyAssetMetadata());
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [editingSceneCard, setEditingSceneCard] = useState<SceneAssetCard | null>(null);
  const [selectedSceneCard, setSelectedSceneCard] = useState<SceneAssetCard | null>(null);
  const [selectedCgCard, setSelectedCgCard] = useState<SceneAssetCard | null>(null);
  const [voiceCards, setVoiceCards] = useState<VoiceAssetCard[]>([]);
  const [selectedVoiceCard, setSelectedVoiceCard] = useState<VoiceAssetCard | null>(null);
  const [aiAssetPrompt, setAiAssetPrompt] = useState('');
  const [aiMusicFilename, setAiMusicFilename] = useState<string | null>(null);
  // BGM references scanned from scene scripts: filename + whether the file exists.
  const [bgmReferences, setBgmReferences] = useState<{ filename: string; exists: boolean }[]>([]);

  // Real data state
  const [projectPath, setProjectPath] = useState<string>('');
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [allAssets, setAllAssets] = useState<AssetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const applyMetadata = useCallback((metadata: AssetMetadata) => {
    metadataRef.current = metadata;
    setMetadata(metadata);
  }, []);

  const vocalAssetNames = useMemo(
    () =>
      new Set(allAssets.filter((asset) => asset.category === 'vocal').map((asset) => asset.name)),
    [allAssets],
  );
  const bgmAssetNames = useMemo(
    () => new Set(allAssets.filter((asset) => asset.category === 'bgm').map((asset) => asset.name)),
    [allAssets],
  );

  // Load project path
  useEffect(() => {
    const path = localStorage.getItem(`project-path-${projectId}`);
    if (path) {
      setProjectPath(path);
    } else {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'character') {
      setActiveTab('character');
    } else if (!tabParam) {
      setActiveTab('scene');
    }
  }, [searchParams]);

  // Load assets on mount and tab change
  const loadAssetsForTab = useCallback(
    async (tab: TabId, path: string, musicSubtab: MusicCategory) => {
      setLoading(true);
      setError(null);
      try {
        const cats =
          tab === 'music'
            ? [musicSubtab === 'dubbing' ? 'vocal' : musicSubtab]
            : tabToCategories(tab);
        const results = await Promise.all(cats.map((c) => listAssets(path, c)));
        const all = results.flat();
        setAssets(all);
      } catch (e) {
        setError(String(e));
        setAssets([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Load all assets for counts and "all folders" view
  const loadAllAssets = useCallback(async (path: string) => {
    try {
      const all = await listAllAssets(path);
      setAllAssets(all);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    if (!projectPath) return;
    loadAssetsForTab(activeTab, projectPath, musicCategory);
    loadAllAssets(projectPath);
    // 切换到场景 Tab 时重新加载 metadata，以便看到脚本流中新建的场景卡片
    if (activeTab === 'scene') {
      loadAssetMetadata(projectPath, projectId)
        .then(applyMetadata)
        .catch((e) => setError(String(e)));
    }
  }, [
    projectPath,
    activeTab,
    musicCategory,
    loadAssetsForTab,
    loadAllAssets,
    applyMetadata,
    projectId,
  ]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    listCharacters(projectPath)
      .then((list) => {
        if (!cancelled) setCharacterCount(list.length);
      })
      .catch(() => {
        if (!cancelled) setCharacterCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, figureLibraryRefreshToken]);

  // Load usage map for all assets to power "Used in X scenes" badges
  useEffect(() => {
    if (!projectPath) {
      setAssetUsages([]);
      return;
    }
    let cancelled = false;
    const loadAllUsages = async () => {
      try {
        const results = await Promise.all(
          allAssets.map((a) => findAssetUsages(projectPath, a.name, a.category).catch(() => [])),
        );
        if (cancelled) return;
        const flat = results.flat();
        setAssetUsages(flat);
      } catch {
        if (!cancelled) setAssetUsages([]);
      }
    };
    loadAllUsages();
    return () => {
      cancelled = true;
    };
  }, [projectPath, allAssets]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    loadAssetMetadata(projectPath, projectId)
      .then((next) => {
        if (!cancelled) applyMetadata(next);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [applyMetadata, projectId, projectPath]);

  useEffect(() => {
    const isVoiceWorkspace =
      activeTab === 'music' && (musicCategory === 'dubbing' || musicCategory === 'vocal');
    if (!projectPath || (!isVoiceWorkspace && activeTab !== 'dubbing')) {
      if (!isVoiceWorkspace && activeTab !== 'dubbing') setVoiceCards([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await openProject(projectPath);
        const cardMap = new Map<string, VoiceAssetCard>();
        let metadataChanged = false;
        const nextMetadata: AssetMetadata = {
          ...metadataRef.current,
          voiceCards: { ...(metadataRef.current.voiceCards ?? {}) },
        };
        for (const sceneName of info.scenes) {
          const scenePath = await getScenePath(projectPath, sceneName);
          const nodes = await loadScene(scenePath);
          nodes.forEach((node: WebGalNode, index: number) => {
            if (node.type !== 'dialogue') return;
            const text = node.content.trim();
            if (!text) return;
            const character = (node.character ?? '').trim();
            const storedCards = nextMetadata.voiceCards ?? {};
            const legacyId = hashText(`${character}\n${text}`);
            const legacyStored = storedCards[legacyId];
            const emotion = legacyStored?.emotion || '默认';
            const id = voiceCardId(character, text, emotion);
            if ((nextMetadata.deletedVoiceCards ?? []).includes(id)) return;
            const stored = storedCards[id] ?? legacyStored;
            const sceneStem = sceneName.replace(/\.txt$/i, '');
            const freshStem = voiceTargetStem(character, sceneStem, index + 1);
            // Use the readable scene+line stem for new cards, and migrate any
            // still using the auto-generated hash stem; keep manually edited ones.
            const isAutoStem =
              !stored?.targetStem || stored.targetStem === legacyVoiceTargetStem(character, text);
            const targetStem = isAutoStem ? freshStem : stored.targetStem;
            const linkedVoice = stored?.voiceAsset ?? node.voice ?? null;
            const voiceAsset = linkedVoice && vocalAssetNames.has(linkedVoice) ? linkedVoice : null;
            const existing = cardMap.get(id);
            const usage: AssetUsage = {
              sceneFile: sceneName,
              lineNumber: index + 1,
              lineContent: `${character ? `${character}:` : ':'}${text};`,
              command: 'voice',
            };
            if (existing) {
              existing.usages = [...(existing.usages ?? []), usage];
              if (!existing.voiceAsset && voiceAsset) existing.voiceAsset = voiceAsset;
              return;
            }
            const card: VoiceAssetCard = {
              id,
              character,
              text,
              emotion: stored?.emotion || emotion,
              voiceAsset,
              targetStem,
              prompt: stored?.prompt || '',
              usages: [usage],
            };
            cardMap.set(id, card);

            const storedCard = nextMetadata.voiceCards[id];
            if (
              !storedCard ||
              storedCard.character !== card.character ||
              storedCard.text !== card.text ||
              storedCard.emotion !== card.emotion ||
              storedCard.targetStem !== card.targetStem ||
              (storedCard.prompt ?? '') !== card.prompt
            ) {
              nextMetadata.voiceCards[id] = {
                id: card.id,
                character: card.character,
                text: card.text,
                emotion: card.emotion,
                voiceAsset: stored?.voiceAsset ?? null,
                targetStem: card.targetStem,
                prompt: card.prompt,
              };
              metadataChanged = true;
            }
          });
        }
        if (metadataChanged) {
          await saveAssetMetadata(projectPath, nextMetadata);
          if (!cancelled) applyMetadata(nextMetadata);
        }
        if (!cancelled) setVoiceCards(Array.from(cardMap.values()));
      } catch (e) {
        if (!cancelled) {
          setVoiceCards([]);
          setError(String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, applyMetadata, musicCategory, projectPath, metadata, vocalAssetNames]);

  // Scan scene scripts for bgm: references so BGM mirrors the background-image
  // model: a referenced file that doesn't exist yet becomes a "to-generate" item.
  useEffect(() => {
    const isBgmWorkspace = activeTab === 'music' && musicCategory === 'bgm';
    if (!projectPath || !isBgmWorkspace) {
      if (!isBgmWorkspace) setBgmReferences([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await openProject(projectPath);
        const seen = new Set<string>();
        const refs: { filename: string; exists: boolean }[] = [];
        for (const sceneName of info.scenes) {
          const scenePath = await getScenePath(projectPath, sceneName);
          const nodes = await loadScene(scenePath);
          for (const filename of extractSceneBgmAssets(nodes)) {
            if (seen.has(filename)) continue;
            seen.add(filename);
            refs.push({ filename, exists: bgmAssetNames.has(filename) });
          }
        }
        if (!cancelled) setBgmReferences(refs);
      } catch (e) {
        if (!cancelled) {
          setBgmReferences([]);
          setError(String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, musicCategory, projectPath, bgmAssetNames]);

  const aliasForAsset = (asset: Pick<AssetInfo, 'category' | 'name'>): string =>
    assetMetadataEntry(metadata.aliases, asset.category, asset.name) ?? '';
  const descriptionForAsset = (asset: Pick<AssetInfo, 'category' | 'name'>): string =>
    assetMetadataEntry(metadata.descriptions, asset.category, asset.name) ?? '';
  const referencesForAsset = (asset: Pick<AssetInfo, 'category' | 'name'>): string[] =>
    assetMetadataEntry(metadata.references, asset.category, asset.name) ?? [];
  const sceneCardReferences = (() => {
    if (!selectedSceneCard) return [];
    const filename = sceneCardTargetFilename(selectedSceneCard);
    return assetMetadataEntry(metadata.references, 'background', filename) ?? [];
  })();
  const cgCardReferences = (() => {
    if (!selectedCgCard) return [];
    const filename = sceneCardTargetFilename(selectedCgCard);
    return assetMetadataEntry(metadata.references, 'background', filename) ?? [];
  })();

  const filteredAssets = useMemo(
    () =>
      assets.filter((a) => {
        const q = searchQuery.toLowerCase();
        return a.name.toLowerCase().includes(q) || aliasForAsset(a).toLowerCase().includes(q);
      }),
    [assets, searchQuery, metadata],
  );

  const sceneLibraryItems: SceneLibraryItem[] = useMemo(() => {
    const cards = Object.values(metadata.sceneCards ?? {});
    const assetByName = new Map(assets.map((asset) => [asset.name, asset]));
    const usedAssets = new Set<string>();
    const cardItems = cards.map((card) => {
      const asset = card.imageAsset ? assetByName.get(card.imageAsset) : undefined;
      if (asset) usedAssets.add(asset.name);
      return { kind: 'sceneCard' as const, card, asset };
    });
    const looseAssets = assets
      .filter((asset) => !usedAssets.has(asset.name))
      .map((asset) => ({ kind: 'asset' as const, asset }));
    return [...cardItems, ...looseAssets].filter((item) => {
      const q = searchQuery.toLowerCase();
      if (!q) return true;
      if (item.kind === 'sceneCard') {
        return (
          item.card.title.toLowerCase().includes(q) ||
          item.card.prompt.toLowerCase().includes(q) ||
          (item.card.sceneFile ?? '').toLowerCase().includes(q) ||
          (item.card.imageAsset ?? '').toLowerCase().includes(q) ||
          (item.card.targetStem ?? '').toLowerCase().includes(q)
        );
      }
      return (
        item.asset.name.toLowerCase().includes(q) ||
        aliasForAsset(item.asset).toLowerCase().includes(q)
      );
    });
  }, [assets, searchQuery, metadata]);

  // CG 卡片流：与场景独立的卡片集合，只展示 cgCards（不混入背景散图，体现 CG ≠ 背景）。
  const cgLibraryItems: SceneLibraryItem[] = useMemo(() => {
    const cards = Object.values(metadata.cgCards ?? {});
    const assetByName = new Map(assets.map((asset) => [asset.name, asset]));
    const cardItems = cards.map((card) => {
      const asset = card.imageAsset ? assetByName.get(card.imageAsset) : undefined;
      return { kind: 'sceneCard' as const, card, asset };
    });
    const q = searchQuery.toLowerCase();
    return cardItems.filter((item) => {
      if (!q) return true;
      return (
        item.card.title.toLowerCase().includes(q) ||
        item.card.prompt.toLowerCase().includes(q) ||
        (item.card.imageAsset ?? '').toLowerCase().includes(q) ||
        (item.card.targetStem ?? '').toLowerCase().includes(q)
      );
    });
  }, [assets, searchQuery, metadata]);

  const voiceLibraryItems: VoiceLibraryItem[] = useMemo(() => {
    const fileItems = assets
      .filter((asset) => asset.category === 'vocal')
      .map((asset) => ({ kind: 'asset' as const, asset }));
    const q = searchQuery.toLowerCase();
    return fileItems.filter((item) => {
      if (!q) return true;
      return (
        item.asset.name.toLowerCase().includes(q) ||
        aliasForAsset(item.asset).toLowerCase().includes(q)
      );
    });
  }, [assets, searchQuery, metadata]);

  // Tab counts from real files only. Planning cards such as scene cards and
  // dubbing tasks have their own workspace and should not inflate asset counts.
  const tabCounts = {
    scene: allAssets.filter((a) => a.category === 'background').length,
    cg: Object.keys(metadata.cgCards ?? {}).length,
    music: allAssets.filter((a) => a.category === 'bgm' || a.category === 'vocal').length,
    character: characterCount,
    dubbing: 0,
  };

  const importConfig = getImportConfig(activeTab, musicCategory);
  const isDubbingWorkspace = activeTab === 'music' && musicCategory === 'dubbing';
  const showAiAction = !(
    activeTab === 'music' &&
    (musicCategory === 'dubbing' || musicCategory === 'vocal')
  );
  const aiActionLabel =
    activeTab === 'scene'
      ? '新建场景'
      : activeTab === 'cg'
        ? '新建 CG'
        : activeTab === 'music'
          ? `AI 生成${musicCategoryLabels[musicCategory]}`
          : '批量生成当前角色立绘';

  // --- Actions ---
  const handleImport = useCallback(async () => {
    if (!projectPath || !importConfig) return;
    const path = await openDialog({
      title: importConfig.title,
      filters: importConfig.filters,
    });
    if (!path) return;

    setImporting(true);
    setError(null);
    try {
      const cats = activeTab === 'music' ? [musicCategory] : tabToCategories(activeTab);
      const info = await importAsset(Array.isArray(path) ? path[0] : path, projectPath, cats[0]);
      setAssets((prev) => [info, ...prev]);
      if (activeTab === 'character') {
        setFigureLibraryRefreshToken((value) => value + 1);
      }
      // Refresh all assets for updated counts
      loadAllAssets(projectPath);
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }, [projectPath, activeTab, importConfig, musicCategory, loadAllAssets]);

  const handleDelete = useCallback(
    async (asset?: AssetInfo) => {
      const target = asset ?? selectedAsset;
      if (!target || !projectPath) return;

      try {
        const usages = await findAssetUsages(projectPath, target.name, target.category);
        const usageWarning =
          usages.length > 0
            ? `\n该素材仍被 ${usages.length} 处剧本引用，删除后这些引用将失效。`
            : '';
        if (!confirm(`确定删除 "${target.name}"？（不可恢复）${usageWarning}`)) return;
        await flushAssetMetadataSaves(projectPath);
        await deleteAsset(projectPath, target.category, target.name);
        setAssets((prev) => prev.filter((a) => a.path !== target.path));
        setAllAssets((prev) => prev.filter((a) => a.path !== target.path));
        applyMetadata(await loadAssetMetadata(projectPath));
        if (selectedAsset?.path === target.path) setSelectedAsset(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [applyMetadata, selectedAsset, projectPath],
  );

  const handleRename = useCallback(async () => {
    if (!selectedAsset || !projectPath) return;
    const ext = selectedAsset.extension;
    const stem = selectedAsset.name.slice(0, -(ext.length + 1));
    const newName = prompt('输入新名称:', stem);
    if (!newName || newName === stem) return;

    const fullNewName = normalizeRenamedAssetFilename(newName, ext);
    if (fullNewName === selectedAsset.name) return;
    try {
      await flushAssetMetadataSaves(projectPath);
      const usages =
        selectedAsset.category === 'background'
          ? await findAssetUsages(projectPath, selectedAsset.name, selectedAsset.category)
          : [];
      if (usages.length > 0) {
        const ok = confirm(
          `该图片被 ${usages.length} 处剧本引用。重命名后将同步更新这些引用。\n\n${selectedAsset.name} -> ${fullNewName}`,
        );
        if (!ok) return;
      }
      const info = await renameAsset(
        projectPath,
        selectedAsset.category,
        selectedAsset.name,
        fullNewName,
      );
      if (selectedAsset.category === 'background') {
        await replaceBackgroundReferencesInScenes(
          projectPath,
          usages,
          selectedAsset.name,
          fullNewName,
        );
      }
      setAssets((prev) => prev.map((a) => (a.path === selectedAsset.path ? info : a)));
      setAllAssets((prev) => prev.map((a) => (a.path === selectedAsset.path ? info : a)));
      const nextMetadata = renameAssetMetadataFilename(
        await loadAssetMetadata(projectPath),
        selectedAsset.category,
        selectedAsset.name,
        fullNewName,
      );
      await saveAssetMetadata(projectPath, nextMetadata);
      applyMetadata(nextMetadata);
      setSelectedAsset(info);
      if (selectedSceneCard?.imageAsset === selectedAsset.name) {
        setSelectedSceneCard({ ...selectedSceneCard, imageAsset: fullNewName });
      }
    } catch (e) {
      setError(String(e));
    }
  }, [applyMetadata, projectPath, selectedAsset, selectedSceneCard]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayToggle = useCallback(
    async (assetPath: string) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (playingAudio === assetPath) {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute('src');
        audio.load();
        setPlayingAudio(null);
        return;
      }

      setError(null);
      setAudioProgress((prev) => ({ ...prev, [assetPath]: 0 }));
      audio.pause();
      audio.src = convertFileSrc(assetPath);
      audio.load();

      try {
        await audio.play();
        setPlayingAudio(assetPath);
      } catch (e) {
        setPlayingAudio(null);
        setError(`无法播放音频：${String(e)}`);
      }
    },
    [playingAudio],
  );

  const persistMetadata = useCallback(
    (next: AssetMetadata) => {
      applyMetadata(next);
      if (!projectPath) return;
      void saveAssetMetadata(projectPath, next).catch((e) => setError(String(e)));
    },
    [applyMetadata, projectPath],
  );

  const handleReferenceUpload = useCallback(async () => {
    if (!selectedAsset || !projectPath) return;
    const isAudioReference = selectedAsset.category !== 'background';
    const referenceCategory = referenceCategoryForAsset(selectedAsset.category, selectedAsset.name);
    if (!referenceCategory) return;
    const path = await openDialog({
      title: isAudioReference ? '上传参考音频' : '上传参考图',
      filters: [
        {
          name: isAudioReference ? '音频文件' : '图片文件',
          extensions: isAudioReference
            ? ['mp3', 'ogg', 'wav', 'flac', 'aac']
            : ['png', 'jpg', 'jpeg', 'webp'],
        },
      ],
    });
    if (!path) return;

    setReferenceUploading(true);
    setError(null);
    try {
      const info = await importAsset(
        Array.isArray(path) ? path[0] : path,
        projectPath,
        referenceCategory,
      );
      const currentMetadata = metadataRef.current;
      const current =
        assetMetadataEntry(
          currentMetadata.references,
          selectedAsset.category,
          selectedAsset.name,
        ) ?? [];
      persistMetadata(
        setAssetReferences(currentMetadata, selectedAsset.category, selectedAsset.name, [
          ...current,
          info.name,
        ]),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setReferenceUploading(false);
    }
  }, [persistMetadata, projectPath, selectedAsset]);

  const handleReferenceRemove = useCallback(
    async (filename: string) => {
      if (!selectedAsset || !projectPath) return;
      const referenceCategory = referenceCategoryForAsset(
        selectedAsset.category,
        selectedAsset.name,
      );
      if (!referenceCategory) return;
      try {
        await deleteAsset(projectPath, referenceCategory, filename);
      } catch {
        // Keep the local reference list clean even if the backing file was already gone.
      }
      const currentMetadata = metadataRef.current;
      const current =
        assetMetadataEntry(
          currentMetadata.references,
          selectedAsset.category,
          selectedAsset.name,
        ) ?? [];
      persistMetadata(
        setAssetReferences(
          currentMetadata,
          selectedAsset.category,
          selectedAsset.name,
          current.filter((name) => name !== filename),
        ),
      );
    },
    [persistMetadata, projectPath, selectedAsset],
  );

  const handleSceneCardReferenceUpload = useCallback(
    async (card: SceneAssetCard) => {
      if (!projectPath) return;
      const targetFilename = sceneCardTargetFilename(card);
      const referenceCategory = referenceCategoryForAsset('background', targetFilename);
      if (!referenceCategory) return;
      const path = await openDialog({
        title: '上传参考图',
        filters: [
          {
            name: '图片文件',
            extensions: ['png', 'jpg', 'jpeg', 'webp'],
          },
        ],
      });
      if (!path) return;

      setReferenceUploading(true);
      setError(null);
      try {
        const info = await importAsset(
          Array.isArray(path) ? path[0] : path,
          projectPath,
          referenceCategory,
        );
        const currentMetadata = metadataRef.current;
        const current =
          assetMetadataEntry(currentMetadata.references, 'background', targetFilename) ?? [];
        persistMetadata(
          setAssetReferences(currentMetadata, 'background', targetFilename, [
            ...current,
            info.name,
          ]),
        );
      } catch (e) {
        setError(String(e));
      } finally {
        setReferenceUploading(false);
      }
    },
    [persistMetadata, projectPath],
  );

  const handleSceneCardReferenceRemove = useCallback(
    async (card: SceneAssetCard, filename: string) => {
      if (!projectPath) return;
      const targetFilename = sceneCardTargetFilename(card);
      const referenceCategory = referenceCategoryForAsset('background', targetFilename);
      if (!referenceCategory) return;
      try {
        await deleteAsset(projectPath, referenceCategory, filename);
      } catch {
        // Keep metadata clean even when the file has already been removed.
      }
      const currentMetadata = metadataRef.current;
      const current =
        assetMetadataEntry(currentMetadata.references, 'background', targetFilename) ?? [];
      persistMetadata(
        setAssetReferences(
          currentMetadata,
          'background',
          targetFilename,
          current.filter((name) => name !== filename),
        ),
      );
    },
    [persistMetadata, projectPath],
  );

  // Keep the shared audio element in sync when playback is cleared externally.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!playingAudio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    }
  }, [playingAudio]);

  useEffect(() => {
    if (!selectedAsset || !projectPath) {
      setAssetUsages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const usages = await findAssetUsages(
          projectPath,
          selectedAsset.name,
          selectedAsset.category,
        );
        if (!cancelled) setAssetUsages(usages);
      } catch {
        if (!cancelled) setAssetUsages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, selectedAsset]);

  const displayedAssetUsages = useMemo(() => {
    if (!selectedAsset || selectedAsset.category !== 'vocal') return assetUsages;
    const linkedVoiceUsages = voiceCards
      .filter((card) => card.voiceAsset === selectedAsset.name)
      .flatMap((card) => card.usages ?? []);
    const usageMap = new Map<string, AssetUsage>();
    for (const usage of [...assetUsages, ...linkedVoiceUsages]) {
      const key = `${usage.sceneFile}:${usage.lineNumber}:${usage.command}:${usage.lineContent}`;
      usageMap.set(key, usage);
    }
    return Array.from(usageMap.values());
  }, [assetUsages, selectedAsset, voiceCards]);

  const openUsage = useCallback(
    (usage: AssetUsage) => {
      navigate(
        `/editor/${projectId}?scene=${encodeURIComponent(usage.sceneFile)}&line=${usage.lineNumber}`,
      );
    },
    [navigate, projectId],
  );

  // Thumbnail URL
  const getThumbnail = (asset: AssetInfo): string | null => {
    if (isImageExt(asset.extension)) {
      return convertFileSrc(asset.path);
    }
    return null;
  };

  const handleAliasChange = (asset: AssetInfo, alias: string) => {
    persistMetadata(setAssetAlias(metadata, asset.category, asset.name, alias));
  };

  const handleDescriptionChange = (asset: AssetInfo, description: string) => {
    persistMetadata(setAssetDescription(metadata, asset.category, asset.name, description));
  };

  const handleGenerateFromAsset = (asset: AssetInfo) => {
    if (asset.category === 'background') {
      const stem = asset.name.replace(/\.[^.]+$/, '');
      setEditingSceneCard({
        id: sceneCardId(stem),
        title: aliasForAsset(asset) || stem,
        sceneFile: null,
        imageAsset: asset.name,
        targetStem: stem,
        prompt: descriptionForAsset(asset),
        style: '',
        negativePrompt: '',
      });
      setAiGenerateOpen(true);
      return;
    }
    setEditingSceneCard(null);
    setAiAssetPrompt(descriptionForAsset(asset));
    setAiGenerateOpen(true);
  };

  const handleEditSceneCard = useCallback((card: SceneAssetCard) => {
    setSelectedSceneCard(card);
    setEditingSceneCard(card);
    setSelectedAsset(null);
    setSelectedVoiceCard(null);
  }, []);

  const handleSaveSceneCard = useCallback(
    (card: SceneAssetCard) => {
      const currentMetadata = metadataRef.current;
      persistMetadata({
        ...currentMetadata,
        deletedSceneCards: (currentMetadata.deletedSceneCards ?? []).filter((id) => id !== card.id),
        sceneCards: {
          ...(currentMetadata.sceneCards ?? {}),
          [card.id]: card,
        },
      });
      setSelectedSceneCard(card);
    },
    [persistMetadata],
  );

  const handleSaveCgCard = useCallback(
    (card: SceneAssetCard) => {
      const currentMetadata = metadataRef.current;
      persistMetadata({
        ...currentMetadata,
        deletedCgCards: (currentMetadata.deletedCgCards ?? []).filter((id) => id !== card.id),
        cgCards: {
          ...(currentMetadata.cgCards ?? {}),
          [card.id]: card,
        },
      });
      setSelectedCgCard(card);
    },
    [persistMetadata],
  );

  const handleNewCgCard = useCallback(() => {
    const index = Object.keys(metadataRef.current.cgCards ?? {}).length + 1;
    const card: SceneAssetCard = {
      id: `cg-${Date.now()}`,
      title: '新 CG',
      sceneFile: null,
      imageAsset: null,
      targetStem: defaultCgTargetStem(index),
      prompt: '',
      style: '',
      negativePrompt: '',
    };
    const currentMetadata = metadataRef.current;
    persistMetadata({
      ...currentMetadata,
      cgCards: { ...(currentMetadata.cgCards ?? {}), [card.id]: card },
    });
    setSelectedCgCard(card);
    setSelectedSceneCard(null);
    setSelectedAsset(null);
    setSelectedVoiceCard(null);
    setEditingSceneCard(null);
  }, [persistMetadata]);

  const handleDeleteCgCard = useCallback(
    (card: SceneAssetCard) => {
      if (
        !confirm(
          `确定删除 CG "${card.title || card.targetStem || card.id}"？\n绑定的图片文件不会被删除。`,
        )
      )
        return;
      const currentMetadata = metadataRef.current;
      const nextCgCards = { ...(currentMetadata.cgCards ?? {}) };
      delete nextCgCards[card.id];
      const deletedCgCards = Array.from(
        new Set([...(currentMetadata.deletedCgCards ?? []), card.id]),
      );
      persistMetadata({
        ...currentMetadata,
        cgCards: nextCgCards,
        deletedCgCards,
      });
      if (selectedCgCard?.id === card.id) {
        setSelectedCgCard(null);
        setEditingSceneCard(null);
      }
    },
    [persistMetadata, selectedCgCard],
  );

  const handleSaveVoiceCard = useCallback(
    (card: VoiceAssetCard) => {
      const currentMetadata = metadataRef.current;
      const normalizedCard = {
        ...card,
        id: voiceCardId(card.character, card.text, card.emotion || '默认'),
        emotion: card.emotion || '默认',
      };
      const nextVoiceCards = { ...(currentMetadata.voiceCards ?? {}) };
      if (normalizedCard.id !== card.id) delete nextVoiceCards[card.id];
      nextVoiceCards[normalizedCard.id] = {
        id: normalizedCard.id,
        character: normalizedCard.character,
        text: normalizedCard.text,
        emotion: normalizedCard.emotion,
        voiceAsset: normalizedCard.voiceAsset ?? null,
        targetStem: normalizedCard.targetStem,
        prompt: normalizedCard.prompt,
      };
      persistMetadata({
        ...currentMetadata,
        voiceCards: nextVoiceCards,
        deletedVoiceCards: (currentMetadata.deletedVoiceCards ?? []).filter(
          (id) => id !== normalizedCard.id && id !== card.id,
        ),
      });
      setSelectedVoiceCard(normalizedCard);
      setVoiceCards((current) =>
        current.map((item) => (item.id === card.id ? normalizedCard : item)),
      );
    },
    [persistMetadata],
  );

  const handleDeleteSceneCard = useCallback(
    (card: SceneAssetCard) => {
      if (
        !confirm(
          `确定删除场景卡 "${card.title || card.targetStem || card.id}"？\n绑定的图片文件不会被删除。`,
        )
      )
        return;
      const currentMetadata = metadataRef.current;
      const nextSceneCards = { ...(currentMetadata.sceneCards ?? {}) };
      delete nextSceneCards[card.id];
      const deletedSceneCards = Array.from(
        new Set([...(currentMetadata.deletedSceneCards ?? []), card.id]),
      );
      persistMetadata({
        ...currentMetadata,
        sceneCards: nextSceneCards,
        deletedSceneCards,
      });
      if (selectedSceneCard?.id === card.id) {
        setSelectedSceneCard(null);
        setEditingSceneCard(null);
      }
    },
    [persistMetadata, selectedSceneCard],
  );

  const handleDeleteVoiceCard = useCallback(
    (card: VoiceAssetCard) => {
      if (!confirm(`确定删除 "${card.character || '旁白'}：${card.text}"？`)) return;
      const currentMetadata = metadataRef.current;
      const nextVoiceCards = { ...(currentMetadata.voiceCards ?? {}) };
      delete nextVoiceCards[card.id];
      const deletedVoiceCards = Array.from(
        new Set([...(currentMetadata.deletedVoiceCards ?? []), card.id]),
      );
      persistMetadata({
        ...currentMetadata,
        voiceCards: nextVoiceCards,
        deletedVoiceCards,
      });
      setVoiceCards((current) => current.filter((item) => item.id !== card.id));
      if (selectedVoiceCard?.id === card.id) setSelectedVoiceCard(null);
    },
    [persistMetadata, selectedVoiceCard],
  );

  const applySceneBackgroundReference = useCallback(
    async (sceneFile: string, assetName: string) => {
      if (!projectPath) return;
      const scenePath = await getScenePath(projectPath, sceneFile);
      const nodes = await loadScene(scenePath);
      const nextNode: WebGalNode = {
        id: `changeBg-${Date.now()}`,
        type: 'changeBg',
        content: assetName,
        asset: assetName,
        flags: [{ key: 'next', value: true }],
        position: { x: 0, y: 0 },
        connections: [],
      };
      // Prefer the changeBg node that already references this exact background
      // (generated filename == the script reference for "to-generate" cards), so
      // scenes with multiple backgrounds don't get the wrong node overwritten.
      // Only fall back to the first changeBg / top insertion when nothing matches.
      const matchIndex = nodes.findIndex(
        (node) =>
          node.type === 'changeBg' && (node.asset || node.content || '').trim() === assetName,
      );
      const index =
        matchIndex >= 0 ? matchIndex : nodes.findIndex((node) => node.type === 'changeBg');
      const nextNodes =
        index >= 0
          ? nodes.map((node, nodeIndex) =>
              nodeIndex === index ? { ...node, content: assetName, asset: assetName } : node,
            )
          : [nextNode, ...nodes];
      await saveScene(scenePath, nextNodes);
    },
    [projectPath],
  );

  const handleNewSceneCard = useCallback(() => {
    const index = Object.keys(metadataRef.current.sceneCards ?? {}).length + 1;
    const card: SceneAssetCard = {
      id: `scene-${Date.now()}`,
      title: '新场景',
      sceneFile: null,
      imageAsset: null,
      targetStem: defaultSceneTargetStem(index),
      prompt: '',
      style: '',
      negativePrompt: '',
    };
    const currentMetadata = metadataRef.current;
    persistMetadata({
      ...currentMetadata,
      sceneCards: { ...(currentMetadata.sceneCards ?? {}), [card.id]: card },
    });
    // Open the right-side details panel for the empty card (same as clicking an
    // existing background), instead of jumping straight into AI generation.
    setSelectedSceneCard(card);
    setEditingSceneCard(card);
    setSelectedAsset(null);
    setSelectedVoiceCard(null);
  }, [persistMetadata]);

  return (
    <div className="h-full story-shell">
      <StoryOsTopBar
        title="素材库"
        onRun={() => navigate(`/editor/${projectId}?action=preview`)}
        onPublish={() => navigate(`/editor/${projectId}?action=export`)}
      />
      <StoryOsSideNav
        active={activeTab === 'character' ? 'characters' : 'assets'}
        projectId={projectId}
        projectLabel={projectPath ? projectPath.split('/').pop() : 'ALPHA'}
        onCreate={handleImport}
      />

      {!projectPath ? (
        <div className="story-os-workspace flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>未找到项目路径，请从编辑器重新进入素材库</p>
          </div>
        </div>
      ) : (
        <div className="story-os-workspace flex bg-surface-container-lowest">
          <main className="relative flex-1 flex flex-col overflow-hidden bg-surface">
            <div className="flex h-12 items-end gap-1 border-b border-border bg-surface-container-low px-4 pt-2">
              {tabConfig.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveTab(id);
                    setSelectedAsset(null);
                    setSelectedSceneCard(null);
                    setSelectedCgCard(null);
                    setSelectedVoiceCard(null);
                    setEditingSceneCard(null);
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold tracking-wide transition-colors ${
                    activeTab === id
                      ? 'story-os-layered-tab-active text-foreground'
                      : 'rounded-t text-muted-foreground hover:bg-surface-container-highest hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">
                    {tabCounts[id]}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex h-10 items-center gap-2 border-b border-border bg-surface-container-lowest px-4">
              <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                {projectPath}
              </span>
              {showAiAction && activeTab !== 'character' && (
                <button
                  onClick={() => {
                    if (activeTab === 'scene') {
                      handleNewSceneCard();
                      return;
                    }
                    if (activeTab === 'cg') {
                      handleNewCgCard();
                      return;
                    }
                    setEditingSceneCard(null);
                    setAiAssetPrompt('');
                    setAiMusicFilename(null);
                    setAiGenerateOpen(true);
                  }}
                  className="story-os-command border-primary/30 bg-primary/10 text-primary"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {aiActionLabel}
                </button>
              )}
              {importConfig && activeTab !== 'character' && (
                <button
                  onClick={handleImport}
                  disabled={!projectPath || importing}
                  className="story-os-command story-os-command-primary story-os-chamfer-tr disabled:opacity-50"
                >
                  {importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {importing ? '导入中...' : importConfig.buttonLabel}
                </button>
              )}
            </div>
            {activeTab === 'dubbing' ? (
              <VoiceDubbingPanel
                projectPath={projectPath}
                voiceCards={voiceCards}
                vocalAssetNames={vocalAssetNames}
                selectedVoiceCard={selectedVoiceCard}
                onSelectVoiceCard={(card) => {
                  setSelectedVoiceCard(card);
                  setSelectedAsset(null);
                  setSelectedSceneCard(null);
                  setEditingSceneCard(null);
                }}
                onVoiceCardsChanged={async () => {
                  await loadAllAssets(projectPath);
                  const m = await loadAssetMetadata(projectPath);
                  applyMetadata(m);
                }}
              />
            ) : activeTab === 'character' ? (
              <CharacterPanel
                projectPath={projectPath}
                embedded
                onCharacterCountChange={setCharacterCount}
                figureLibraryRefreshToken={figureLibraryRefreshToken}
              />
            ) : (
              <>
                {/* Toolbar */}
                <div className="px-4 py-3 border-b border-border bg-surface-container-lowest flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 flex-1">
                    {activeTab === 'music' && (
                      <div className="flex items-center gap-1 bg-secondary/50 rounded-md p-1 flex-shrink-0">
                        {musicTabs.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                              setMusicCategory(tab.id);
                              setSelectedAsset(null);
                              setSelectedSceneCard(null);
                              setSelectedVoiceCard(null);
                            }}
                            className={`px-3 py-1.5 rounded text-xs transition-colors ${
                              musicCategory === tab.id
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-secondary'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {!isDubbingWorkspace && (
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="搜索素材名称..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 bg-input-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                    )}
                  </div>

                  {!isDubbingWorkspace && (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-secondary/50 rounded-md p-1">
                        <button
                          onClick={() => setViewMode('grid')}
                          className={`p-2 rounded transition-colors ${
                            viewMode === 'grid'
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-secondary'
                          }`}
                          aria-label="切换为网格视图"
                        >
                          <Grid3x3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setViewMode('list')}
                          className={`p-2 rounded transition-colors ${
                            viewMode === 'list'
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-secondary'
                          }`}
                          aria-label="切换为列表视图"
                        >
                          <List className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Error banner */}
                {error && (
                  <div className="mx-6 mt-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-sm text-destructive flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {error}
                    <button
                      onClick={() => setError(null)}
                      className="ml-auto text-xs underline hover:no-underline"
                    >
                      关闭
                    </button>
                  </div>
                )}

                {/* Pending BGM (referenced by scripts but not yet generated) */}
                {activeTab === 'music' && musicCategory === 'bgm' && bgmReferences.length > 0 && (
                  <div className="mx-6 mt-2 rounded-md border border-border bg-secondary/20 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      脚本引用的 BGM（
                      {bgmReferences.filter((r) => !r.exists).length} 个待生成）
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {bgmReferences.map((ref) => (
                        <div
                          key={ref.filename}
                          className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                            ref.exists
                              ? 'border-border bg-card/50 text-muted-foreground'
                              : 'border-primary/40 bg-primary/5'
                          }`}
                        >
                          <Music className="h-3.5 w-3.5 opacity-70" />
                          <span className="font-mono-family">{ref.filename}</span>
                          {ref.exists ? (
                            <span className="text-[10px] text-emerald-500">已生成</span>
                          ) : (
                            <button
                              onClick={() => {
                                setSelectedAsset(null);
                                setSelectedVoiceCard(null);
                                setSelectedSceneCard(null);
                                setEditingSceneCard(null);
                                setAiAssetPrompt(
                                  descriptionForAsset({
                                    category: 'bgm',
                                    name: ref.filename,
                                  }),
                                );
                                setAiMusicFilename(ref.filename);
                                setAiGenerateOpen(true);
                              }}
                              className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[10px] text-primary-foreground hover:opacity-90"
                            >
                              <Sparkles className="h-3 w-3" />
                              AI 生成
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assets Display */}
                <div className="flex-1 overflow-auto p-4">
                  {loading ? (
                    <div className="h-full flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : activeTab === 'scene' ? (
                    sceneLibraryItems.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                        <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
                        <p className="text-lg mb-2">暂无场景</p>
                        <p className="text-sm">点击右上角「新建场景」开始设定背景图</p>
                      </div>
                    ) : (
                      <div
                        className={
                          viewMode === 'grid'
                            ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
                            : 'space-y-2'
                        }
                      >
                        {sceneLibraryItems.map((item) => {
                          const card = item.kind === 'sceneCard' ? item.card : null;
                          const asset = item.kind === 'sceneCard' ? item.asset : item.asset;
                          const thumbnail = asset ? getThumbnail(asset) : null;
                          const title =
                            card?.title || (asset ? aliasForAsset(asset) || asset.name : '');
                          const subtitle = card
                            ? [card.sceneFile, card.imageAsset || `${card.targetStem}.png`]
                                .filter(Boolean)
                                .join(' · ') || '尚未生成图片'
                            : asset
                              ? asset.name
                              : '';
                          const isSelected = card
                            ? selectedSceneCard?.id === card.id
                            : asset
                              ? selectedAsset?.path === asset.path
                              : false;
                          const handleSelect = () => {
                            if (asset && !card) {
                              setSelectedAsset(asset);
                              setSelectedSceneCard(null);
                              setSelectedVoiceCard(null);
                              setEditingSceneCard(null);
                            } else if (card) {
                              setSelectedSceneCard(card);
                              setEditingSceneCard(card);
                              setSelectedAsset(null);
                              setSelectedVoiceCard(null);
                            }
                          };
                          const handleRemove = () => {
                            if (asset && !card) {
                              void handleDelete(asset);
                            } else if (card) {
                              handleDeleteSceneCard(card);
                            }
                          };
                          if (viewMode === 'list') {
                            return (
                              <div
                                key={card ? `scene-${card.id}` : `asset-${asset?.path}`}
                                onClick={handleSelect}
                                className={`group flex cursor-pointer items-center gap-4 rounded-lg border p-3 transition-all ${
                                  isSelected
                                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                                    : 'border-border bg-card/50 hover:border-secondary'
                                }`}
                              >
                                <div className="aspect-video h-16 flex-shrink-0 overflow-hidden rounded bg-secondary/30">
                                  {thumbnail ? (
                                    <img
                                      src={thumbnail}
                                      alt={title}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center">
                                      <Image className="h-6 w-6 text-muted-foreground/40" />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h3 className="truncate text-sm font-medium">{title}</h3>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {subtitle || (card ? '尚未生成图片' : '')}
                                  </p>
                                  {card?.prompt && (
                                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                                      {card.prompt}
                                    </p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemove();
                                  }}
                                  className="rounded-full p-2 text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                                  aria-label={asset && !card ? '删除素材' : '删除场景'}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={card ? `scene-${card.id}` : `asset-${asset?.path}`}
                              onClick={handleSelect}
                              className={`group overflow-hidden rounded-lg bg-card text-left transition-all hover:scale-[1.02] cursor-pointer ${
                                isSelected
                                  ? 'ring-2 ring-primary shadow-[0_0_20px_color-mix(in_srgb,var(--color-warm-glow)_60%,transparent)]'
                                  : 'hover:ring-1 hover:ring-border'
                              }`}
                            >
                              <div className="aspect-video bg-secondary/30 relative overflow-hidden">
                                {thumbnail ? (
                                  <img
                                    src={thumbnail}
                                    alt={title}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                                    <Image className="h-10 w-10 opacity-40" />
                                    <span className="text-xs">
                                      {card ? '未生成背景图' : '预览不可用'}
                                    </span>
                                  </div>
                                )}
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemove();
                                    }}
                                    className="absolute right-2 top-2 p-2 rounded-full bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors"
                                    aria-label={asset && !card ? '删除素材' : '删除场景'}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                              <div className="border-t border-border p-3">
                                <div className="truncate text-sm font-medium">{title}</div>
                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                  {subtitle}
                                </div>
                                {card?.prompt && (
                                  <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                    {card.prompt}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : activeTab === 'cg' ? (
                    cgLibraryItems.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                        <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
                        <p className="text-lg mb-2">暂无 CG</p>
                        <p className="text-sm">点击右上角「新建 CG」开始设定剧情画</p>
                      </div>
                    ) : (
                      <div
                        className={
                          viewMode === 'grid'
                            ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
                            : 'space-y-2'
                        }
                      >
                        {cgLibraryItems.map((item) => {
                          const card = item.kind === 'sceneCard' ? item.card : null;
                          const asset = item.kind === 'sceneCard' ? item.asset : item.asset;
                          const thumbnail = asset ? getThumbnail(asset) : null;
                          const title =
                            card?.title || (asset ? aliasForAsset(asset) || asset.name : '');
                          const subtitle = card
                            ? card.imageAsset || `${card.targetStem}.png` || '尚未生成图片'
                            : asset
                              ? asset.name
                              : '';
                          const isSelected = card ? selectedCgCard?.id === card.id : false;
                          const handleSelect = () => {
                            if (!card) return;
                            setSelectedCgCard(card);
                            setEditingSceneCard(card);
                            setSelectedSceneCard(null);
                            setSelectedAsset(null);
                            setSelectedVoiceCard(null);
                          };
                          const handleRemove = () => {
                            if (card) handleDeleteCgCard(card);
                          };
                          if (viewMode === 'list') {
                            return (
                              <div
                                key={`cg-${card?.id ?? asset?.path}`}
                                onClick={handleSelect}
                                className={`group flex cursor-pointer items-center gap-4 rounded-lg border p-3 transition-all ${
                                  isSelected
                                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                                    : 'border-border bg-card/50 hover:border-secondary'
                                }`}
                              >
                                <div className="aspect-video h-16 flex-shrink-0 overflow-hidden rounded bg-secondary/30">
                                  {thumbnail ? (
                                    <img
                                      src={thumbnail}
                                      alt={title}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center">
                                      <Award className="h-6 w-6 text-muted-foreground/40" />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h3 className="truncate text-sm font-medium">{title}</h3>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {subtitle || '尚未生成图片'}
                                  </p>
                                  {card?.prompt && (
                                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                                      {card.prompt}
                                    </p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemove();
                                  }}
                                  className="rounded-full p-2 text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                                  aria-label="删除 CG"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={`cg-${card?.id ?? asset?.path}`}
                              onClick={handleSelect}
                              className={`group overflow-hidden rounded-lg bg-card text-left transition-all hover:scale-[1.02] cursor-pointer ${
                                isSelected
                                  ? 'ring-2 ring-primary shadow-[0_0_20px_color-mix(in_srgb,var(--color-warm-glow)_60%,transparent)]'
                                  : 'hover:ring-1 hover:ring-border'
                              }`}
                            >
                              <div className="aspect-video bg-secondary/30 relative overflow-hidden">
                                {thumbnail ? (
                                  <img
                                    src={thumbnail}
                                    alt={title}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                                    <Award className="h-10 w-10 opacity-40" />
                                    <span className="text-xs">未生成 CG 图</span>
                                  </div>
                                )}
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemove();
                                    }}
                                    className="absolute right-2 top-2 p-2 rounded-full bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors"
                                    aria-label="删除 CG"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                              <div className="border-t border-border p-3">
                                <div className="truncate text-sm font-medium">{title}</div>
                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                  {subtitle}
                                </div>
                                {card?.prompt && (
                                  <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                    {card.prompt}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : activeTab === 'music' && musicCategory === 'dubbing' ? (
                    <VoiceDubbingPanel
                      projectPath={projectPath}
                      voiceCards={voiceCards}
                      vocalAssetNames={vocalAssetNames}
                      selectedVoiceCard={selectedVoiceCard}
                      onSelectVoiceCard={(card) => {
                        setSelectedVoiceCard(card);
                        setSelectedAsset(null);
                        setSelectedSceneCard(null);
                        setEditingSceneCard(null);
                      }}
                      onVoiceCardsChanged={async () => {
                        await loadAllAssets(projectPath);
                        const m = await loadAssetMetadata(projectPath);
                        applyMetadata(m);
                      }}
                    />
                  ) : activeTab === 'music' && musicCategory === 'vocal' ? (
                    voiceLibraryItems.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                        <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
                        <p className="text-lg mb-2">暂无语音文件</p>
                        <p className="text-sm">
                          对白配音请在“配音清单”中生成或导入；这里仅管理 game/vocal 文件
                        </p>
                      </div>
                    ) : (
                      <div
                        className={
                          viewMode === 'grid'
                            ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
                            : 'space-y-2'
                        }
                      >
                        {voiceLibraryItems.map((item) => {
                          const asset = item.asset;
                          const isSelected = selectedAsset?.path === asset.path;
                          const title = aliasForAsset(asset) || asset.name;
                          const subtitle = `${asset.extension.toUpperCase()} · ${getAudioDurationLabel(asset.path, audioDurations, audioMetadataErrors)}`;
                          if (viewMode === 'list') {
                            return (
                              <div
                                key={`asset-${asset.path}`}
                                onClick={() => {
                                  setSelectedAsset(asset);
                                  setSelectedVoiceCard(null);
                                  setSelectedSceneCard(null);
                                  setEditingSceneCard(null);
                                }}
                                className={`flex items-center gap-4 p-4 rounded-lg cursor-pointer transition-all ${
                                  isSelected
                                    ? 'bg-primary/10 ring-1 ring-primary'
                                    : 'bg-card/50 hover:bg-card'
                                }`}
                              >
                                <div className="w-16 h-16 rounded overflow-hidden bg-secondary/30 flex-shrink-0 flex items-center justify-center">
                                  <Music className="w-6 h-6 text-muted-foreground" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-medium truncate">{title}</h3>
                                  <p className="text-sm text-muted-foreground truncate">
                                    {subtitle}
                                  </p>
                                  {(audioProgress[asset.path] ?? 0) > 0 && (
                                    <div className="mt-2 h-1 rounded bg-secondary overflow-hidden">
                                      <div
                                        className="h-full bg-primary transition-all"
                                        style={{
                                          width: `${Math.min((audioProgress[asset.path] ?? 0) * 100, 100)}%`,
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePlayToggle(asset.path);
                                    }}
                                    className="p-2 rounded-full hover:bg-secondary transition-colors"
                                    aria-label="切换音频播放"
                                  >
                                    {playingAudio === asset.path ? (
                                      <Pause className="w-4 h-4" />
                                    ) : (
                                      <Play className="w-4 h-4" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={`asset-${asset.path}`}
                              onClick={() => {
                                setSelectedAsset(asset);
                                setSelectedVoiceCard(null);
                                setSelectedSceneCard(null);
                                setEditingSceneCard(null);
                              }}
                              className={`group relative rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-[1.02] ${
                                isSelected
                                  ? 'ring-2 ring-primary shadow-[0_0_20px_color-mix(in_srgb,var(--color-warm-glow)_60%,transparent)]'
                                  : 'hover:ring-1 hover:ring-border bg-card'
                              }`}
                            >
                              <div className="aspect-square bg-secondary/30 relative overflow-hidden flex flex-col items-center justify-center gap-4">
                                <Music className="w-10 h-10 text-muted-foreground" />
                                <div className="w-2/3 h-8 rounded overflow-hidden bg-[repeating-linear-gradient(90deg,color-mix(in_srgb,var(--color-primary)_25%,transparent)_0_3px,transparent_3px_7px)]" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                  <div className="absolute right-2 top-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleDelete(asset);
                                      }}
                                      className="p-2 rounded-full bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors"
                                      aria-label="删除素材"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <div className="absolute bottom-0 left-0 right-0 p-3 flex gap-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePlayToggle(asset.path);
                                      }}
                                      className="p-2 rounded-full bg-primary/90 hover:bg-primary transition-colors"
                                      aria-label="切换音频播放"
                                    >
                                      {playingAudio === asset.path ? (
                                        <Pause className="w-3 h-3 text-primary-foreground" />
                                      ) : (
                                        <Play className="w-3 h-3 text-primary-foreground" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                              <div className="p-3 bg-card border-t border-border">
                                <h3 className="text-sm font-medium truncate mb-1">{title}</h3>
                                <div className="text-xs text-muted-foreground truncate">
                                  {subtitle}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : filteredAssets.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                      <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
                      <p className="text-lg mb-2">暂无素材</p>
                      <p className="text-sm">
                        点击右上角“{importConfig?.buttonLabel ?? 'AI 生成'}
                        ”开始添加
                      </p>
                    </div>
                  ) : viewMode === 'grid' ? (
                    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {filteredAssets.map((asset) => {
                        const thumbnail = getThumbnail(asset);
                        const isSelected = selectedAsset?.path === asset.path;
                        const progress = audioProgress[asset.path] ?? 0;
                        const hasAudioDuration = audioDurations[asset.path] !== undefined;
                        const hasAudioMetadataError = audioMetadataErrors[asset.path] === true;
                        return (
                          <div
                            key={asset.path}
                            onClick={() => {
                              setSelectedAsset(asset);
                              setSelectedSceneCard(null);
                              setSelectedVoiceCard(null);
                              setEditingSceneCard(null);
                            }}
                            className={`story-os-interactive group relative cursor-pointer overflow-hidden rounded border bg-surface-container-low ${
                              isSelected
                                ? 'border-secondary ring-1 ring-secondary story-os-hard-shadow'
                                : 'border-border hover:border-secondary'
                            }`}
                          >
                            <div
                              className={`${String(activeTab) === 'scene' ? 'aspect-video' : 'aspect-square'} story-os-blueprint bg-surface-dim relative overflow-hidden`}
                            >
                              {thumbnail ? (
                                <img
                                  src={thumbnail}
                                  alt={asset.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.opacity = '0.3';
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                                  {isAudioExt(asset.extension) ? (
                                    <>
                                      <Music className="w-10 h-10 text-muted-foreground" />
                                      <div className="w-2/3 h-8 rounded overflow-hidden bg-[repeating-linear-gradient(90deg,color-mix(in_srgb,var(--color-primary)_25%,transparent)_0_3px,transparent_3px_7px)]" />
                                    </>
                                  ) : (
                                    <Image className="w-12 h-12 text-muted-foreground/30" />
                                  )}
                                </div>
                              )}
                              {isAudioExt(asset.extension) && progress > 0 && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-background/50">
                                  <div
                                    className="h-full bg-primary transition-all"
                                    style={{
                                      width: `${Math.min(progress * 100, 100)}%`,
                                    }}
                                  />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="absolute right-2 top-2">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleDelete(asset);
                                    }}
                                    className="p-2 rounded-full bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors"
                                    aria-label="删除素材"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 p-3 flex gap-2">
                                  {isAudioExt(asset.extension) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePlayToggle(asset.path);
                                      }}
                                      className="p-2 rounded-full bg-primary/90 hover:bg-primary transition-colors"
                                      aria-label="切换音频播放"
                                    >
                                      {playingAudio === asset.path ? (
                                        <Pause className="w-3 h-3 text-primary-foreground" />
                                      ) : (
                                        <Play className="w-3 h-3 text-primary-foreground" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="p-2 bg-surface-container-lowest border-t border-border">
                              <h3 className="text-sm font-medium truncate mb-1">
                                {aliasForAsset(asset) || asset.name}
                              </h3>
                              {aliasForAsset(asset) && (
                                <div className="mb-1 truncate text-[11px] text-muted-foreground font-mono-family">
                                  {asset.name}
                                </div>
                              )}
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{asset.extension.toUpperCase()}</span>
                                {isAudioExt(asset.extension) && (
                                  <span>
                                    {getAudioDurationLabel(
                                      asset.path,
                                      audioDurations,
                                      audioMetadataErrors,
                                    )}
                                  </span>
                                )}
                                <span>{formatSize(asset.size)}</span>
                              </div>
                              {!isAudioExt(asset.extension) && (
                                <div className="mt-1 flex items-center gap-1 text-[11px] text-secondary/80">
                                  <Eye className="h-3 w-3" />
                                  <span>
                                    Used in {countUsages(assetUsages, asset.name)} scene
                                    {countUsages(assetUsages, asset.name) === 1 ? '' : 's'}
                                  </span>
                                </div>
                              )}
                              {isAudioExt(asset.extension) &&
                                !hasAudioDuration &&
                                !hasAudioMetadataError && (
                                  <audio
                                    preload="metadata"
                                    src={convertFileSrc(asset.path)}
                                    onLoadedMetadata={(event) => {
                                      const duration = getSafeAudioDuration(event.currentTarget);
                                      setAudioDurations((prev) => ({
                                        ...prev,
                                        [asset.path]: duration,
                                      }));
                                      setAudioMetadataErrors((prev) => {
                                        if (!prev[asset.path]) return prev;
                                        const next = { ...prev };
                                        delete next[asset.path];
                                        return next;
                                      });
                                    }}
                                    onError={() => {
                                      setAudioMetadataErrors((prev) => ({
                                        ...prev,
                                        [asset.path]: true,
                                      }));
                                    }}
                                    className="hidden"
                                  />
                                )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredAssets.map((asset) => {
                        const thumbnail = getThumbnail(asset);
                        const isSelected = selectedAsset?.path === asset.path;
                        const progress = audioProgress[asset.path] ?? 0;
                        const hasAudioDuration = audioDurations[asset.path] !== undefined;
                        const hasAudioMetadataError = audioMetadataErrors[asset.path] === true;
                        return (
                          <div
                            key={asset.path}
                            onClick={() => {
                              setSelectedAsset(asset);
                              setSelectedSceneCard(null);
                              setSelectedVoiceCard(null);
                              setEditingSceneCard(null);
                            }}
                            className={`story-os-interactive flex cursor-pointer items-center gap-4 rounded border p-4 ${
                              isSelected
                                ? 'bg-secondary/10 border-secondary'
                                : 'bg-surface-container-lowest border-border hover:border-secondary'
                            }`}
                          >
                            <div className="w-16 h-16 rounded overflow-hidden bg-secondary/30 flex-shrink-0">
                              {thumbnail ? (
                                <img
                                  src={thumbnail}
                                  alt={asset.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  {isAudioExt(asset.extension) ? (
                                    <Music className="w-6 h-6 text-muted-foreground" />
                                  ) : (
                                    <Image className="w-6 h-6 text-muted-foreground/30" />
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium truncate">
                                {aliasForAsset(asset) || asset.name}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                {aliasForAsset(asset) ? `${asset.name} · ` : ''}
                                {formatCategory(asset.category)} · {asset.extension.toUpperCase()} ·{' '}
                                {isAudioExt(asset.extension)
                                  ? `${getAudioDurationLabel(asset.path, audioDurations, audioMetadataErrors)} · `
                                  : ''}
                                {formatSize(asset.size)}
                              </p>
                              {isAudioExt(asset.extension) && progress > 0 && (
                                <div className="mt-2 h-1 rounded bg-secondary overflow-hidden">
                                  <div
                                    className="h-full bg-primary transition-all"
                                    style={{
                                      width: `${Math.min(progress * 100, 100)}%`,
                                    }}
                                  />
                                </div>
                              )}
                              {!isAudioExt(asset.extension) && (
                                <div className="mt-1 flex items-center gap-1 text-[11px] text-secondary/80">
                                  <Eye className="h-3 w-3" />
                                  <span>
                                    Used in {countUsages(assetUsages, asset.name)} scene
                                    {countUsages(assetUsages, asset.name) === 1 ? '' : 's'}
                                  </span>
                                </div>
                              )}
                              {isAudioExt(asset.extension) &&
                                !hasAudioDuration &&
                                !hasAudioMetadataError && (
                                  <audio
                                    preload="metadata"
                                    src={convertFileSrc(asset.path)}
                                    onLoadedMetadata={(event) => {
                                      const duration = getSafeAudioDuration(event.currentTarget);
                                      setAudioDurations((prev) => ({
                                        ...prev,
                                        [asset.path]: duration,
                                      }));
                                      setAudioMetadataErrors((prev) => {
                                        if (!prev[asset.path]) return prev;
                                        const next = { ...prev };
                                        delete next[asset.path];
                                        return next;
                                      });
                                    }}
                                    onError={() => {
                                      setAudioMetadataErrors((prev) => ({
                                        ...prev,
                                        [asset.path]: true,
                                      }));
                                    }}
                                    className="hidden"
                                  />
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {asset.extension.toUpperCase()}
                              </span>
                              {isAudioExt(asset.extension) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePlayToggle(asset.path);
                                  }}
                                  className="p-2 rounded-full hover:bg-secondary transition-colors"
                                  aria-label="切换音频播放"
                                >
                                  {playingAudio === asset.path ? (
                                    <Pause className="w-4 h-4" />
                                  ) : (
                                    <Play className="w-4 h-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </main>

          {/* Right Sidebar - Details */}
          {activeTab !== 'character' && (
            <aside className="mb-4 mr-4 w-80 overflow-hidden rounded border border-border bg-surface-bright/90 shadow-[-4px_0_24px_var(--shadow-faint)] backdrop-blur-xl">
              {selectedCgCard ? (
                <SceneCardDetails
                  card={selectedCgCard}
                  projectPath={projectPath}
                  backgroundAssets={allAssets.filter((asset) => asset.category === 'background')}
                  getThumbnail={getThumbnail}
                  references={cgCardReferences}
                  referenceUploading={referenceUploading}
                  onReferenceUpload={handleSceneCardReferenceUpload}
                  onReferenceRemove={handleSceneCardReferenceRemove}
                  onSave={handleSaveCgCard}
                  onGenerate={(card) => {
                    handleSaveCgCard(card);
                    setEditingSceneCard(card);
                    setAiAssetPrompt('');
                    setAiGenerateOpen(true);
                  }}
                  onOpenUsage={openUsage}
                />
              ) : selectedSceneCard ? (
                <SceneCardDetails
                  card={selectedSceneCard}
                  projectPath={projectPath}
                  backgroundAssets={allAssets.filter((asset) => asset.category === 'background')}
                  getThumbnail={getThumbnail}
                  references={sceneCardReferences}
                  referenceUploading={referenceUploading}
                  onReferenceUpload={handleSceneCardReferenceUpload}
                  onReferenceRemove={handleSceneCardReferenceRemove}
                  onSave={handleSaveSceneCard}
                  onGenerate={(card) => {
                    handleSaveSceneCard(card);
                    setEditingSceneCard(card);
                    setAiAssetPrompt('');
                    setAiGenerateOpen(true);
                  }}
                  onOpenUsage={openUsage}
                />
              ) : selectedVoiceCard ? (
                <VoiceCardDetails
                  card={selectedVoiceCard}
                  projectPath={projectPath}
                  vocalAssetNames={vocalAssetNames}
                  onSave={handleSaveVoiceCard}
                  onGenerate={(card) => {
                    handleSaveVoiceCard(card);
                    setEditingSceneCard(null);
                    setAiAssetPrompt('');
                    setAiGenerateOpen(true);
                  }}
                />
              ) : selectedAsset ? (
                <div className="h-full overflow-auto">
                  <div className="flex h-10 items-center justify-between border-b border-border bg-surface-container-high px-4">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      属性检视器
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedAsset(null)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="关闭素材详情"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-4">
                    <div className="mb-6">
                      <div className="story-os-blueprint story-os-hard-shadow aspect-video rounded overflow-hidden bg-surface-dim mb-4 border border-border">
                        {getThumbnail(selectedAsset) ? (
                          <img
                            src={getThumbnail(selectedAsset)!}
                            alt={selectedAsset.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.opacity = '0.3';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {isAudioExt(selectedAsset.extension) ? (
                              <Music className="w-16 h-16 text-muted-foreground" />
                            ) : (
                              <Image className="w-16 h-16 text-muted-foreground/30" />
                            )}
                          </div>
                        )}
                      </div>
                      <h2 className="text-xl mb-2 font-display-family">{selectedAsset.name}</h2>
                      <p className="text-xs text-muted-foreground truncate font-mono-family">
                        {selectedAsset.path}
                      </p>
                    </div>

                    <div className="space-y-4 mb-6">
                      {(activeTab === 'scene' || activeTab === 'music') && (
                        <div>
                          <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
                            显示名称
                          </label>
                          <input
                            type="text"
                            value={aliasForAsset(selectedAsset)}
                            onChange={(e) => handleAliasChange(selectedAsset, e.target.value)}
                            className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                            placeholder={
                              activeTab === 'scene' ? '例：教室 · 白天' : '例：悲伤主旋律'
                            }
                            aria-label="素材显示名称"
                          />
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            设置后，剧本编辑器的素材选择弹窗会优先显示这个名称。
                          </p>
                        </div>
                      )}

                      {selectedAsset.category !== 'vocal' && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs uppercase tracking-wide text-muted-foreground">
                              {activeTab === 'music' ? '参考音频' : '参考图'}
                            </label>
                            <button
                              type="button"
                              onClick={handleReferenceUpload}
                              disabled={referenceUploading}
                              className="px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 text-xs flex items-center gap-1 disabled:opacity-50"
                            >
                              {referenceUploading ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Upload className="w-3 h-3" />
                              )}
                              上传
                            </button>
                          </div>
                          <div className="space-y-2">
                            {referencesForAsset(selectedAsset).length === 0 ? (
                              <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border p-3">
                                暂无参考资料。
                              </div>
                            ) : (
                              referencesForAsset(selectedAsset).map((filename) => {
                                const sourcePath = referenceFilePath(
                                  projectPath,
                                  selectedAsset.category,
                                  selectedAsset.name,
                                  filename,
                                );
                                if (!sourcePath) return null;
                                return (
                                  <div
                                    key={filename}
                                    className="flex items-center gap-2 rounded-md bg-secondary/20 p-2"
                                  >
                                    {selectedAsset.category !== 'background' ? (
                                      <audio
                                        controls
                                        src={convertFileSrc(sourcePath)}
                                        className="min-w-0 flex-1 h-8"
                                      />
                                    ) : (
                                      <img
                                        src={convertFileSrc(sourcePath)}
                                        alt=""
                                        className="w-10 h-10 rounded object-cover bg-secondary"
                                      />
                                    )}
                                    <span className="min-w-0 flex-1 truncate text-xs font-mono-family">
                                      {filename}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleReferenceRemove(filename)}
                                      className="p-1 rounded hover:bg-destructive/10"
                                      aria-label="删除参考资料"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                                    </button>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}

                      {selectedAsset.category !== 'vocal' && (
                        <div>
                          <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
                            描述
                          </label>
                          <textarea
                            value={descriptionForAsset(selectedAsset)}
                            onChange={(e) => handleDescriptionChange(selectedAsset, e.target.value)}
                            rows={6}
                            placeholder={
                              activeTab === 'scene'
                                ? '描述要生成或重绘的背景：地点、时间、天气、氛围、镜头角度、画面主体。'
                                : '描述要生成的音频：情绪、节奏、乐器、用途或台词内容。'
                            }
                            className="w-full resize-y rounded-md border border-border bg-input-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                      )}

                      <div>
                        <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
                          剧本引用
                        </label>
                        <div className="space-y-2">
                          {displayedAssetUsages.length === 0 ? (
                            <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border p-3">
                              未在剧本中找到引用。
                            </div>
                          ) : (
                            displayedAssetUsages.map((usage, index) => (
                              <button
                                key={`${usage.sceneFile}-${usage.lineNumber}-${index}`}
                                type="button"
                                onClick={() => openUsage(usage)}
                                className="w-full rounded-md bg-secondary/20 p-2 text-left hover:bg-primary/10 transition-colors"
                              >
                                <div className="text-xs text-primary">
                                  {usage.sceneFile} 第 {usage.lineNumber} 行
                                </div>
                                <div className="mt-1 truncate text-[10px] text-muted-foreground font-mono-family">
                                  {usage.lineContent}
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <button
                        onClick={handleRename}
                        className="w-full px-4 py-2 rounded-md bg-secondary hover:bg-secondary/70 transition-all flex items-center justify-center gap-2"
                        aria-label="重命名素材"
                      >
                        <Edit3 className="w-4 h-4" />
                        重命名
                      </button>
                      {selectedAsset.category !== 'vocal' && (
                        <button
                          onClick={() => handleGenerateFromAsset(selectedAsset)}
                          className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-all flex items-center justify-center gap-2"
                          aria-label="AI 生成"
                        >
                          <Sparkles className="w-4 h-4" />
                          AI 生成
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
                  <Image className="w-16 h-16 mb-4 opacity-50" />
                  <p className="text-sm">选择一个素材查看详情</p>
                </div>
              )}
            </aside>
          )}
        </div>
      )}
      <AssetAiGenerateDialog
        open={aiGenerateOpen}
        activeTab={activeTab}
        musicCategory={musicCategory}
        projectPath={projectPath}
        initialSceneCard={editingSceneCard}
        initialVoiceCard={selectedVoiceCard}
        initialAssetPrompt={aiAssetPrompt}
        initialMusicFilename={aiMusicFilename}
        onGenerated={async (asset, prompt) => {
          setAssets((current) =>
            current.some((item) => item.path === asset.path)
              ? current.map((item) => (item.path === asset.path ? asset : item))
              : [asset, ...current],
          );
          setAllAssets((current) =>
            current.some((item) => item.path === asset.path)
              ? current.map((item) => (item.path === asset.path ? asset : item))
              : [asset, ...current],
          );
          if (activeTab === 'scene' && editingSceneCard) {
            setSelectedAsset(asset);
            setSelectedSceneCard(null);
            setEditingSceneCard(null);
            const currentMetadata = metadataRef.current;
            persistMetadata(
              setAssetDescription(
                currentMetadata,
                'background',
                asset.name,
                editingSceneCard.prompt,
              ),
            );
            if (editingSceneCard.sceneFile) {
              try {
                await applySceneBackgroundReference(editingSceneCard.sceneFile, asset.name);
              } catch (e) {
                setError(`生成图片已保存，但写入剧本引用失败：${String(e)}`);
              }
            }
          }
          if (activeTab === 'cg' && editingSceneCard) {
            const updated: SceneAssetCard = {
              ...editingSceneCard,
              imageAsset: asset.name,
            };
            handleSaveCgCard(updated);
            setSelectedCgCard(updated);
            setEditingSceneCard(null);
            persistMetadata(
              setAssetDescription(
                metadataRef.current,
                'background',
                asset.name,
                editingSceneCard.prompt,
              ),
            );
          }
          if (activeTab === 'music' && selectedVoiceCard) {
            handleSaveVoiceCard({
              ...selectedVoiceCard,
              voiceAsset: asset.name,
            });
          }
          // BGM: persist the music prompt onto the generated file and refresh the
          // pending list. The file lands at the script-referenced name, so the
          // bgm: reference is bound automatically — no script write-back needed.
          if (activeTab === 'music' && musicCategory === 'bgm' && !selectedVoiceCard) {
            if (prompt?.trim()) {
              persistMetadata(
                setAssetDescription(metadataRef.current, 'bgm', asset.name, prompt.trim()),
              );
            }
            setBgmReferences((current) =>
              current.map((ref) => (ref.filename === asset.name ? { ...ref, exists: true } : ref)),
            );
            setAiMusicFilename(null);
          }
        }}
        onClose={() => setAiGenerateOpen(false)}
      />
      <audio
        ref={audioRef}
        onEnded={() => setPlayingAudio(null)}
        onError={() => {
          const current = playingAudio;
          if (current) {
            setAudioMetadataErrors((prev) => ({ ...prev, [current]: true }));
            setError('当前音频无法解码或播放，请尝试转换为常规 MP3/WAV/Ogg 后重新导入。');
          }
          setPlayingAudio(null);
        }}
        onLoadedMetadata={(event) => {
          if (!playingAudio) return;
          const duration = getSafeAudioDuration(event.currentTarget);
          setAudioDurations((prev) => ({ ...prev, [playingAudio]: duration }));
        }}
        onTimeUpdate={(event) => {
          if (!playingAudio) return;
          const { currentTime } = event.currentTarget;
          const duration = getSafeAudioDuration(event.currentTarget);
          setAudioProgress((prev) => ({
            ...prev,
            [playingAudio]: duration ? currentTime / duration : 0,
          }));
        }}
        className="hidden"
        aria-label="音频播放器"
      />
    </div>
  );
}

