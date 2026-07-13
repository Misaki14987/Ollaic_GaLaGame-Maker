import { useEffect, useState } from 'react';
import { Edit3, Music, Sparkles } from 'lucide-react';
import type { VoiceAssetCard } from '@/app/lib/assets/assets-ipc';
import { normalizeVoiceFilename, voiceFilenameStem, voiceEmotionOptions } from './asset-utils';
export function VoiceCardDetails({
  card,
  projectPath,
  vocalAssetNames,
  onSave,
  onGenerate,
}: {
  card: VoiceAssetCard;
  projectPath: string;
  vocalAssetNames: Set<string>;
  onSave: (card: VoiceAssetCard) => void;
  onGenerate: (card: VoiceAssetCard) => void;
}) {
  const [draft, setDraft] = useState<VoiceAssetCard>(card);
  const [filenameDraft, setFilenameDraft] = useState('');

  useEffect(() => {
    setDraft(card);
  }, [card]);

  const targetStem = draft.targetStem || draft.voiceAsset?.replace(/\.[^.]+$/, '') || draft.id;
  const targetFilename = draft.voiceAsset || `${targetStem}.wav`;
  const editableTargetFilename = draft.voiceAsset
    ? targetFilename
    : normalizeVoiceFilename(filenameDraft || targetFilename);
  const targetPath = projectPath
    ? `${projectPath}\\game\\vocal\\${editableTargetFilename}`
    : editableTargetFilename;
  const hasFilenameConflict = !draft.voiceAsset && vocalAssetNames.has(editableTargetFilename);
  const update = (patch: Partial<VoiceAssetCard>) =>
    setDraft((current) => ({ ...current, ...patch }));

  useEffect(() => {
    setFilenameDraft(targetFilename);
  }, [targetFilename]);

  const handleRenameVoice = () => {
    const nextName = prompt('输入音频文件名:', targetFilename);
    if (!nextName || nextName === targetFilename) return;
    const normalizedStem = voiceFilenameStem(nextName);
    const next = { ...draft, targetStem: normalizedStem };
    setDraft(next);
    onSave(next);
  };

  const commitFilenameChange = (value: string) => {
    if (draft.voiceAsset) return;
    const normalized = normalizeVoiceFilename(value);
    setFilenameDraft(normalized);
    const next = { ...draft, targetStem: voiceFilenameStem(normalized) };
    setDraft(next);
    onSave(next);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-6">
        <div className="mb-6">
          <div className="aspect-square rounded-lg overflow-hidden bg-secondary/30 mb-4 flex flex-col items-center justify-center gap-4">
            <Music className="w-16 h-16 text-muted-foreground" />
            <div className="w-2/3 h-8 rounded overflow-hidden bg-[repeating-linear-gradient(90deg,color-mix(in_srgb,var(--color-primary)_25%,transparent)_0_3px,transparent_3px_7px)]" />
          </div>
          <h2 className="text-xl mb-2 font-display-family">{editableTargetFilename}</h2>
          <p className="text-xs text-muted-foreground truncate font-mono-family">{targetPath}</p>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
              音频文件名
            </label>
            <input
              type="text"
              value={filenameDraft || targetFilename}
              readOnly={Boolean(draft.voiceAsset)}
              onChange={(e) => setFilenameDraft(e.target.value)}
              onBlur={(e) => commitFilenameChange(e.target.value)}
              className={`w-full px-3 py-2 bg-input-background border rounded-md text-sm font-mono-family focus:outline-none focus:ring-2 ${
                hasFilenameConflict
                  ? 'border-destructive/60 focus:ring-destructive/30'
                  : 'border-border focus:ring-primary/50'
              }`}
              aria-label="音频文件名"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {draft.voiceAsset
                ? '已生成/导入的真实文件请在“音频 > 语音文件”中重命名。'
                : '未生成前可自定义目标文件名；不写扩展名时默认使用 .wav。'}
            </p>
            {hasFilenameConflict && (
              <p className="mt-1 text-[10px] text-destructive">
                game/vocal 中已存在同名文件，请换一个文件名后再生成。
              </p>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
              角色
            </label>
            <input
              value={draft.character}
              onChange={(e) => update({ character: e.target.value })}
              className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              placeholder="例：Alice"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
              情绪
            </label>
            <select
              value={draft.emotion || '默认'}
              onChange={(e) => update({ emotion: e.target.value })}
              className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            >
              {voiceEmotionOptions.map((emotion) => (
                <option key={emotion} value={emotion}>
                  {emotion}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-2">
              台词文本
            </label>
            <textarea
              value={draft.text}
              onChange={(e) => update({ text: e.target.value })}
              rows={4}
              className="w-full resize-y rounded-md border border-border bg-input-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleRenameVoice}
            className="w-full px-4 py-2 rounded-md bg-secondary hover:bg-secondary/70 transition-all flex items-center justify-center gap-2"
          >
            <Edit3 className="w-4 h-4" />
            重命名
          </button>
          <button
            type="button"
            onClick={() => {
              const next = draft.voiceAsset
                ? draft
                : {
                    ...draft,
                    targetStem: voiceFilenameStem(editableTargetFilename),
                  };
              if (!draft.voiceAsset) {
                setDraft(next);
                onSave(next);
              }
              onGenerate(next);
            }}
            disabled={hasFilenameConflict}
            className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            AI 生成
          </button>
        </div>
      </div>
    </div>
  );
}
