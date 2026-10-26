# 角色立绘

管理作品中的角色及其立绘(figure):角色档案、立绘/表情系统、参考图,以及 AI 立绘生成。

## 子文档

| 文档 | 内容 |
|------|------|
| [角色与立绘](./characters-and-sprites.md) | 角色属性/关系/配色/风格、立绘表情系统、参考图、AI 生成、用量提示 |

## 总览

- **角色面板**:`CharacterPanel.tsx`,增删改角色及其完整档案。
- **数据模型**:`lib/character-types.ts`(角色、立绘 sprite、表情、配色)。
- 角色与对话节点关联:对话的角色名、配色、立绘表情在编辑器中联动(见 [脚本与节点编辑](../editor/node-editing.md))。
- 立绘可手动上传,也可由 AI 生成(见 [AI 素材与立绘生成](../ai/media-generation.md))。

## 相关源码
- `apps/desktop/src/app/components/CharacterPanel.tsx`
- `apps/desktop/src/app/lib/character-types.ts`、`apps/desktop/src/app/lib/character-ipc.ts`、`apps/desktop/src/app/lib/character-editing.ts`
