import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { useAiAgent } from './useAiAgent';

vi.mock('../lib/ai-ipc', () => ({
  aiChatTurn: vi.fn(),
  appendAiAgentTrace: vi.fn(async () => {}),
  getAiConfig: vi.fn(async () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: '', baseUrl: '' })),
}));

vi.mock('../lib/ai-tools', () => ({
  getTool: vi.fn(),
  toolDefs: vi.fn(() => []),
}));

vi.mock('../lib/assets-ipc', () => ({
  listAllAssets: vi.fn(async () => []),
}));

vi.mock('../lib/project-memory', () => ({
  emptyProjectMemory: () => ({ worldSetting: '', writingStyle: '', userPreferences: '', updatedAt: '' }),
  readProjectMemory: vi.fn(async () => null),
  saveProjectMemory: vi.fn(async () => {}),
}));

vi.mock('../lib/character-ipc', () => ({
  createCharacter: vi.fn(async () => ({ id: 'c-new' })),
  updateCharacter: vi.fn(async () => {}),
  deleteCharacter: vi.fn(async () => {}),
}));

vi.mock('../lib/webgal-ipc', () => ({
  parseScene: vi.fn(async (src: string) =>
    String(src ?? '').split('\n').map((content, index) => ({
      id: `n${index}`, type: 'comment', content, flags: [], position: { x: 0, y: 0 }, connections: [],
    })),
  ),
  serializeScene: vi.fn(async (nodes: Array<{ content?: string }>) =>
    (nodes ?? []).map((n) => n.content ?? '').join('\n'),
  ),
  getScenePath: vi.fn(async (_p: string, n: string) => `/tmp/${n}`),
  readFileText: vi.fn(async () => ''),
  listScenes: vi.fn(async () => []),
  saveScene: vi.fn(async () => {}),
  createScene: vi.fn(async () => '/tmp/new.txt'),
  updateSceneHeader: vi.fn(async () => {}),
  sceneDisplayName: (f: string) => f,
}));

import { aiChatTurn } from '../lib/ai-ipc';
import { getTool } from '../lib/ai-tools';
import type { AiTurnResult } from '../lib/ai-ipc';

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'p1',
    projectPath: '/tmp/proj',
    currentSceneName: 'start.txt',
    sceneHeaders: {},
    nodes: [],
    selectedNode: null,
    scriptSource: '',
    dirty: false,
    characters: [],
    setNodes: vi.fn(),
    setScriptSource: vi.fn(),
    setDirty: vi.fn(),
    setSaveStatus: vi.fn(),
    setSelectedNode: vi.fn(),
    setShowScript: vi.fn(),
    pushHistory: vi.fn(),
    ...overrides,
  };
}

describe('AI pending preview isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiChatTurn)
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'c1', name: 'edit_scene', arguments: {} }],
      } as unknown as AiTurnResult)
      .mockResolvedValue({ text: 'done', toolCalls: [] } as unknown as AiTurnResult);
    vi.mocked(getTool).mockReturnValue({
      name: 'edit_scene',
      kind: 'write',
      schema: {},
      run: async () => ({
        tool: 'edit_scene',
        file: 'start.txt',
        patches: [{ type: 'insert', file: 'start.txt', afterLine: 'end', text: 'B:world;' }],
      }),
    } as never);
  });

  it('does not write AI preview content into the saveable buffer (no setNodes/setScriptSource/setDirty)', async () => {
    const params = makeParams();
    const { result } = renderHook(() => useAiAgent(params), { wrapper: MemoryRouter });

    await act(async () => {
      await result.current.sendPrompt('请修改场景');
    });

    await waitFor(() => {
      expect(result.current.pendingChangeSet).toBeTruthy();
    });

    expect(params.setNodes).not.toHaveBeenCalled();
    expect(params.setScriptSource).not.toHaveBeenCalled();
    expect(params.setDirty).not.toHaveBeenCalled();
  });
});
