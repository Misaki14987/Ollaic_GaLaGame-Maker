import { describe, expect, it } from 'vitest';
import { detectConflicts, type PendingChangeSet } from './change-set';
import { emptyProjectMemory } from './project-memory';
import type { Character } from './character-types';

function makeSceneEdit(file: string, beforeContent: string, afterContent: string) {
  return {
    kind: 'scene',
    file,
    isCurrent: false,
    beforeContent,
    afterContent,
    beforeNodes: [],
    afterNodes: [],
    diff: [],
    summary: '',
    warnings: [],
  } as const;
}

function makeCharacterEdit(id: string, before: Character) {
  return {
    kind: 'character',
    id,
    name: before.name,
    before,
    after: { ...before, description: 'changed' },
    changedFields: ['description'],
  } as const;
}

function makeMemoryEdit(before: ReturnType<typeof emptyProjectMemory>) {
  return {
    kind: 'memory',
    before,
    after: { ...before, worldSetting: 'changed' },
    changedFields: ['worldSetting'],
  } as const;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    currentSceneName: 'start.txt',
    currentScriptSource: 'A:start;',
    readSceneContent: async () => 'A:start;',
    getCharacter: () => undefined,
    memory: emptyProjectMemory(),
    ...overrides,
  };
}

const BASE_CHARACTER: Character = {
  id: 'c1',
  name: '小明',
  aliases: [],
  description: 'original',
  personality: '',
  stance: '',
  keywords: [],
  dialogueStyle: '',
  gender: '',
  age: '',
  sprites: [],
  relations: [],
  notes: '',
};

describe('detectConflicts', () => {
  it('returns empty when nothing changed since staging', async () => {
    const set = {
      edits: [makeSceneEdit('other.txt', 'A:other;', 'A:other; B:new;')],
    } as unknown as PendingChangeSet;
    const ctx = makeCtx({ readSceneContent: async () => 'A:other;' });
    await expect(detectConflicts(set, ctx)).resolves.toEqual([]);
  });

  it('detects a non-current scene changed since staging', async () => {
    const set = {
      edits: [makeSceneEdit('other.txt', 'A:other;', 'A:other; B:new;')],
    } as unknown as PendingChangeSet;
    const ctx = makeCtx({ readSceneContent: async () => 'USER EDITED;' });
    await expect(detectConflicts(set, ctx)).resolves.toEqual(['other.txt']);
  });

  it('detects the current scene edited during preview', async () => {
    const set = {
      edits: [makeSceneEdit('start.txt', 'A:start;', 'A:start; B:new;')],
    } as unknown as PendingChangeSet;
    const ctx = makeCtx({ currentScriptSource: 'USER TYPED;' });
    await expect(detectConflicts(set, ctx)).resolves.toEqual(['start.txt']);
  });

  it('does not flag the current scene when it matches before or after content', async () => {
    const set = {
      edits: [makeSceneEdit('start.txt', 'A:start;', 'A:start; B:new;')],
    } as unknown as PendingChangeSet;
    // buffer still equals beforeContent (user made no edits)
    await expect(detectConflicts(set, makeCtx({ currentScriptSource: 'A:start;' }))).resolves.toEqual([]);
    // buffer equals afterContent (preview already reflected)
    await expect(detectConflicts(set, makeCtx({ currentScriptSource: 'A:start; B:new;' }))).resolves.toEqual([]);
  });

  it('detects a character changed since staging', async () => {
    const set = {
      edits: [makeCharacterEdit('c1', BASE_CHARACTER)],
    } as unknown as PendingChangeSet;
    const changed = { ...BASE_CHARACTER, description: 'user edited' };
    const ctx = makeCtx({ getCharacter: (id: string) => (id === 'c1' ? changed : undefined) });
    await expect(detectConflicts(set, ctx)).resolves.toEqual(['c1']);
  });

  it('does not flag an unchanged character', async () => {
    const set = {
      edits: [makeCharacterEdit('c1', BASE_CHARACTER)],
    } as unknown as PendingChangeSet;
    const ctx = makeCtx({ getCharacter: (id: string) => (id === 'c1' ? BASE_CHARACTER : undefined) });
    await expect(detectConflicts(set, ctx)).resolves.toEqual([]);
  });

  it('detects project memory changed since staging', async () => {
    const before = emptyProjectMemory();
    const set = {
      edits: [makeMemoryEdit(before)],
    } as unknown as PendingChangeSet;
    const ctx = makeCtx({ memory: { ...before, worldSetting: 'user edited' } });
    await expect(detectConflicts(set, ctx)).resolves.toEqual(['memory']);
  });
});
