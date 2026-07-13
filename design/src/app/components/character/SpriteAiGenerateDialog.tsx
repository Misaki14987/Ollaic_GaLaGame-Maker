import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import {
  getAiImageConfig,
  listenAiMediaGenerationProgress,
  type AiMediaGenerationProgress,
  type AiProviderConfig,
} from '@/app/lib/ai/ai-ipc';
import { parseConfiguredModels, type PendingSpriteGeneration } from './character-utils';
export function SpriteAiGenerateDialog({
  open,
  generation,
  initialInstruction,
  variantCount,
  onGenerate,
  onClose,
}: {
  open: boolean;
  generation: PendingSpriteGeneration | null;
  initialInstruction: string;
  variantCount: number;
  onGenerate: (model: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<AiProviderConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<AiMediaGenerationProgress | null>(
    null,
  );

  const configuredModels = config ? parseConfiguredModels(config.model) : [];
  const effectiveModel = selectedModel || configuredModels[0] || config?.model.trim() || '';
  const isBatch = generation?.batch === true;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setGenerationProgress(null);
    setLoadingConfig(true);
    getAiImageConfig()
      .then((nextConfig) => {
        setConfig(nextConfig);
        const models = parseConfiguredModels(nextConfig.model);
        setSelectedModel(models[0] ?? nextConfig.model.trim());
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingConfig(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listenAiMediaGenerationProgress((progress) => {
      if (!disposed) setGenerationProgress(progress);
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open]);

  if (!open || !generation) return null;

  const handleSubmit = async () => {
    if (!effectiveModel) {
      setError('请先在图片 AI 设置中选择至少一个模型。');
      return;
    }
    if (!isBatch && !initialInstruction.trim()) {
      setError(
        generation.target.kind === 'reference'
          ? '请先填写主体区域的设定图提示词。'
          : '请先填写该表情变体的提示词。',
      );
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      await onGenerate(effectiveModel);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[640px] max-h-[86vh] overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-display-family">
            {isBatch ? '批量生成角色立绘' : `生成立绘：${generation.emotion || '未命名形态'}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className="rounded-md px-2 py-1 text-sm hover:bg-secondary/60 disabled:opacity-50"
          >
            关闭
          </button>
        </div>

        <div className="max-h-[calc(86vh-120px)] overflow-y-auto p-4 space-y-4">
          <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
            {loadingConfig
              ? '正在读取图片 AI 配置...'
              : config
                ? `使用配置：${config.provider} / ${effectiveModel || '未填写模型'}`
                : '未读取到配置'}
          </div>

          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">
              生成模型
            </label>
            {configuredModels.length > 1 ? (
              <select
                value={effectiveModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full rounded-md border border-border bg-input-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {configuredModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={effectiveModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="先在图片 AI 设置中选择模型"
                className="w-full rounded-md border border-border bg-input-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            )}
          </div>

          {isBatch ? (
            <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
              将使用 {variantCount} 个表情变体各自填写的提示词批量生成；缺少提示词的变体会自动跳过。
            </div>
          ) : (
            <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
              {generation.target.kind === 'reference'
                ? '将使用主体区域的"设定图提示词（三视图）"生成。'
                : '将使用该表情变体卡片中填写的提示词生成。'}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {generating && (
            <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
              {generationProgress
                ? generationProgress.totalAttempts > 0
                  ? `${generationProgress.message} (${generationProgress.attempt}/${generationProgress.totalAttempts})`
                  : generationProgress.message
                : '正在提交生成请求...'}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className="rounded-md bg-secondary px-4 py-2 text-sm hover:bg-secondary/70 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loadingConfig || generating}
            className="inline-flex min-w-24 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generating ? '生成中' : '生成'}
          </button>
        </div>
      </div>
    </div>
  );
}
