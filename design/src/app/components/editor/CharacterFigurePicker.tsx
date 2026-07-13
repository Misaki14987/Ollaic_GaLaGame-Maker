import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Image, Search } from 'lucide-react';
import type { Character } from '@/app/lib/character/character-types';
import type { WebGalNode } from '@/app/lib/webgal/webgal-types';
import { listAssets, type AssetInfo } from '@/app/lib/assets/assets-ipc';
import { figureFileTail, spritePrefix } from '@/app/lib/editor/figure-resolve';
import { AssetPickerButton } from '@/app/components/assets/AssetPicker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import {
  findSpriteSelection,
  figureAliasesFromCharacters,
  resolveSpriteImage,
  inputClass,
  labelClass,
} from './detail-utils';
export function CharacterFigurePicker({
  node,
  onUpdate,
  characters,
  projectPath,
  suggestedFigureCharacter,
}: {
  node: WebGalNode;
  onUpdate: (updates: Partial<WebGalNode>) => void;
  characters: Character[];
  projectPath?: string;
  suggestedFigureCharacter?: string;
}) {
  const filename = node.asset || node.content;
  const inferred = useMemo(() => findSpriteSelection(characters, filename), [characters, filename]);
  const selectedCharacterName =
    node.figureCharacter || inferred?.character.name || suggestedFigureCharacter || '';
  const selectedCharacter = characters.find(
    (character) => character.name === selectedCharacterName,
  );
  const figureAliases = useMemo(() => figureAliasesFromCharacters(characters), [characters]);

  useEffect(() => {
    if (!node.figureCharacter && !node.figureEmotion && inferred) {
      onUpdate({
        figureCharacter: inferred.character.name,
        figureEmotion: inferred.sprite.emotion,
      });
    }
  }, [inferred, node.figureCharacter, node.figureEmotion, onUpdate]);

  const chooseCharacter = (name: string) => {
    if (!name) {
      onUpdate({ figureCharacter: undefined, figureEmotion: undefined });
      return;
    }
    const character = characters.find((item) => item.name === name);
    const firstSprite = character?.sprites[0];
    onUpdate({
      figureCharacter: name,
      figureEmotion: firstSprite?.emotion,
      asset: firstSprite?.file || filename,
      content: firstSprite?.file || filename,
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className={`${labelClass} font-mono-family`}>关联角色</label>
        <select
          value={selectedCharacterName}
          onChange={(e) => chooseCharacter(e.target.value)}
          className={inputClass}
          aria-label="关联角色"
        >
          <option value="">无</option>
          {characters.map((character) => (
            <option key={character.id} value={character.name}>
              {character.name}
            </option>
          ))}
        </select>
      </div>

      {selectedCharacter ? (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={`${labelClass} font-mono-family mb-0`}>表情形态</label>
            <span className="text-[10px] text-muted-foreground font-mono-family">
              {filename || 'none'}
            </span>
          </div>
          <CharacterEmotionDialog
            character={selectedCharacter}
            currentFile={filename}
            projectPath={projectPath}
            onSelect={(sprite) =>
              onUpdate({
                asset: sprite.file,
                content: sprite.file,
                figureCharacter: selectedCharacter.name,
                figureEmotion: sprite.emotion,
              })
            }
          />
        </div>
      ) : (
        <div>
          <label className={`${labelClass} font-mono-family`}>立绘文件</label>
          <div className="flex gap-1">
            <input
              type="text"
              value={filename}
              onChange={(e) =>
                onUpdate({
                  asset: e.target.value,
                  content: e.target.value,
                  figureCharacter: undefined,
                  figureEmotion: undefined,
                })
              }
              className={`${inputClass} flex-1 font-mono-family`}
              placeholder="例: stand.webp 或 none"
              aria-label="立绘文件"
            />
            {projectPath && (
              <AssetPickerButton
                projectPath={projectPath}
                category="figure"
                currentValue={filename}
                aliases={figureAliases}
                onSelect={(name) =>
                  onUpdate({
                    asset: name,
                    content: name,
                    figureCharacter: undefined,
                    figureEmotion: undefined,
                  })
                }
              />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">放在 game/figure/ 目录下</p>
        </div>
      )}
    </div>
  );
}


function CharacterEmotionDialog({
  character,
  currentFile,
  projectPath,
  onSelect,
}: {
  character: Character;
  currentFile: string;
  projectPath?: string;
  onSelect: (sprite: Character['sprites'][number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState<AssetInfo[]>([]);

  // 立绘按角色存放在 figure/<角色ID>/（变体）与 figure/<角色ID>/main/（主体候选）。
  useEffect(() => {
    if (!open || !projectPath) return;
    let cancelled = false;
    (async () => {
      const [variants, candidates] = await Promise.all([
        listAssets(projectPath, `figure/${character.id}`).catch(() => [] as AssetInfo[]),
        listAssets(projectPath, `figure/${character.id}/main`).catch(() => [] as AssetInfo[]),
      ]);
      if (!cancelled) setAssets([...variants, ...candidates]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, character.id]);

  const hasSelection = Boolean(currentFile) && currentFile !== 'none';
  // 当前选中文件直接据其限定路径出图：变体的 sprite.file 为空，无法用 find 反查，
  // 故不依赖 sprites 匹配，直接用 currentFile 渲染缩略图。
  const selectedSprite = character.sprites.find((sprite) => sprite.file === currentFile);
  const selectedSrc =
    hasSelection && projectPath
      ? convertFileSrc(`${projectPath}/game/figure/${currentFile}`)
      : null;
  const filtered = character.sprites.filter((sprite) =>
    `${sprite.emotion} ${sprite.file}`.toLowerCase().includes(search.toLowerCase()),
  );

  // 收集所有已被 sprite 条目关联的文件名（含前缀匹配的变体），剩余的为「未绑定」素材。
  const boundTails = useMemo(() => {
    const set = new Set<string>();
    for (const sprite of character.sprites) {
      if (sprite.file) {
        set.add(figureFileTail(sprite.file));
      } else {
        const prefix = spritePrefix(character, sprite.emotion);
        for (const asset of assets) {
          if (figureFileTail(asset.name).startsWith(prefix)) set.add(figureFileTail(asset.name));
        }
      }
    }
    return set;
  }, [character, assets]);

  const unboundAssets = useMemo(() => {
    const list = assets.filter((asset) => !boundTails.has(figureFileTail(asset.name)));
    return search
      ? list.filter((asset) =>
          figureFileTail(asset.name).toLowerCase().includes(search.toLowerCase()),
        )
      : list;
  }, [assets, boundTails, search]);

  const hasAnything = character.sprites.length > 0 || unboundAssets.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-border bg-card/60 hover:bg-secondary/50 transition-colors overflow-hidden text-left"
      >
        {hasSelection ? (
          <div className="flex items-center gap-3 p-2">
            <div className="w-14 h-20 rounded bg-secondary/30 overflow-hidden flex-shrink-0 flex items-center justify-center">
              {selectedSrc ? (
                <img src={selectedSrc} alt="" className="w-full h-full object-cover object-top" />
              ) : (
                <Image className="w-6 h-6 text-muted-foreground/40" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm truncate">
                {selectedSprite?.emotion
                  ? `${character.name} · ${selectedSprite.emotion}`
                  : character.name}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground truncate font-mono-family">
                {figureFileTail(currentFile)}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 text-sm text-muted-foreground">选择 {character.name} 的表情/姿态</div>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
            <DialogTitle className="text-base font-display-family">
              选择立绘 - {character.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              点击表情卡片后会写入对应立绘文件名。
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索表情、姿态或文件名..."
                className="w-full pl-10 pr-3 py-2 text-sm bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                aria-label="搜索表情"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-5">
            {!hasAnything ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                该角色暂无立绘，请先在素材库中添加。
              </div>
            ) : (
              <div className="space-y-4">
                {filtered.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {filtered.map((sprite) => {
                      const resolved = resolveSpriteImage(character, sprite, assets, projectPath);
                      const selected = (resolved.file || sprite.file) === currentFile;
                      return (
                        <button
                          type="button"
                          key={`${character.id}-${sprite.file}-${sprite.emotion}`}
                          onClick={() => {
                            onSelect({
                              ...sprite,
                              file: resolved.file || sprite.file,
                            });
                            setOpen(false);
                          }}
                          className={`min-h-40 rounded-md border overflow-hidden bg-card/60 hover:bg-secondary/50 transition-colors text-left ${
                            selected ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                          }`}
                        >
                          <div className="h-28 bg-secondary/30 flex items-center justify-center overflow-hidden">
                            {resolved.src ? (
                              <img
                                src={resolved.src}
                                alt=""
                                className="w-full h-full object-cover object-top"
                              />
                            ) : (
                              <Image className="w-7 h-7 text-muted-foreground/40" />
                            )}
                          </div>
                          <div className="px-2 py-1 text-center">
                            <div className="truncate text-xs">{sprite.emotion || '默认'}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {unboundAssets.length > 0 && (
                  <>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      未绑定素材
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {unboundAssets.map((asset) => {
                        const tail = figureFileTail(asset.name);
                        const qualifiedFile = `${character.id}/${tail}`;
                        const selected = qualifiedFile === currentFile;
                        return (
                          <button
                            type="button"
                            key={asset.path}
                            onClick={() => {
                              onSelect({ emotion: '', file: qualifiedFile });
                              setOpen(false);
                            }}
                            className={`min-h-40 rounded-md border overflow-hidden bg-card/60 hover:bg-secondary/50 transition-colors text-left ${
                              selected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border'
                            }`}
                          >
                            <div className="h-28 bg-secondary/30 flex items-center justify-center overflow-hidden">
                              <img
                                src={convertFileSrc(asset.path)}
                                alt=""
                                className="w-full h-full object-cover object-top"
                              />
                            </div>
                            <div className="px-2 py-1 text-center">
                              <div className="truncate text-xs text-muted-foreground">{tail}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

