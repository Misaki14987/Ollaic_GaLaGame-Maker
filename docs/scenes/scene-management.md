# 场景管理

## 增删改

- **创建**:新建场景文件(自动命名或自定义名),初始化为空场景。
- **删除**:从磁盘删除场景文件;禁止删除当前打开的场景。
- **重命名**:重命名场景文件并更新引用。

入口:全屏关系图工具栏的「新建」、节点右键菜单的「重命名/删除」,以及场景管理面板。

## 章节 / 大纲元数据

每个场景可设置 **章节(chapter)** 与 **大纲(outline)**,存储在场景文件开头的注释行中:
- 解析 / 序列化:`parseSceneHeader` / `serializeSceneHeader` / `updateSceneHeader`(保留正文)。
- 章节名用于关系图节点标签、场景下拉选择器的显示名等。

## 场景管理面板

`SceneManagerPanel`:滑出式面板,按文件名排序列出所有场景,可逐个编辑章节/大纲。

## 相关源码
- `apps/desktop/src/app/lib/webgal-ipc.ts`(`createScene` / `deleteScene` / `renameScene` / `listScenes`、`SceneHeader`、头部解析/序列化、`sceneDisplayName`)
- `apps/desktop/src/app/components/SceneManagerPanel.tsx`
- `apps/desktop/src/app/components/StoryEditor.tsx`(`handleNewScene` / `handleDeleteScene` / `handleRenameScene`)
