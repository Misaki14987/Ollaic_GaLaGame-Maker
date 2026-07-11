# 资产任务队列

P2 的 AssetTaskQueue 在 Agent Flow 完成 SceneScript 后执行，把 AssetPlanner 的背景、立绘、BGM、音效计划与已编译 Scene 中尚未配音的对白合并为统一队列。

## 状态与恢复

- 队列保存于 `.ollaic/assets/queue.json`，状态为 `pending → running / retrying → succeeded / failed`。
- 每项生成失败后最多自动重试 3 次，即一次初始尝试加三次重试。应用重启后跳过已成功任务，继续未完成任务。
- 每次候选产物先写入 `.ollaic/artifacts/assets/<taskId>/<attempt>.<ext>`；只有绑定成功后才晋升到 `game/` 正式素材目录。失败记录和候选 Artifact 保留用于预览、清理或后续手动处理。
- 每次 attempt 和已绑定任务都会持久化是否使用本地占位素材；崩溃恢复后，Flow Step 仍会保留降级提示。

## 调度与绑定

- 默认并发上限为 2 个图片、4 个 TTS、1 个音乐任务，三类任务分别限流。
- 背景、BGM、音效和立绘通过 WebGAL parser / serializer 写入 Scene；TTS 按 Scene 对白序号写入语音引用。
- 立绘同时更新 `game/config/characters.json`，所有生成素材同步写入素材元数据。
- FlowBoard 的 `assetQueue` Step 显示完成比例、失败数、prompt、目标 Scene / 角色和重试记录；候选 Artifact 可直接预览、删除或手动提升并绑定为正式素材。
- 同一 Scene 的多个同类任务各自保留命令；同一任务重跑时只替换它此前绑定的文件。
- 同一 Run 的上游 Scene 重编后，已成功资产会直接用正式文件重新绑定，补回被重编擦除的背景、立绘、音频和 TTS 引用；正式文件缺失时才进入生成重试。
- Stop 在每次正式绑定前检查取消状态，未绑定的候选继续留作 Flow Artifact。运行中的 scheduler 与 Artifact 删除/提升共用写锁，避免队列快照互相覆盖。

测试使用 12 个 Scene × 8 条对白的确定性生成器验证 96 条 TTS 的调度与绑定，并单独验证 2 / 4 / 1 并发峰值。真实供应商是否满足 30 分钟门槛仍取决于模型服务时延和家庭网络。

## 相关源码

- `src-tauri/src/asset_queue/` — 队列持久化、调度、Artifact 与自动绑定
- `src-tauri/src/ai/commands.rs` — 队列复用的图片、TTS、音乐生成入口
- `design/src/app/components/FlowBoard.tsx`、`FlowStepInspector.tsx` — 进度与任务详情
