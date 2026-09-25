import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VoiceDubbingPanel } from './VoiceDubbingPanel';
import type { VoiceAssetCard } from '../lib/assets-ipc';
import {
  generateBatchTts,
  listenBatchTtsProgress,
  getAiTtsConfig,
} from '../lib/ai-ipc';
import { listCharacters } from '../lib/character-ipc';
import { getScenePath, loadScene, saveScene } from '../lib/webgal-ipc';

vi.mock('../lib/ai-ipc', () => ({
  generateBatchTts: vi.fn(),
  listenBatchTtsProgress: vi.fn(),
  getAiTtsConfig: vi.fn(),
}));

vi.mock('../lib/character-ipc', () => ({
  listCharacters: vi.fn(),
}));

vi.mock('../lib/webgal-ipc', () => ({
  getScenePath: vi.fn(),
  loadScene: vi.fn(),
  saveScene: vi.fn(),
}));

vi.mock('../lib/assets-ipc', () => ({
  fillVoiceCard: vi.fn(),
  deleteVoiceCard: vi.fn(),
  importAsset: vi.fn(),
}));

const mockVoiceCard: VoiceAssetCard = {
  id: 'voice_scene1_1',
  text: '你好，欢迎来到这里！',
  character: '爱丽丝',
  emotion: '微笑',
  targetStem: 'vocal_alice_01',
  prompt: '',
  voiceAsset: null,
  usages: [
    {
      sceneFile: 'scene1.txt',
      lineNumber: 1,
      lineContent: '爱丽丝:你好，欢迎来到这里！;',
      command: '爱丽丝:你好，欢迎来到这里！;',
    },
  ],
};

describe('VoiceDubbingPanel single TTS generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCharacters).mockResolvedValue([
      { id: '1', name: '爱丽丝', voiceTimbre: 'alice_voice_id', aliases: [] },
    ] as any);
    vi.mocked(listenBatchTtsProgress).mockResolvedValue(vi.fn());
    vi.mocked(getScenePath).mockResolvedValue('/tmp/project/game/scene/scene1.txt');
    vi.mocked(loadScene).mockResolvedValue([
      { id: 'node_1', type: 'dialogue', content: '你好，欢迎来到这里！', character: '爱丽丝', flags: [] } as any,
    ]);
    vi.mocked(saveScene).mockResolvedValue();
  });

  it('parses comma-separated TTS model and passes single model to generateBatchTts', async () => {
    const user = userEvent.setup();
    // Simulate legacy or multi-model string configured in ttsConfig
    vi.mocked(getAiTtsConfig).mockResolvedValue({
      provider: 'openai',
      model: 'tts-1,tts-1-hd',
      api_key: 'test-key',
      base_url: '',
    });

    vi.mocked(generateBatchTts).mockResolvedValue([
      {
        voiceCardId: mockVoiceCard.id,
        index: 1,
        total: 1,
        status: 'done',
        message: 'done',
        assetName: 'vocal_alice_01.mp3',
      },
    ]);

    const onVoiceCardsChanged = vi.fn();
    const onSelectVoiceCard = vi.fn();

    render(
      <VoiceDubbingPanel
        projectPath="/tmp/project"
        voiceCards={[mockVoiceCard]}
        selectedVoiceCard={null}
        onSelectVoiceCard={onSelectVoiceCard}
        onVoiceCardsChanged={onVoiceCardsChanged}
      />
    );

    // Find and click the single generation button for the voice card
    const generateBtn = screen.getByTitle('AI 生成');
    expect(generateBtn).toBeInTheDocument();
    await user.click(generateBtn);

    await waitFor(() => {
      // Must pass single parsed model 'tts-1', NOT 'tts-1,tts-1-hd'
      expect(generateBatchTts).toHaveBeenCalledWith(
        '/tmp/project',
        [
          expect.objectContaining({
            voiceCardId: mockVoiceCard.id,
            text: '你好，欢迎来到这里！',
            voicePrompt: 'alice_voice_id',
          }),
        ],
        'tts-1',
        'mp3',
      );
    });

    await waitFor(() => {
      expect(saveScene).toHaveBeenCalled();
      expect(onVoiceCardsChanged).toHaveBeenCalled();
    });
  });

  it('does not let stale batch dialog model override single TTS after config changes', async () => {
    const user = userEvent.setup();
    // Initially user has OpenAI configured
    vi.mocked(getAiTtsConfig).mockResolvedValue({
      provider: 'openai',
      model: 'tts-1',
      api_key: 'test-key',
      base_url: '',
    });

    vi.mocked(generateBatchTts).mockResolvedValue([
      {
        voiceCardId: mockVoiceCard.id,
        index: 1,
        total: 1,
        status: 'done',
        message: 'done',
        assetName: 'vocal_alice_01.mp3',
      },
    ]);

    const onVoiceCardsChanged = vi.fn();
    const onSelectVoiceCard = vi.fn();

    render(
      <VoiceDubbingPanel
        projectPath="/tmp/project"
        voiceCards={[mockVoiceCard]}
        selectedVoiceCard={null}
        onSelectVoiceCard={onSelectVoiceCard}
        onVoiceCardsChanged={onVoiceCardsChanged}
      />
    );

    // Select card and open batch generate dialog
    const selectAllBtn = screen.getByRole('button', { name: /全选待配音/ });
    await user.click(selectAllBtn);
    const batchBtn = await screen.findByRole('button', { name: '生成选中 (1)' });
    await user.click(batchBtn);

    // Wait for batch dialog to open and show model selection
    await waitFor(() => {
      expect(screen.getByText('AI 配音生成')).toBeInTheDocument();
    });

    // Close batch dialog
    const cancelBtn = screen.getByRole('button', { name: '取消' });
    await user.click(cancelBtn);

    // Now user switches TTS provider in settings to Volcengine seed-tts-2.0
    vi.mocked(getAiTtsConfig).mockResolvedValue({
      provider: 'volcengine',
      model: 'seed-tts-2.0',
      api_key: 'volc-key',
      base_url: '',
    });

    // Click single generate on the card
    const generateBtn = screen.getByTitle('AI 生成');
    await user.click(generateBtn);

    await waitFor(() => {
      // Must use newly configured 'seed-tts-2.0', NOT stale 'tts-1' from batch dialog
      expect(generateBatchTts).toHaveBeenCalledWith(
        '/tmp/project',
        expect.any(Array),
        'seed-tts-2.0',
        'mp3',
      );
    });
  });
});
