import { createHashRouter } from 'react-router';

export const router = createHashRouter([
  {
    path: '/',
    lazy: async () => {
      const { ProjectHome } = await import('@/app/components/project/ProjectHome');
      return { Component: ProjectHome };
    },
  },
  {
    path: '/flow/:projectId',
    lazy: async () => {
      const { FlowBoardPage } = await import('@/app/components/flow/FlowBoardPage');
      return { Component: FlowBoardPage };
    },
  },
  {
    path: '/editor/:projectId',
    lazy: async () => {
      const { StoryEditor } = await import('@/app/components/editor/StoryEditor');
      return { Component: StoryEditor };
    },
  },
  {
    path: '/editor/:projectId/assets',
    lazy: async () => {
      const { AssetManager } = await import('@/app/components/assets/AssetManager');
      return { Component: AssetManager };
    },
  },
]);
