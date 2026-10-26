# 项目生命周期

## 项目首页(`ProjectHome`)

- **新建项目**:名称、描述、目标目录 → 初始化 WebGAL 目录结构。
- **打开项目**:选择文件夹,编辑器自动识别配置。
- **列表与组织**:网格/列表视图、收藏(星标)、侧栏「最近编辑」、全文搜索(名称/描述/路径)、每项目场景数。
- **回收站**:软删除 + 恢复;永久删除仅移除元数据,不删磁盘文件。

## 项目元数据(`ProjectMetadataDialog`)

导出前可编辑:
- **梗概(synopsis)**:世界观备注(供 AI 使用);
- **描述(description)**:面向玩家的简介;
- **版本(version)**:默认 0.1.0;
- **标签(tags)**:类型/关键词;
- **更新说明(release notes)**:本版本变更;
- **封面图**(可选)。

## 导出 / 发布

- 选择输出目录,可选同时打包 zip;
- 实时导出状态(进度、警告、错误),失败可重试;
- 导出会校验项目并给出告警/错误;
- 产物含 `game/` 文件夹 + `project-metadata.json`;记住上次导出目录。

## 相关源码
- `apps/desktop/src/app/components/ProjectHome.tsx`、`apps/desktop/src/app/components/ProjectMetadataDialog.tsx`
- `apps/desktop/src/app/lib/webgal-ipc.ts`(项目创建/打开、导出、元数据)
