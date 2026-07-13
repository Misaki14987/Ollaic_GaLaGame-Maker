import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Edit3, Image, Loader2, Sparkles, Trash2, Upload } from 'lucide-react';
import { findAssetUsages, type AssetInfo, type AssetUsage, type SceneAssetCard } from '@/app/lib/assets/assets-ipc';
import { referenceFilePath } from '@/app/lib/assets/asset-metadata';
import { sceneCardTargetFilename } from './asset-utils';
export function SceneCardDetails({
  card,
  projectPath,
  backgroundAssets,
  getThumbnail,
  references,
  referenceUploading,
  onReferenceUpload,
  onReferenceRemove,
  onSave,
  onGenerate,
  onOpenUsage,
}: {
  card: SceneAssetCard;
  projectPath: string;
  backgroundAssets: AssetInfo[];
  getThumbnail: (asset: AssetInfo) => string | null;
  references: string[];
  referenceUploading: boolean;
  onReferenceUpload: (card: SceneAssetCard) => void;
  onReferenceRemove: (card: SceneAssetCard, filename: string) => void;
  onSave: (card: SceneAssetCard) => void;
  onGenerate: (card: SceneAssetCard) => void;
  onOpenUsage: (usage: AssetUsage) => void;
}) {
  const [draft, setDraft] = useState<SceneAssetCard>(card);
  const [usages, setUsages] = useState<AssetUsage[]>([]);

  useEffect(() => {
    setDraft({
      ...card,
      targetStem: card.targetStem || card.imageAsset?.replace(/\.[^.]+$/, '') || card.id,
    });
  }, [card]);

  const previewAsset = backgroundAssets.find((asset) => asset.name === draft.imageAsset) ?? null;
  const previewUrl = previewAsset ? getThumbnail(previewAsset) : null;
  const targetStem = draft.targetStem || draft.imageAsset?.replace(/\.[^.]+$/, '') || draft.id;
  const targetFilename = sceneCardTargetFilename(draft);
  const targetPath = projectPath
    ? `${projectPath}\\game\\background\\${targetFilename}`
    : targetFilename;

  // 查找当前背景图（无论是否已生成）被哪些剧本行引用。
  useEffect(() => {
    if (!projectPath || !targetFilename) {
      setUsages([]);
      return;
    }
    let cancelled = false;
    findAssetUsages(projectPath, targetFilename, 'background')
      .then((rows) => {
        if (!cancelled) setUsages(rows);
      })
      .catch(() => {
        if (!cancelled) setUsages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, targetFilename]);

  const update = (patch: Partial<SceneAssetCard>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      onSave(next);
      return next;
    });
  };
  const handleRenameScene = () => {
    const currentStem = targetStem.replace(/\.(png|jpe?g|webp)$/i, '');
    const nextStem = prompt('输入新名称:', currentStem);
    if (!nextStem || nextStem === currentStem) return;
    const normalizedStem = nextStem.replace(/\.(png|jpe?g|webp)$/i, '');
    const next = { ...draft, targetStem: normalizedStem };
    setDraft(next);
    onSave(next);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-6">
        <div className="mb-6">
          <div className="aspect-video rounded-lg overflow-hidden bg-secondary/30 mb-4">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={draft.title}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = '0.3';
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Image className="h-14 w-14 opacity-40" />
                <span className="text-xs">未生成背景图</span>
              </div>
            )}
          </div>
          <h2 className="text-xl mb-2 font-display-family">{targetFilename}</h2>
          <p className="text-xs text-muted-foreground truncate font-mono-family">{targetPath}</p>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
              显示名称
            </label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              placeholder="例：教室 · 白天"
              aria-label="场景显示名称"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              设置后，剧本编辑器的素材选择弹窗会优先显示这个名称。
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                参考图
              </label>
              <button
                type="button"
                onClick={() => onReferenceUpload(draft)}
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
              {references.length === 0 ? (
                <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border p-3">
                  暂无参考资料。
                </div>
              ) : (
                references.map((filename) => {
                  const sourcePath = referenceFilePath(
                    projectPath,
                    'background',
                    targetFilename,
                    filename,
                  );
                  if (!sourcePath) return null;
                  return (
                    <div
                      key={filename}
                      className="flex items-center gap-2 rounded-md bg-secondary/20 p-2"
                    >
                      <img
                        src={convertFileSrc(sourcePath)}
                        alt=""
                        className="w-10 h-10 rounded object-cover bg-secondary"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-mono-family">
                        {filename}
                      </span>
                      <button
                        type="button"
                        onClick={() => onReferenceRemove(draft, filename)}
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

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
              描述
            </label>
            <textarea
              value={draft.prompt}
              onChange={(e) => update({ prompt: e.target.value })}
              rows={6}
              placeholder="描述要生成或重绘的背景：地点、时间、天气、氛围、镜头角度、画面主体。"
              className="w-full resize-y rounded-md border border-border bg-input-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
              剧本引用
            </label>
            <div className="space-y-2">
              {usages.length === 0 ? (
                <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border p-3">
                  未在剧本中找到引用。
                </div>
              ) : (
                usages.map((usage, index) => (
                  <button
                    key={`${usage.sceneFile}-${usage.lineNumber}-${index}`}
                    type="button"
                    onClick={() => onOpenUsage(usage)}
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
            type="button"
            onClick={handleRenameScene}
            className="w-full px-4 py-2 rounded-md bg-secondary hover:bg-secondary/70 transition-all flex items-center justify-center gap-2"
          >
            <Edit3 className="w-4 h-4" />
            重命名
          </button>
          <button
            type="button"
            onClick={() => onGenerate(draft)}
            className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-all flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            AI 生成
          </button>
        </div>
      </div>
    </div>
  );
}
