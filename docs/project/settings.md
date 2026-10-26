# 应用设置

`AppSettingsDialog` 管理编辑器级偏好与运行时。

## 编辑器设置

- **默认项目目录**:新建项目的落地目录。
- **预览模板目录**:覆盖 WebGAL_Template,使用自定义运行时 UI。
- **自动保存间隔**:关闭 / 15s / 30s / 60s / 2min。
- **语言**:简体中文(英文待加入)。
- **主题**:暗色(亮色待加入)。
- 链接到独立的 [AI 设置](../ai/providers.md)。

## 运行时管理

- 下载/安装 WebGAL 运行时,显示状态(已安装 ✓ / 未安装)、版本与路径,可重新下载。

## 存储

设置持久化到 localStorage(键 `webgal-app-settings`,`saveAppSettings()`)。

## 主题系统(补充)

`styles/theme.css` 为 Material 风格的 token 主题(色彩/容器/排版令牌),角色配色与情绪色亦由 token 定义。仅作了解,详见该文件。

## 相关源码
- `apps/desktop/src/app/components/AppSettingsDialog.tsx`
- `apps/desktop/src/app/lib/webgal-ipc.ts`(`getRuntimeInfo` / `installRuntime`)
- `apps/desktop/src/styles/theme.css`
