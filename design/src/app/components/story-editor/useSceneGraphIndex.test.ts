import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WebGalNode } from '../../lib/webgal-types';
import { useSceneGraphIndex } from './useSceneGraphIndex';

describe('useSceneGraphIndex', () => {
  it('tracks unsaved links for the current scene', () => {
    const { result, rerender } = renderHook(({ nodes }) => useSceneGraphIndex('start.txt', nodes), {
      initialProps: { nodes: [] as WebGalNode[] },
    });
    const changed = [
      {
        id: '1',
        type: 'changeScene',
        content: 'chapter_02.txt',
        targetScene: 'chapter_02.txt',
      },
    ] as WebGalNode[];

    act(() => rerender({ nodes: changed }));
    expect(result.current.links['start.txt']).toEqual([
      { kind: 'change', target: 'chapter_02.txt' },
    ]);
  });
});
