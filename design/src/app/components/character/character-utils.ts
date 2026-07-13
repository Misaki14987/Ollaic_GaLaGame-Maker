import type { Character, CharacterSprite } from '@/app/lib/character/character-types';

export type SpriteGenerationTarget = { kind: 'reference' } | { kind: 'variant'; index: number };

export type PendingSpriteGeneration = {
  emotion: string;
  target: SpriteGenerationTarget;
  batch?: boolean;
};

export function parseConfiguredModels(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function sanitizeFilenamePart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

// 与 generateSprite 的命名规则保持一致：文件名为
// `${characterPart}_${emotionPart}_${timestamp}.${ext}`。用前缀判断某情绪是否已生成。
export function characterFilenamePart(character: Character): string {
  return sanitizeFilenamePart(character.name || character.id, 'character');
}

export function spritePrefix(characterPart: string, emotion: string): string {
  return `${characterPart}_${sanitizeFilenamePart(emotion, 'sprite')}_`;
}

// 提示词完全以「本次生成提示词 + 参考图」为准，不再注入任何角色上下文字段
// （性别/年龄/外观设定/性格/剧情定位/说话风格/关键词都不进生图提示词，仅供文本生成参考）：
// - 本次提示词放在质量前缀之后第一位，扩散模型对靠前 token 更敏感。
// - 有参考图时外观一致性交给参考图，本次提示词决定姿势/表情/镜头等本次内容。
export function buildSpritePrompt(
  character: Character,
  sprite: CharacterSprite,
  isReference: boolean,
  instruction: string,
): string {
  return [
    'visual novel character sprite, full body, plain white background, clean anime game asset, consistent character design',
    isReference
      ? 'main reference sprite, neutral readable pose, front-facing character design sheet quality'
      : '',
    instruction ? `本次生成提示词：${instruction}` : '',
    sprite.emotion ? `立绘形态/情绪：${sprite.emotion}` : '',
    'the background must be plain white or very light gray with no gradients shadows or patterns, avoid background scene, avoid text, avoid watermark, avoid extra characters',
  ]
    .filter(Boolean)
    .join('\n');
}

// 立绘按角色存放在 game/figure/<角色ID>/ 子目录；sprite.file 存子目录限定路径
// "<角色ID>/<文件名>"。以下两个工具在「限定路径」与「平铺文件名」之间转换。
export function qualifyFigureFile(charId: string, name: string): string {
  if (!name) return '';
  return name.includes('/') ? name : `${charId}/${name}`;
}

export function figureFileTail(file: string): string {
  if (!file) return '';
  const slash = file.lastIndexOf('/');
  return slash >= 0 ? file.slice(slash + 1) : file;
}
