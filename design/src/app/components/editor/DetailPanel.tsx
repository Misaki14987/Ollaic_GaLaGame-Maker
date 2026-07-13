import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Image, Loader2, Search, Sparkles, Trash2, Plus, X } from 'lucide-react';
import type { WebGalNode, WebGalCommandType } from '@/app/lib/webgal/webgal-types';
import { commandLabels } from '@/app/lib/webgal/webgal-types';
import { AssetPickerButton } from '@/app/components/assets/AssetPicker';
import type { Character } from '@/app/lib/character/character-types';
import {
  aliasesForCategory,
  emptyAssetMetadata,
  loadAssetMetadata,
  type AssetMetadata,
} from '@/app/lib/assets/asset-metadata';
import { listScenes, sceneDisplayName, type SceneHeader } from '@/app/lib/webgal/webgal-ipc';
import { listAssets, type AssetInfo } from '@/app/lib/assets/assets-ipc';
import { figureFileTail, spritePrefix, resolveSpriteFile } from '@/app/lib/editor/figure-resolve';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/app/components/ui/dialog';
import {
  typeOptions,
  inputClass,
  labelClass,
  findSpriteSelection,
  figureAliasesFromCharacters,
  resolveSpriteImage,
  type ResolvedSprite,
} from './detail-utils';
import { CharacterFigurePicker } from './CharacterFigurePicker';
import { SceneSelect } from './SceneSelect';
import { ChoiceEditor } from './ChoiceEditor';

interface DetailPanelProps {
  node: WebGalNode;
  onUpdateNode: (updates: Partial<WebGalNode>) => void;
  onDeleteNode: () => void;
  onClose: () => void;
  characterNames?: string[];
  projectPath?: string;
  characters?: Character[];
  projectId?: string;
  suggestedFigureCharacter?: string;
  /** All scene filenames in the project (for scene-jump / choice target pickers). */
  scenes?: string[];
  /** Per-scene headers, for showing chapter names in the scene picker. */
  sceneHeaders?: Record<string, SceneHeader>;
}


export function DetailPanel({
  node,
  onUpdateNode,
  onDeleteNode,
  onClose,
  characterNames,
  projectPath,
  characters = [],
  projectId,
  suggestedFigureCharacter,
  scenes = [],
  sceneHeaders = {},
}: DetailPanelProps) {
  const [metadata, setMetadata] = useState<AssetMetadata>(() => emptyAssetMetadata());

  useEffect(() => {
    if (!projectPath) {
      setMetadata(emptyAssetMetadata());
      return;
    }
    let cancelled = false;
    loadAssetMetadata(projectPath, projectId)
      .then((next) => {
        if (!cancelled) setMetadata(next);
      })
      .catch(() => {
        if (!cancelled) setMetadata(emptyAssetMetadata());
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectPath]);

  return (
    <div className="flex-1 border-r border-border bg-card/50 backdrop-blur-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-1 font-mono-family">
            指令编辑
          </h3>
          <div className="text-base font-medium font-display-family">
            {commandLabels[node.type]}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-secondary/50 transition-colors"
          aria-label="关闭"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Type selector */}
        <div>
          <label className={`${labelClass} font-mono-family`}>指令类型</label>
          <select
            value={node.type}
            onChange={(e) => onUpdateNode({ type: e.target.value as WebGalCommandType })}
            className={`${inputClass} font-mono-family`}
            aria-label="指令类型"
          >
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Type-specific fields */}
        {renderTypeFields(
          node,
          onUpdateNode,
          characterNames,
          projectPath,
          characters,
          metadata,
          suggestedFigureCharacter,
          scenes,
          sceneHeaders,
        )}

        {/* Common flags */}
        <div className="pt-3 border-t border-border space-y-3">
          <label className={`${labelClass} font-mono-family`}>通用选项</label>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={node.next ?? false}
              onChange={(e) => onUpdateNode({ next: e.target.checked })}
              className="rounded border-border"
            />
            <span>-next (立即执行下一条)</span>
          </label>

          <div>
            <label className={`${labelClass} font-mono-family`}>条件 (-when)</label>
            <input
              type="text"
              value={node.when || ''}
              onChange={(e) => onUpdateNode({ when: e.target.value || undefined })}
              className={`${inputClass} font-mono-family`}
              placeholder="例: score>10"
              aria-label="条件"
            />
          </div>
        </div>

        {/* Raw content preview */}
        <div className="pt-3 border-t border-border">
          <label className={`${labelClass} font-mono-family`}>节点 ID</label>
          <div className="text-xs text-muted-foreground font-mono-family">{node.id}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-border space-y-2">
        <button
          onClick={onDeleteNode}
          className="w-full px-4 py-2 bg-destructive/10 text-destructive rounded-md hover:bg-destructive/20 transition-colors text-sm"
          aria-label="删除指令"
        >
          删除指令
        </button>
      </div>
    </div>
  );
}

function renderTypeFields(
  node: WebGalNode,
  onUpdate: (updates: Partial<WebGalNode>) => void,
  characterNames?: string[],
  projectPath?: string,
  characters: Character[] = [],
  metadata: AssetMetadata = emptyAssetMetadata(),
  suggestedFigureCharacter?: string,
  scenes: string[] = [],
  sceneHeaders: Record<string, SceneHeader> = {},
) {
  const backgroundAliases = aliasesForCategory(metadata, 'background');
  const figureAliases = aliasesForCategory(metadata, 'figure');
  const bgmAliases = aliasesForCategory(metadata, 'bgm');
  const vocalAliases = aliasesForCategory(metadata, 'vocal');
  const videoAliases = aliasesForCategory(metadata, 'video');

  switch (node.type) {
    case 'dialogue':
      return (
        <>
          <div>
            <label className={`${labelClass} font-mono-family`}>角色名</label>
            <input
              type="text"
              value={node.character || ''}
              onChange={(e) => onUpdate({ character: e.target.value })}
              className={inputClass}
              placeholder="留空则继承上一句角色"
              list="character-suggestions"
              aria-label="角色名"
            />
            {characterNames && characterNames.length > 0 && (
              <datalist id="character-suggestions">
                {characterNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`${labelClass} font-mono-family mb-0`}>对话内容</label>
              <button
                className="p-1 hover:bg-primary/10 rounded transition-colors group"
                aria-label="AI 生成对话"
              >
                <Sparkles className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
              </button>
            </div>
            <textarea
              value={node.content}
              onChange={(e) => onUpdate({ content: e.target.value })}
              className={`${inputClass} h-24 resize-none font-body-family`}
              placeholder="输入对话内容..."
              aria-label="对话内容"
            />
          </div>
          <div>
            <label className={`${labelClass} font-mono-family`}>语音文件</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={node.voice || ''}
                onChange={(e) => onUpdate({ voice: e.target.value || undefined })}
                className={`${inputClass} flex-1 font-mono-family`}
                placeholder="例: v1.wav"
                aria-label="语音文件"
              />
              {projectPath && (
                <AssetPickerButton
                  projectPath={projectPath}
                  category="vocal"
                  currentValue={node.voice || ''}
                  aliases={vocalAliases}
                  onSelect={(name) => onUpdate({ voice: name === 'none' ? undefined : name })}
                />
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              作为当前对白的 -voice 标记保存，不会新建独立音频指令
            </p>
          </div>
        </>
      );

    case 'narrator':
      return (
        <>
          <div>
            <label className={`${labelClass} font-mono-family`}>旁白内容</label>
            <textarea
              value={node.content}
              onChange={(e) => onUpdate({ content: e.target.value })}
              className={`${inputClass} h-24 resize-none font-body-family`}
              placeholder="输入旁白文本..."
              aria-label="旁白内容"
            />
          </div>
          <div>
            <label className={`${labelClass} font-mono-family`}>语音文件</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={node.voice || ''}
                onChange={(e) => onUpdate({ voice: e.target.value || undefined })}
                className={`${inputClass} flex-1 font-mono-family`}
                placeholder="例: narrator_01.wav"
                aria-label="旁白语音文件"
              />
              {projectPath && (
                <AssetPickerButton
                  projectPath={projectPath}
                  category="vocal"
                  currentValue={node.voice || ''}
                  aliases={vocalAliases}
                  onSelect={(name) => onUpdate({ voice: name === 'none' ? undefined : name })}
                />
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              作为当前旁白的 -voice 标记保存，不会新建独立音频指令
            </p>
          </div>
        </>
      );

    case 'intro':
      return (
        <div>
          <label className={`${labelClass} font-mono-family`}>黑屏文字（每行用回车分隔）</label>
          <textarea
            value={(node.introLines || []).join('\n')}
            onChange={(e) =>
              onUpdate({
                introLines: e.target.value.split('\n'),
                content: e.target.value.split('\n').join('|'),
              })
            }
            className={`${inputClass} h-28 resize-none font-body-family`}
            placeholder="第一行&#10;第二行&#10;第三行"
            aria-label="黑屏文字"
          />
        </div>
      );

    case 'choose':
      return (
        <ChoiceEditor node={node} onUpdate={onUpdate} scenes={scenes} sceneHeaders={sceneHeaders} />
      );

    case 'changeBg':
      return (
        <div>
          <label className={`${labelClass} font-mono-family`}>背景图片</label>
          {projectPath && node.asset && node.asset !== 'none' && (
            <div className="mb-2 overflow-hidden rounded-md border border-border bg-secondary/20">
              <div className="aspect-video bg-secondary/30">
                <img
                  src={convertFileSrc(`${projectPath}/game/background/${node.asset}`)}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div className="px-3 py-2 min-w-0">
                <div className="truncate text-sm">
                  {backgroundAliases[node.asset] || node.asset}
                </div>
                {backgroundAliases[node.asset] && (
                  <div className="truncate text-[11px] text-muted-foreground font-mono-family">
                    {node.asset}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex gap-1">
            <input
              type="text"
              value={node.asset || node.content}
              onChange={(e) => onUpdate({ asset: e.target.value, content: e.target.value })}
              className={`${inputClass} flex-1 font-mono-family`}
              placeholder="例: bg.webp 或 none"
              aria-label="背景图片"
            />
            {projectPath && (
              <AssetPickerButton
                projectPath={projectPath}
                category="background"
                currentValue={node.asset || node.content}
                aliases={backgroundAliases}
                onSelect={(name) => onUpdate({ asset: name, content: name })}
              />
            )}
          </div>
          {(node.asset || node.content) && (node.asset || node.content) !== 'none' && (
            <button
              type="button"
              onClick={() => onUpdate({ asset: 'none', content: 'none' })}
              className="mt-2 px-2 py-1 rounded bg-secondary hover:bg-secondary/70 text-xs"
            >
              清除
            </button>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">放在 game/background/ 目录下</p>
        </div>
      );

    case 'changeFigure':
      return (
        <>
          <CharacterFigurePicker
            node={node}
            onUpdate={onUpdate}
            characters={characters}
            projectPath={projectPath}
            suggestedFigureCharacter={suggestedFigureCharacter}
          />
          <div>
            <label className={`${labelClass} font-mono-family`}>位置</label>
            <select
              value={node.figurePosition || 'center'}
              onChange={(e) =>
                onUpdate({
                  figurePosition: e.target.value as 'left' | 'center' | 'right',
                })
              }
              className={inputClass}
              aria-label="立绘位置"
            >
              <option value="left">左侧</option>
              <option value="center">居中</option>
              <option value="right">右侧</option>
            </select>
          </div>
          <div>
            <label className={`${labelClass} font-mono-family`}>自定义 ID</label>
            <input
              type="text"
              value={node.figureId || ''}
              onChange={(e) => onUpdate({ figureId: e.target.value || undefined })}
              className={`${inputClass} font-mono-family`}
              placeholder="可选，用于精确定位"
              aria-label="自定义 ID"
            />
          </div>
        </>
      );

    case 'miniAvatar':
      return (
        <div>
          <label className={`${labelClass} font-mono-family`}>小头像文件</label>
          <div className="flex gap-1">
            <input
              type="text"
              value={node.asset || node.content}
              onChange={(e) => onUpdate({ asset: e.target.value, content: e.target.value })}
              className={`${inputClass} flex-1 font-mono-family`}
              placeholder="例: miniavatar.webp 或 none"
              aria-label="小头像文件"
            />
            {projectPath && (
              <AssetPickerButton
                projectPath={projectPath}
                category="figure"
                currentValue={node.asset || node.content}
                aliases={figureAliases}
                onSelect={(name) => onUpdate({ asset: name, content: name })}
              />
            )}
          </div>
        </div>
      );

    case 'changeScene':
    case 'callScene':
      return (
        <div>
          <label className={`${labelClass} font-mono-family`}>目标场景</label>
          <SceneSelect
            value={node.targetScene || node.content || ''}
            scenes={scenes}
            sceneHeaders={sceneHeaders}
            onChange={(name) => onUpdate({ targetScene: name, content: name })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            {node.type === 'callScene'
              ? 'callScene 执行完后会返回当前场景'
              : 'changeScene 会永久切换'}
          </p>
        </div>
      );

    case 'end':
      return <p className="text-sm text-muted-foreground">结束当前场景，无需参数。</p>;

    case 'bgm':
    case 'playEffect':
    case 'playVideo':
      return (
        <>
          <div>
            <label className={`${labelClass} font-mono-family`}>
              {node.type === 'bgm'
                ? '音乐文件'
                : node.type === 'playEffect'
                  ? '音效文件'
                  : '视频文件'}
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                value={node.asset || node.content}
                onChange={(e) => onUpdate({ asset: e.target.value, content: e.target.value })}
                className={`${inputClass} flex-1 font-mono-family`}
                placeholder={node.type === 'bgm' ? '例: bgm.mp3 或 none' : '例: effect.mp3'}
                aria-label={
                  node.type === 'bgm'
                    ? '音乐文件'
                    : node.type === 'playEffect'
                      ? '音效文件'
                      : '视频文件'
                }
              />
              {projectPath && (
                <AssetPickerButton
                  projectPath={projectPath}
                  category={
                    node.type === 'playEffect'
                      ? 'vocal'
                      : node.type === 'playVideo'
                        ? 'video'
                        : 'bgm'
                  }
                  currentValue={node.asset || node.content}
                  aliases={
                    node.type === 'playEffect'
                      ? vocalAliases
                      : node.type === 'playVideo'
                        ? videoAliases
                        : bgmAliases
                  }
                  onSelect={(name) => onUpdate({ asset: name, content: name })}
                />
              )}
            </div>
          </div>
          <div>
            <label className={`${labelClass} font-mono-family`}>音量 (0-100)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={node.volume ?? ''}
              onChange={(e) =>
                onUpdate({
                  volume: e.target.value ? parseInt(e.target.value, 10) : undefined,
                })
              }
              className={inputClass}
              placeholder="默认 100"
              aria-label="音量"
            />
          </div>
        </>
      );

    case 'label':
    case 'jumpLabel':
      return (
        <div>
          <label className={`${labelClass} font-mono-family`}>标签名称</label>
          <input
            type="text"
            value={node.labelName || node.content}
            onChange={(e) => onUpdate({ labelName: e.target.value, content: e.target.value })}
            className={`${inputClass} font-mono-family`}
            placeholder="例: branch_a"
            aria-label="标签名称"
          />
        </div>
      );

    case 'setVar':
      return (
        <>
          <div>
            <label className={`${labelClass} font-mono-family`}>变量名</label>
            <input
              type="text"
              value={node.varName || ''}
              onChange={(e) =>
                onUpdate({
                  varName: e.target.value,
                  content: `${e.target.value}=${node.varValue || ''}`,
                })
              }
              className={`${inputClass} font-mono-family`}
              placeholder="例: score"
              aria-label="变量名"
            />
          </div>
          <div>
            <label className={`${labelClass} font-mono-family`}>值</label>
            <input
              type="text"
              value={node.varValue || ''}
              onChange={(e) =>
                onUpdate({
                  varValue: e.target.value,
                  content: `${node.varName || ''}=${e.target.value}`,
                })
              }
              className={`${inputClass} font-mono-family`}
              placeholder="例: 1, true, 文本"
              aria-label="值"
            />
          </div>
        </>
      );

    case 'getUserInput':
      return (
        <>
          <div>
            <label className={`${labelClass} font-mono-family`}>存入变量</label>
            <input
              type="text"
              value={node.varName || node.content}
              onChange={(e) => onUpdate({ varName: e.target.value, content: e.target.value })}
              className={`${inputClass} font-mono-family`}
              placeholder="例: name"
              aria-label="存入变量"
            />
          </div>
          <div>
            <label className={`${labelClass} font-mono-family`}>提示文字</label>
            <input
              type="text"
              value={node.inputTitle || ''}
              onChange={(e) => onUpdate({ inputTitle: e.target.value })}
              className={`${inputClass} font-mono-family`}
              placeholder="例: 请输入你的名字"
              aria-label="提示文字"
            />
          </div>
          <div>
            <label className={`${labelClass} font-mono-family`}>按钮文字</label>
            <input
              type="text"
              value={node.inputButton || ''}
              onChange={(e) => onUpdate({ inputButton: e.target.value })}
              className={`${inputClass} font-mono-family`}
              placeholder="例: 确认"
              aria-label="按钮文字"
            />
          </div>
        </>
      );

    case 'setTextbox':
      return (
        <div>
          <label className={`${labelClass} font-mono-family`}>操作</label>
          <select
            value={node.content || 'hide'}
            onChange={(e) => onUpdate({ content: e.target.value })}
            className={`${inputClass} font-mono-family`}
            aria-label="操作"
          >
            <option value="hide">隐藏</option>
            <option value="show">显示</option>
          </select>
        </div>
      );

    case 'setAnimation':
      return (
        <>
          <div>
            <label className={`${labelClass} font-mono-family`}>动画名称</label>
            <input
              type="text"
              value={node.animationName || node.content}
              onChange={(e) =>
                onUpdate({
                  animationName: e.target.value,
                  content: e.target.value,
                })
              }
              className={`${inputClass} font-mono-family`}
              placeholder="例: enter-from-left"
              aria-label="动画名称"
            />
          </div>
          <div>
            <label className={`${labelClass} font-mono-family`}>目标 (-target)</label>
            <input
              type="text"
              value={node.animationTarget || ''}
              onChange={(e) => onUpdate({ animationTarget: e.target.value || undefined })}
              className={`${inputClass} font-mono-family`}
              placeholder="例: fig-left"
              aria-label="动画目标"
            />
          </div>
        </>
      );

    case 'setTransform':
      return (
        <div>
          <label className={`${labelClass} font-mono-family`}>变换 JSON</label>
          <textarea
            value={node.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            className={`${inputClass} h-24 resize-none font-mono-family`}
            placeholder='例: {"position":{"x":100,"y":0}}'
            aria-label="变换 JSON"
          />
        </div>
      );

    case 'unlockCg':
    case 'unlockBgm': {
      const unlockCategory = node.type === 'unlockCg' ? 'background' : 'bgm';
      const unlockAliases = node.type === 'unlockCg' ? backgroundAliases : bgmAliases;
      return (
        <>
          <div>
            <label className={`${labelClass} font-mono-family`}>
              {node.type === 'unlockCg' ? 'CG 文件' : 'BGM 文件'}
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                value={node.asset || node.content}
                onChange={(e) => onUpdate({ asset: e.target.value, content: e.target.value })}
                className={`${inputClass} flex-1 font-mono-family`}
                placeholder={node.type === 'unlockCg' ? '例: event_cg.webp' : '例: theme.mp3'}
                aria-label={node.type === 'unlockCg' ? 'CG 文件' : 'BGM 文件'}
              />
              {projectPath && (
                <AssetPickerButton
                  projectPath={projectPath}
                  category={unlockCategory}
                  currentValue={node.asset || node.content}
                  aliases={unlockAliases}
                  onSelect={(name) => onUpdate({ asset: name, content: name })}
                />
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {node.type === 'unlockCg'
                ? 'WebGAL 会从 game/background/ 读取 CG 图片'
                : 'WebGAL 会从 game/bgm/ 读取鉴赏音乐'}
            </p>
          </div>
          <div>
            <label className={`${labelClass} font-mono-family`}>显示名称</label>
            <input
              type="text"
              value={node.displayName || ''}
              onChange={(e) => onUpdate({ displayName: e.target.value || undefined })}
              className={`${inputClass} font-mono-family`}
              placeholder="在鉴赏中显示的名称"
              aria-label="显示名称"
            />
          </div>
        </>
      );
    }

    case 'comment':
      return (
        <div>
          <label className={`${labelClass} font-mono-family`}>注释内容</label>
          <textarea
            value={node.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            className={`${inputClass} h-24 resize-none`}
            placeholder="写下备注..."
            aria-label="注释内容"
          />
        </div>
      );

    default:
      return (
        <div>
          <label className={`${labelClass} font-mono-family`}>内容</label>
          <textarea
            value={node.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            className={`${inputClass} h-24 resize-none`}
            aria-label="内容"
          />
        </div>
      );
  }
}


