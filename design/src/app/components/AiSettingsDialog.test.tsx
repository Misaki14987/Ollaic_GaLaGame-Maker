import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AiSettingsDialog } from './AiSettingsDialog';
import {
  listAiProviders,
  getAiConfig,
  setAiConfig,
  getAiImageConfig,
  setAiImageConfig,
  getAiTtsConfig,
  setAiTtsConfig,
  getAiMusicConfig,
  setAiMusicConfig,
  getAiVideoConfig,
  setAiVideoConfig,
  listAiLogs,
  getAiLogPath,
} from '../lib/ai-ipc';

vi.mock('../lib/ai-ipc', () => ({
  listAiProviders: vi.fn(),
  getAiConfig: vi.fn(),
  setAiConfig: vi.fn(),
  getAiImageConfig: vi.fn(),
  setAiImageConfig: vi.fn(),
  getAiTtsConfig: vi.fn(),
  setAiTtsConfig: vi.fn(),
  getAiMusicConfig: vi.fn(),
  setAiMusicConfig: vi.fn(),
  getAiVideoConfig: vi.fn(),
  setAiVideoConfig: vi.fn(),
  validateAiConfig: vi.fn(),
  listAiLogs: vi.fn(),
  clearAiLogs: vi.fn(),
  getAiLogPath: vi.fn(),
}));

const mockCatalog = {
  chat: [
    { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o', models: ['gpt-4o', 'gpt-4o-mini'], requiresApiKey: true, needsBaseUrl: false },
  ],
  image: [
    { value: 'openai', label: 'OpenAI', defaultModel: 'dall-e-3', models: ['dall-e-3', 'dall-e-2'], requiresApiKey: true, needsBaseUrl: false },
  ],
  tts: [
    { value: 'openai', label: 'OpenAI', defaultModel: 'tts-1', models: ['tts-1', 'tts-1-hd'], requiresApiKey: true, needsBaseUrl: false },
  ],
  music: [
    { value: 'suno', label: 'Suno', defaultModel: 'chirp-v3', models: ['chirp-v3'], requiresApiKey: true, needsBaseUrl: false },
  ],
  video: [
    { value: 'minimax', label: 'MiniMax', defaultModel: 'video-01', models: ['video-01'], requiresApiKey: true, needsBaseUrl: false },
  ],
};

const mockChatConfig = { provider: 'openai', model: 'gpt-4o', api_key: 'test-key', base_url: '' };
const mockImageConfig = { provider: 'openai', model: 'dall-e-3', api_key: 'test-key', base_url: '' };
const mockTtsConfig = { provider: 'openai', model: 'tts-1,tts-1-hd', api_key: 'test-key', base_url: '' };
const mockMusicConfig = { provider: 'suno', model: 'chirp-v3', api_key: 'test-key', base_url: '' };
const mockVideoConfig = { provider: 'minimax', model: 'video-01', api_key: 'test-key', base_url: '' };

describe('AiSettingsDialog TTS configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAiProviders).mockResolvedValue(mockCatalog as any);
    vi.mocked(getAiConfig).mockResolvedValue(mockChatConfig);
    vi.mocked(getAiImageConfig).mockResolvedValue(mockImageConfig);
    vi.mocked(getAiTtsConfig).mockResolvedValue(mockTtsConfig);
    vi.mocked(getAiMusicConfig).mockResolvedValue(mockMusicConfig);
    vi.mocked(getAiVideoConfig).mockResolvedValue(mockVideoConfig);
    vi.mocked(listAiLogs).mockResolvedValue([]);
    vi.mocked(getAiLogPath).mockResolvedValue('/tmp/ai.log');
    vi.mocked(setAiConfig).mockResolvedValue();
    vi.mocked(setAiImageConfig).mockResolvedValue();
    vi.mocked(setAiTtsConfig).mockResolvedValue();
    vi.mocked(setAiMusicConfig).mockResolvedValue();
    vi.mocked(setAiVideoConfig).mockResolvedValue();
  });

  it('restricts TTS to single model and normalizes comma-separated list on save', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaved = vi.fn();

    render(<AiSettingsDialog open={true} onClose={onClose} onSaved={onSaved} />);

    await waitFor(() => {
      expect(screen.getByText('AI 设置')).toBeInTheDocument();
    });

    // Switch to TTS tab
    const ttsTab = screen.getByRole('button', { name: /音频/ });
    await user.click(ttsTab);

    // Should NOT have "填入相关模型" button in TTS tab (since it's singleModel)
    expect(screen.queryByRole('button', { name: '填入相关模型' })).not.toBeInTheDocument();

    // The model select dropdown should be rendered and normalized to "tts-1"
    const modelSelect = screen.getByLabelText('选择模型');
    expect(modelSelect).toHaveValue('tts-1');

    // Click Save
    const saveButton = screen.getByRole('button', { name: '保存 AI 配置' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(setAiTtsConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'tts-1',
        }),
      );
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('preserves existing OpenAI music configs and custom endpoints', async () => {
    vi.mocked(listAiProviders).mockResolvedValue({
      ...mockCatalog,
      music: [
        { value: 'openai', label: 'OpenAI 兼容', defaultModel: 'music-1', models: ['music-1'], requiresApiKey: true, needsBaseUrl: true },
        { value: 'custom', label: '自定义', defaultModel: 'music-1', models: ['music-1'], requiresApiKey: false, needsBaseUrl: true },
      ],
    } as any);
    vi.mocked(getAiMusicConfig).mockResolvedValue({
      provider: 'openai',
      model: 'music-1',
      api_key: 'custom-music-key',
      base_url: 'https://proxy.example.com/v1',
    });

    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaved = vi.fn();

    render(<AiSettingsDialog open={true} onClose={onClose} onSaved={onSaved} />);

    await waitFor(() => {
      expect(screen.getByText('AI 设置')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: '保存 AI 配置' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(setAiMusicConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'music-1',
          api_key: 'custom-music-key',
          base_url: 'https://proxy.example.com/v1',
        }),
      );
    });
  });

  it('preserves api_key and base_url when normalizing unknown music provider', async () => {
    vi.mocked(listAiProviders).mockResolvedValue({
      ...mockCatalog,
      music: [
        { value: 'custom', label: '自定义', defaultModel: 'music-1', models: ['music-1'], requiresApiKey: false, needsBaseUrl: true },
      ],
    } as any);
    vi.mocked(getAiMusicConfig).mockResolvedValue({
      provider: 'retired-provider',
      model: 'music-1',
      api_key: 'existing-key',
      base_url: 'https://my-music-endpoint.test/v1',
    });

    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaved = vi.fn();

    render(<AiSettingsDialog open={true} onClose={onClose} onSaved={onSaved} />);

    await waitFor(() => {
      expect(screen.getByText('AI 设置')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: '保存 AI 配置' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(setAiMusicConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'custom',
          model: 'music-1',
          api_key: 'existing-key',
          base_url: 'https://my-music-endpoint.test/v1',
        }),
      );
    });
  });
});
