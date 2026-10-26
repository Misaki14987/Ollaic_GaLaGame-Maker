# 场景关系与导航

可视化项目的**场景关系图**并在场景间导航,同时管理场景的增删改与章节/大纲元数据。

## 子文档

| 文档 | 内容 |
|------|------|
| [场景关系图](./relationship-graph.md) | 不可拖动的 BFS 布局关系图、连线、点击切换、全屏视图、右键菜单 |
| [场景管理](./scene-management.md) | 场景创建/删除/重命名、章节/大纲元数据、场景管理面板 |

## 总览

- **关系图组件**:`SceneGraph.tsx`(纯 SVG、自动布局、不可拖动);内嵌于左侧 `SceneWorldlinePanel`,也有全屏 `FullScreenWorldline`。
- **数据来源**:`sceneLinkMap` 由各场景的 `changeScene`/`callScene`/`choose` 目标解析而来(`extractSceneLinks`)。
- **场景 = 一个 `.txt` 文件**;场景名(文件名)即唯一标识。

## 相关源码
- `apps/desktop/src/app/components/SceneGraph.tsx`
- `apps/desktop/src/app/components/StoryEditor.tsx`(`SceneWorldlinePanel` / `FullScreenWorldline`)
- `apps/desktop/src/app/components/SceneManagerPanel.tsx`
- `apps/desktop/src/app/lib/webgal-types.ts`(`SceneLink`、`extractSceneLinks`)、`apps/desktop/src/app/lib/webgal-ipc.ts`(场景增删改、头部元数据)
