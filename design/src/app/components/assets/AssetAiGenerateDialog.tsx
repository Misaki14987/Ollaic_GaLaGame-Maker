import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { saveGeneratedAsset, type AssetInfo, type SceneAssetCard, type VoiceAssetCard } from '@/app/lib/assets/assets-ipc';
import { musicCategoryLabels, type TabId, type MusicCategory } from './asset-utils';
export function AssetAiGenerateDialog({
  open,
  activeTab,
  musicCategory,
  projectPath,
  initialSceneCard,
  initialVoiceCard,
  initialAssetPrompt,
  initialMusicFilename,
  onGenerated,
  onClose,
}: {
  open: boolean;
  activeTab: TabId;
  musicCategory: MusicCategory;
  projectPath: string;
  initialSceneCard?: SceneAssetCard | null;
  initialVoiceCard?: VoiceAssetCard | null;
  initialAssetPrompt?: string;
  initialMusicFilename?: string | null;
  onGenerated: (asset: AssetInfo, prompt?: string) => void | Promise<void>;
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
  const [musicPrompt, setMusicPrompt] = useState('');

  const isImageGeneration = activeTab === 'scene' || activeTab === 'cg';
  const isVoiceGeneration = activeTab === 'music' && Boolean(initialVoiceCard);
  const isMusicGeneration = activeTab === 'music' && !isVoiceGeneration;
  const title = isImageGeneration
    ? activeTab === 'cg'
      ? 'AI 生成 CG 剧情画'
      : 'AI 生成背景素材'
    : isVoiceGeneration
      ? 'AI 生成配音'
      : `AI 生成${musicCategoryLabels[musicCategory]}`;
  const configuredModels = config ? parseConfiguredModels(config.model) : [];
  const effectiveModel = selectedModel || configuredModels[0] || config?.model.trim() || '';
  const promptSource = isImageGeneration
    ? initialSceneCard?.prompt.trim() || (initialAssetPrompt ?? '').trim()
    : isVoiceGeneration
      ? [
          initialVoiceCard?.text.trim(),
          initialVoiceCard?.character ? `角色：${initialVoiceCard.character}` : '',
          initialVoiceCard?.emotion ? `情绪：${initialVoiceCard.emotion}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : musicPrompt.trim();
  const targetCategory = isImageGeneration
    ? 'background'
    : isVoiceGeneration
      ? 'vocal'
      : musicCategory;
  const targetFilename = isImageGeneration
    ? `${initialSceneCard?.targetStem || initialSceneCard?.imageAsset?.replace(/\.[^.]+$/, '') || 'generated_background'}.png`
    : isVoiceGeneration
      ? initialVoiceCard?.voiceAsset ||
        `${initialVoiceCard?.targetStem || initialVoiceCard?.id || 'generated_voice'}.wav`
      : initialMusicFilename?.trim() || `generated_${musicCategory}.wav`;

  useEffect(() => {
    if (!open) return;
    if (isMusicGeneration) setMusicPrompt((initialAssetPrompt ?? '').trim());
  }, [open, isMusicGeneration, initialAssetPrompt]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setGenerationProgress(null);
    setLoadingConfig(true);
    (isImageGeneration
      ? getAiImageConfig()
      : isMusicGeneration
        ? getAiMusicConfig()
        : getAiTtsConfig()
    )
      .then((nextConfig) => {
        setConfig(nextConfig);
        const models = parseConfiguredModels(nextConfig.model);
        setSelectedModel(models[0] ?? nextConfig.model.trim());
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingConfig(false));
  }, [initialSceneCard, initialVoiceCard, isImageGeneration, musicCategory, open]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listenAiMediaGenerationProgress((progress) => {
      if (!disposed) {
        setGenerationProgress(progress);
      }
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

  if (!open) return null;

  const handleSubmit = async () => {
    if (!config) {
      setError('未读取到 AI 配置。');
      return;
    }
    if (!projectPath) {
      setError('未打开项目，无法保存生成素材。');
      return;
    }
    if (!effectiveModel) {
      setError(
        isImageGeneration
          ? '请先在图片 AI 设置中选择至少一个模型。'
          : '请先在音频 AI 设置中选择至少一个模型。',
      );
      return;
    }
    if (!promptSource.trim()) {
      setError(
        isImageGeneration
          ? '请先在右侧详情里填写描述。'
          : isVoiceGeneration
            ? '请先在右侧详情里填写台词。'
            : isMusicGeneration
              ? '请先填写音乐描述（提示词）。'
              : '请先在右侧详情里填写台词或描述。',
      );
      return;
    }
    setError(null);
    setGenerationProgress(null);
    setGenerating(true);
    try {
      const media = isImageGeneration
        ? await aiGenerateImage(promptSource, effectiveModel)
        : isMusicGeneration
          ? await generateMusic(
              promptSource,
              effectiveModel,
              targetFilename.split('.').pop() || 'mp3',
            )
          : await aiGenerateTts(
              isVoiceGeneration ? (initialVoiceCard?.text ?? promptSource) : promptSource,
              isVoiceGeneration
                ? `${initialVoiceCard?.character || '旁白'} ${initialVoiceCard?.emotion || '默认'}`
                : promptSource,
              effectiveModel,
              targetFilename.split('.').pop() || 'mp3',
            );
      const asset = await saveGeneratedAsset(
        projectPath,
        targetCategory,
        targetFilename,
        media.base64Data,
      );
      await onGenerated(asset, isMusicGeneration ? promptSource : undefined);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[680px] max-h-[86vh] overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-display-family">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className="rounded-md px-2 py-1 text-sm hover:bg-secondary/60"
          >
            关闭
          </button>
        </div>

        <div className="max-h-[calc(86vh-120px)] overflow-y-auto p-4 space-y-4">
          <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
            {loadingConfig
              ? '正在读取 AI 配置...'
              : config
                ? `使用配置：${config.provider} / ${effectiveModel || '未填写模型'}`
                : '未读取到配置'}
          </div>

          <FieldBlock label="生成模型">
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
                type="text"
                value={effectiveModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder={
                  isImageGeneration ? '先在图片 AI 设置中选择模型' : '先在音频 AI 设置中选择模型'
                }
                className="w-full rounded-md border border-border bg-input-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            )}
          </FieldBlock>

          {isMusicGeneration ? (
            <FieldBlock label="音乐描述（提示词）">
              <textarea
                value={musicPrompt}
                onChange={(e) => setMusicPrompt(e.target.value)}
                rows={3}
                placeholder="例：紧张的战斗背景音乐，快节奏鼓点与弦乐，循环"
                className="w-full resize-none rounded-md border border-border bg-input-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </FieldBlock>
          ) : promptSource.trim() ? (
            <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
              {isVoiceGeneration
                ? '将使用右侧详情中的台词、角色和情绪作为生成提示词。'
                : '将使用右侧详情中的描述、台词和情绪作为生成提示词。'}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              {isVoiceGeneration
                ? '右侧详情还没有可用于生成的台词。'
                : '右侧详情还没有可用于生成的描述。'}
            </div>
          )}

          <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-muted-foreground font-mono-family break-all">
            game/{targetCategory}/{targetFilename}
          </div>

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
            className="rounded-md bg-secondary px-4 py-2 text-sm hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loadingConfig || generating}
            className="inline-flex min-w-24 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                生成中...
              </>
            ) : (
              '生成素材'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
function parseConfiguredModels(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}
function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
