import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSceneDocument } from '@/app/components/story-editor/useSceneDocument';

describe('useSceneDocument', () => {
  it('keeps edits and undo history behind the document interface', () => {
    const { result } = renderHook(() => useSceneDocument());

    act(() => result.current.insertNode('narrator', 0));
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.dirty).toBe(true);
    expect(result.current.selectedNode?.type).toBe('narrator');

    act(() => result.current.undo());
    expect(result.current.nodes).toEqual([]);
    expect(result.current.selectedNode).toBeNull();
  });
});
