import { convertFileSrc } from '@tauri-apps/api/core';
import type { WebGalCommandType } from '@/app/lib/webgal/webgal-types';
import type { Character } from '@/app/lib/character/character-types';
import type { AssetInfo } from '@/app/lib/assets/assets-ipc';
import { figureFileTail, resolveSpriteFile } from '@/app/lib/editor/figure-resolve';
export const typeOptions: { value: WebGalCommandType; label: string }[] = [
  { value: 'dialogue', label: '对话' },
  { value: 'narrator', label: '旁白' },
  { value: 'intro', label: '黑屏文字' },
  { value: 'choose', label: '选项分支' },
  { value: 'changeBg', label: '切换背景' },
  { value: 'changeFigure', label: '切换立绘' },
  { value: 'miniAvatar', label: '小头像' },
  { value: 'changeScene', label: '切换场景' },
  { value: 'callScene', label: '调用场景' },
  { value: 'end', label: '结束' },
  { value: 'bgm', label: '背景音乐' },
  { value: 'playEffect', label: '音效' },
  { value: 'playVideo', label: '播放视频' },
  { value: 'label', label: '标签' },
  { value: 'jumpLabel', label: '跳转标签' },
  { value: 'setVar', label: '设置变量' },
  { value: 'setTextbox', label: '文本框控制' },
  { value: 'getUserInput', label: '用户输入' },
  { value: 'setAnimation', label: '设置动画' },
  { value: 'setTransform', label: '设置变换' },
  { value: 'unlockCg', label: '解锁CG' },
  { value: 'unlockBgm', label: '解锁BGM' },
  { value: 'comment', label: '注释' },
];

export const inputClass =
  'w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm';
export const labelClass = 'block text-xs uppercase tracking-widest text-muted-foreground mb-1.5';
export function findSpriteSelection(characters: Character[], filename: string) {
  if (!filename || filename === 'none') return null;
  for (const character of characters) {
    const sprite = character.sprites.find((item) => item.file === filename);
    if (sprite) return { character, sprite };
  }
  return null;
}

export function figureAliasesFromCharacters(characters: Character[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const character of characters) {
    for (const sprite of character.sprites) {
      if (!sprite.file) continue;
      aliases[sprite.file] = `${character.name}_${sprite.emotion || '默认'}`;
    }
  }
  return aliases;
}
// 把一个立绘卡片解析为「可写入脚本的限定文件名」与「可显示的图片源」。
// 文件名解析复用 figure-resolve（与 CharacterPanel 的命名规则一致：
// `${角色}_${情绪}_${timestamp}.${ext}`，变体立绘只进 figure/<角色ID>/、sprite.file 留空）。
export interface ResolvedSprite {
  file: string; // 写入脚本的限定文件名，如 "<角色ID>/xxx.png"
  src: string | null; // convertFileSrc 后的可显示地址
}

export function resolveSpriteImage(
  character: Character,
  sprite: Character['sprites'][number],
  assets: AssetInfo[],
  projectPath?: string,
): ResolvedSprite {
  const file = resolveSpriteFile(character, sprite, assets);
  if (!file) return { file: '', src: null };
  const match = assets.find((asset) => figureFileTail(asset.name) === figureFileTail(file));
  const src = match
    ? convertFileSrc(match.path)
    : projectPath
      ? convertFileSrc(`${projectPath}/game/figure/${file}`)
      : null;
  return { file, src };
}
