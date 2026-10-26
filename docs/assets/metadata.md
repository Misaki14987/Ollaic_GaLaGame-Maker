# 元数据与别名

素材除文件本身外,还可附带元数据(按项目持久化),提升可读性与 AI 生成质量。

## 内容

- **别名(alias)**:为素材起易读显示名,与文件名分离;UI 中优先展示别名。
- **描述(description)**:素材的多行备注。
- **参考素材**:为素材上传次级研究资料(参考图/音频),存于 `game/config/references/`。
- **场景卡(scene card)**:背景生成模板,含标题、提示词、目标文件名(stem)、AI 风格 / 负面提示。
- **语音卡(voice card)**:从对话节点自动发现,含角色、情绪、TTS 提示、目标文件名。

> 元数据支持软删除(记录已删卡片列表),便于追踪与恢复。

## 相关源码
- `apps/desktop/src/app/lib/asset-metadata.ts`(`aliasesForCategory`、`emptyAssetMetadata`、场景卡/语音卡模型)
- `apps/desktop/src/app/components/AssetManager.tsx`(元数据编辑入口)
