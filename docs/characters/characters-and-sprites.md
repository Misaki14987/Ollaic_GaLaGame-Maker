# 角色与立绘

## 角色档案

`CharacterPanel` 支持创建、编辑、删除角色,每个角色包含:
- **基础**:名称、别名、性别、年龄、性格、立场(正义/混沌/中立/邪恶)。
- **设定**:背景描述、关键词标签(可检索)、默认配音、音色。
- **关系**:目标角色 + 关系类型 + 描述。
- **配色主题**:UI 强调色(hex 或 CSS 变量)。
- **对话风格指南**:用于 AI 生成。
- **备注**。

## 立绘 / 表情系统

每个角色可挂多张立绘(sprite),每张含:
- **表情标签**(如「微笑」「悲伤」「惊讶」);
- **文件引用**(`game/figure/` 下 PNG);
- **生成提示**(AI 生成时的自定义指令)。

此外:
- **主体参考图**:角色设定稿 / 三视图(正/侧/背)。
- **参考图上传**:每角色最多 5 张,存于 `game/config/references/{characterId}/`。
- **立绘库**:所有已上传立绘的缩略图网格,可将任一立绘设为主体参考。

### 常用表情
默认、微笑、悲伤、惊讶、愤怒、害羞、思考、严肃;支持自定义任意标签,并带情绪着色与建议姿态/起手提示词。

## AI 立绘生成
- 生成主体参考(设定稿);
- 生成单个表情变体;
- 一键批量生成全部表情变体。

生成进度内联展示,生成后自动保存并关联到角色。详见 [AI 素材与立绘生成](../ai/media-generation.md)。

## 用量提示
显示每个角色/立绘被哪些场景与对话引用,删除未使用立绘时给出用量警告。

## 相关源码
- `apps/desktop/src/app/components/CharacterPanel.tsx`
- `apps/desktop/src/app/lib/character-types.ts`(角色与 sprite 模型、`buildSpritePrompt`)
- `apps/desktop/src/app/lib/character-ipc.ts`、`apps/desktop/src/app/lib/character-editing.ts`
