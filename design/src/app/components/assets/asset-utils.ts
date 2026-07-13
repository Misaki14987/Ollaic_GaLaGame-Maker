import { Image, Award, Music, Users } from 'lucide-react';
import { getScenePath, loadScene, saveScene } from '@/app/lib/webgal/webgal-ipc';
import type { AssetUsage, SceneAssetCard } from '@/app/lib/assets/assets-ipc';

export type TabId = 'scene' | 'cg' | 'music' | 'character' | 'dubbing';
export type MusicCategory = 'bgm' | 'dubbing' | 'vocal';

export const musicTabs: { id: MusicCategory; label: string }[] = [
  { id: 'bgm', label: 'BGM 背景音乐' },
  { id: 'dubbing', label: '配音清单' },
  { id: 'vocal', label: '语音 / 音效' },
];

export const musicCategoryLabels: Record<MusicCategory, string> = {
  bgm: 'BGM',
  dubbing: '配音清单',
  vocal: '语音 / 音效',
};

export const voiceEmotionOptions = [
  '默认',
  '平静',
  '温柔',
  '开心',
  '害羞',
  '惊讶',
  '疑惑',
  '紧张',
  '害怕',
  '生气',
  '悲伤',
  '哭腔',
  '低声',
  '认真',
  '冷淡',
  '虚弱',
  '激动',
  '撒娇',
  '嘲讽',
];

export function tabToCategories(tab: TabId): string[] {
  switch (tab) {
    case 'scene':
      return ['background'];
    case 'cg':
      return ['background'];
    case 'music':
      return ['bgm', 'vocal'];
    case 'character':
      return ['figure'];
    case 'dubbing':
      return ['vocal'];
  }
}

export function isImageExt(ext: string): boolean {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(normalized);
}

export function isAudioExt(ext: string): boolean {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  return ['mp3', 'ogg', 'wav', 'flac', 'aac'].includes(normalized);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCategory(category: string): string {
  const labels: Record<string, string> = {
    background: '背景',
    figure: '立绘',
    bgm: '背景音乐',
    vocal: '语音 / 音效',
  };
  return labels[category] || category;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '--:--';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

export function getSafeAudioDuration(audio: HTMLAudioElement): number {
  return Number.isFinite(audio.duration) ? audio.duration : 0;
}

export function sceneCardTargetFilename(card: SceneAssetCard): string {
  if (card.imageAsset) return card.imageAsset;
  const targetStem = card.targetStem || card.id;
  return `${targetStem.replace(/\.(png|jpe?g|webp)$/i, '')}.png`;
}

export function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function safeStem(value: string): string {
  return (
    value
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '')
      .slice(0, 32) || 'voice'
  );
}

export function voiceCardId(character: string, text: string, emotion: string): string {
  return hashText(`${character}\n${text}\n${emotion || '默认'}`);
}

export function voiceTargetStem(character: string, sceneStem: string, lineNumber: number): string {
  return `v_${safeStem(character || 'narrator')}_${safeStem(sceneStem)}_${lineNumber}`;
}

// Old naming scheme (`v_角色_<台词哈希>`); kept only to detect never-customized
// stems so we can migrate them to the readable scene+line form.
export function legacyVoiceTargetStem(character: string, text: string): string {
  return `v_${safeStem(character || 'narrator')}_${hashText(text).slice(0, 8)}`;
}

export function normalizeVoiceFilename(value: string): string {
  const trimmed = value.trim();
  const withExtension = /\.(mp3|ogg|wav|flac|aac)$/i.test(trimmed) ? trimmed : `${trimmed}.wav`;
  return withExtension.replace(/\s+/g, '_').replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '') || 'voice.wav';
}

export function voiceFilenameStem(filename: string): string {
  return normalizeVoiceFilename(filename).replace(/\.(mp3|ogg|wav|flac|aac)$/i, '');
}

export function countUsages(usages: AssetUsage[], _filename: string): number {
  // AssetUsage is per-call (one filename), so any returned entry is one usage reference.
  return usages.length;
}

export function getImportConfig(tab: TabId, musicCategory: MusicCategory) {
  if (tab === 'scene') {
    return {
      title: '上传背景素材',
      buttonLabel: '上传背景',
      filters: [
        {
          name: '图片文件',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
        },
      ],
    };
  }
  if (tab === 'cg') {
    return {
      title: '上传 CG 剧情画',
      buttonLabel: '上传 CG',
      filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    };
  }
  if (tab === 'music') {
    if (musicCategory === 'dubbing') return null;
    return {
      title: `上传${musicCategoryLabels[musicCategory]}`,
      buttonLabel: `上传${musicCategoryLabels[musicCategory]}`,
      filters: [{ name: '音频文件', extensions: ['mp3', 'ogg', 'wav', 'flac', 'aac'] }],
    };
  }
  return {
    title: '上传立绘素材',
    buttonLabel: '上传立绘素材',
    filters: [
      {
        name: '图片文件',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
      },
    ],
  };
}

export function getAudioDurationLabel(
  assetPath: string,
  audioDurations: Record<string, number>,
  audioMetadataErrors: Record<string, boolean>,
): string {
  if (audioMetadataErrors[assetPath]) return '无法读取时长';
  return formatDuration(audioDurations[assetPath]);
}

export function normalizeRenamedAssetFilename(value: string, extension: string): string {
  const normalizedExt = extension.replace(/^\./, '');
  const trimmed = value.trim();
  const withoutExtension = trimmed.replace(new RegExp(`\\.${normalizedExt}$`, 'i'), '');
  return `${withoutExtension}.${normalizedExt}`;
}

export async function replaceBackgroundReferencesInScenes(
  projectPath: string,
  usages: AssetUsage[],
  oldName: string,
  newName: string,
): Promise<number> {
  const sceneFiles = Array.from(new Set(usages.map((usage) => usage.sceneFile).filter(Boolean)));
  let updatedCount = 0;
  for (const sceneFile of sceneFiles) {
    const scenePath = await getScenePath(projectPath, sceneFile);
    const nodes = await loadScene(scenePath);
    let changed = false;
    const nextNodes = nodes.map((node) => {
      if (node.type !== 'changeBg') return node;
      const current = (node.asset || node.content || '').trim();
      if (current !== oldName) return node;
      changed = true;
      updatedCount += 1;
      return { ...node, asset: newName, content: newName };
    });
    if (changed) await saveScene(scenePath, nextNodes);
  }
  return updatedCount;
}

export const tabConfig: { id: TabId; label: string; icon: typeof Image }[] = [
  { id: 'scene', label: '场景', icon: Image },
  { id: 'cg', label: 'CG', icon: Award },
  { id: 'music', label: '音频', icon: Music },
  { id: 'character', label: '人物立绘', icon: Users },
];
