# 脚本源码模式

除可视化指令流外,可切换到**原始 WebGAL 脚本**直接编辑文本。

## 功能

- **源码编辑器**:顶栏切换 `showScript` 后,中间区域变为 textarea,直接编辑当前场景的 WebGAL 文本。
- **应用更改**:`handleApplyScript` 解析编辑后的文本,更新内部节点树并标记场景为「已修改(dirty)」。
- **解析 / 序列化**:节点 ↔ WebGAL 文本由后端完成(`parseScene` / `serializeScene`),保证两种视图一致。
- **场景文件 I/O**:从磁盘读写 `.txt` 场景(`loadScene` / `saveScene`),含场景头部元数据解析。
- **字数与阅读时长**:页脚显示脚本字节长度与预估阅读时长(约 380 字 ≈ 1 分钟)。

## 相关源码
- `apps/desktop/src/app/components/StoryEditor.tsx`(`showScript`、`handleApplyScript`)
- `apps/desktop/src/app/lib/webgal-ipc.ts`(`parseScene` / `serializeScene` / `loadScene` / `saveScene` / `listScenes`)
