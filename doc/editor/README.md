# 编辑器

编辑器是 Ollaic 的核心:以**指令流(命令卡片)**的形式可视化编辑 WebGAL 脚本,支持节点增删改、拖拽排序、复制粘贴、搜索、撤销/重做,也可切换到**原始脚本源码**直接编辑。

## 子文档

| 文档 | 内容 |
|------|------|
| [脚本与节点编辑](./node-editing.md) | 指令流、节点插入/删除/复制/剪切/粘贴/拖拽、选中详情面板、搜索 |
| [命令类型参考](./command-types.md) | 支持的全部 WebGAL 命令类型及中文标签、分类 |
| [脚本源码模式](./script-source.md) | 原始 WebGAL 文本编辑、解析/序列化、场景文件 I/O |
| [撤销与快照](./history-and-snapshots.md) | 撤销/重做、整项目快照与恢复 |

## 总览

- **主组件**:`StoryEditor.tsx`(指令流 `ScriptCommandStream` / 卡片 `ScriptCommandCard` / 详情面板 `DetailPanel`)。
- **数据模型**:`WebGalNode`(一条指令)、`WebGalCommandType`(命令类型联合)。
- **两种视图**:指令流(默认)与脚本源码 textarea(`showScript`)。
- **顶栏 / 侧栏**:保存、导入/导出、快照、源码切换、搜索、项目元数据、应用设置;视图切换(脚本 / 场景关系)。
- **性能时间线 / 页脚**:可视化演出节点(背景/音乐/立绘/动画/音效)与字数、预估阅读时长。

## 相关源码
- `design/src/app/components/StoryEditor.tsx`
- `design/src/app/components/DetailPanel.tsx`
- `design/src/app/components/PerformanceTimeline.tsx`
- `design/src/app/lib/webgal-types.ts`、`design/src/app/lib/webgal-ipc.ts`、`design/src/app/lib/scene-editing.ts`、`design/src/app/lib/editor-patch.ts`
