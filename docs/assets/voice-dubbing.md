# 配音清单与管理

提供一个全局的配音进度看板（`VoiceDubbingPanel.tsx`），用于管理项目中所有台词对话的语音生成与绑定。它位于资源管理（AssetManager）中的“语音”类别下。

## 功能特性

- **分类与过滤**：
  - 支持“按场景（Scene）”或“按角色（Character）”进行分组展示。
  - 支持“全部”、“待配音（Pending）”、“已配音（Done）”三种视图过滤，帮助创作者快速定位需要配音的句子。
- **批量与单句 AI TTS 生成**：
  - 用户可勾选多条待配音语句，或直接点击单条语句的生成按钮。
  - 自动调用后台配置的 TTS 供应商及模型（基于 `generateBatchTts`）。
  - 提供实时进度条反馈（包括生成中、成功、出错等状态）。
- **本地音频导入**：
  - 如果无需 AI 生成，也可以手动点击导入按钮，选择本地磁盘中的音频文件上传，自动完成台词卡槽的音频绑定。

## 数据流向与落盘

配音卡片在用户于编辑器中保存场景（对话节点）时自动生成对应的占位槽。当 TTS 生成或本地音频导入完成后：
1. 音频文件被写入项目 `game/vocal/` 目录下。
2. 通过 IPC 接口 `fillVoiceCard`，自动关联资源，此后在游戏中对应的角色对白即会播放该语音。

## 相关源码
- `apps/desktop/src/app/components/VoiceDubbingPanel.tsx`（主面板）
- `apps/desktop/src/app/components/AssetManager.tsx`（嵌入宿主）
- `apps/desktop/src/app/lib/assets-ipc.ts`（获取配音卡、填充、删除）
- `apps/desktop/src/app/lib/ai-ipc.ts`（批量 TTS 任务与进度监听）
