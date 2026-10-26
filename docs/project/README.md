# 项目与运行预览

项目级能力:创建/打开/导入/导出 WebGAL 项目、运行预览(本地运行时 + 跳转调试),以及应用设置。

## 子文档

| 文档 | 内容 |
|------|------|
| [项目生命周期](./project-lifecycle.md) | 项目首页、创建/打开、收藏/回收站、元数据、导出/发布 |
| [运行预览](./runtime-preview.md) | 本地 WebGAL 运行时、跳转到指定句、调试协议、运行时安装 |
| [应用设置](./settings.md) | 默认目录、预览模板目录、自动保存、运行时管理、语言/主题 |

## 总览

- **项目首页**:`ProjectHome.tsx`,项目列表、收藏、回收站、最近编辑。
- **元数据与导出**:`ProjectMetadataDialog.tsx` + `webgal-ipc.ts`,导出 `game/` + `project-metadata.json`,可选打包 zip。
- **运行预览**:本地 WebGAL 运行时,支持从编辑器跳转到指定对白。
- **设置**:`AppSettingsDialog.tsx`。

## 相关源码
- `apps/desktop/src/app/components/ProjectHome.tsx`、`apps/desktop/src/app/components/ProjectMetadataDialog.tsx`、`apps/desktop/src/app/components/AppSettingsDialog.tsx`
- `apps/desktop/src/app/lib/webgal-ipc.ts`(项目/导出/快照/运行时)
