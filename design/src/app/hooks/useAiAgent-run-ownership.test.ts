import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { useAiAgent } from './useAiAgent';

vi.mock('../lib/ai-ipc', () => ({
  aiChatTurn: vi.fn(),
  aiChatCancel: vi.fn(async () => true),
  appendAiAgentTrace: vi.fn(async () => {}),
  getAiConfig: vi.fn(async () => ({ provider: 'custom', model: 'tools', api_key: '', base_url: 'https://example.test' })),
  getAiProviderCapability: vi.fn(async () => ({ chatTools: true, streamingCancellation: true })),
}));
vi.mock('../lib/ai-tools', () => ({ getTool: vi.fn(), toolDefs: vi.fn(() => [{ name: 'edit_scene' }]) }));
vi.mock('../lib/assets-ipc', () => ({ listAllAssets: vi.fn(async () => []) }));
vi.mock('../lib/project-memory', () => ({
  emptyProjectMemory: () => ({ worldSetting: '', writingStyle: '', userPreferences: '', updatedAt: '' }),
  readProjectMemory: vi.fn(async () => null), saveProjectMemory: vi.fn(async () => {}),
}));
vi.mock('../lib/character-ipc', () => ({ createCharacter: vi.fn(), updateCharacter: vi.fn(), deleteCharacter: vi.fn() }));
vi.mock('../lib/webgal-ipc', () => ({
  parseScene: vi.fn(async () => []), serializeScene: vi.fn(async () => ''), getScenePath: vi.fn(),
  readFileText: vi.fn(), listScenes: vi.fn(async () => []), saveScene: vi.fn(), createScene: vi.fn(),
  deleteScene: vi.fn(), updateSceneHeader: vi.fn(), sceneDisplayName: (file: string) => file,
}));

import { aiChatCancel, aiChatTurn } from '../lib/ai-ipc';
import { getTool } from '../lib/ai-tools';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function params() {
  return {
    projectId: 'ownership', projectPath: '/tmp/project', currentSceneName: 'start.txt', sceneHeaders: {},
    nodes: [], selectedNode: null, scriptSource: '', dirty: false, characters: [],
    setNodes: vi.fn(), setScriptSource: vi.fn(), setDirty: vi.fn(), setSaveStatus: vi.fn(),
    setSelectedNode: vi.fn(), setShowScript: vi.fn(), pushHistory: vi.fn(),
  };
}

describe('conversational run ownership', () => {
  beforeEach(() => {
    vi.mocked(aiChatTurn).mockReset();
    vi.mocked(aiChatCancel).mockReset().mockResolvedValue(true);
    vi.mocked(getTool).mockReset();
    localStorage.clear();
  });

  it('stop revokes a late provider response before tools, messages, or preview side effects', async () => {
    const turn = deferred<{ text: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>();
    vi.mocked(aiChatTurn).mockReturnValueOnce(turn.promise);
    const { result } = renderHook(() => useAiAgent(params()), { wrapper: MemoryRouter });

    let request!: Promise<void>;
    act(() => { request = result.current.sendPrompt('run A'); });
    await waitFor(() => expect(aiChatTurn).toHaveBeenCalledTimes(1));
    const runA = vi.mocked(aiChatTurn).mock.calls[0][0];

    act(() => result.current.stop());
    expect(aiChatCancel).toHaveBeenCalledWith(runA);
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => turn.resolve({ text: '', toolCalls: [{ id: 'late', name: 'edit_scene', arguments: {} }] }));
    await act(async () => { await request; });
    await waitFor(() => expect(result.current.busy).toBe(false));

    expect(getTool).not.toHaveBeenCalled();
    expect(result.current.pendingChangeSet).toBeNull();
    expect(result.current.messages.find((message) => message.role === 'assistant' && message.id !== '1')?.stopped).toBe(true);
  });

  it('repeated stop is idempotent', async () => {
    const turn = deferred<{ text: string; toolCalls: [] }>();
    vi.mocked(aiChatTurn).mockReturnValueOnce(turn.promise);
    const { result } = renderHook(() => useAiAgent(params()), { wrapper: MemoryRouter });
    act(() => { void result.current.sendPrompt('run'); });
    await waitFor(() => expect(aiChatTurn).toHaveBeenCalledTimes(1));
    act(() => { result.current.stop(); result.current.stop(); });
    expect(aiChatCancel).toHaveBeenCalledTimes(1);
    act(() => turn.resolve({ text: 'late', toolCalls: [] }));
  });
});
