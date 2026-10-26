# 命令类型参考

编辑器支持以下 WebGAL 命令类型(`WebGalCommandType`),均可在详情面板编辑。中文标签来自 `commandLabels`,分类来自 `commandCategories`(`lib/webgal-types.ts`)。

## 剧情
| 类型 | 标签 | 说明 |
|------|------|------|
| `dialogue` | 对话 | 角色对白,含配音与表情 |
| `narrator` | 旁白 | 旁白/叙述文本 |
| `intro` | 黑屏文字 | 黑屏过场文字(多行) |
| `choose` | 选项分支 | 分支选项,含目标场景/标签 |

## 场景控制
| 类型 | 标签 | 说明 |
|------|------|------|
| `changeBg` | 切换背景 | 切换背景图 |
| `changeFigure` | 切换立绘 | 切换角色立绘（指令流摘要现已优化为显示具体角色名/别名，而非底层文件名） |
| `miniAvatar` | 小头像 | 小头像图 |
| `changeScene` | 切换场景 | 永久切换到目标场景 |
| `callScene` | 调用场景 | 调用场景,执行完返回 |
| `end` | 结束 | 结束当前场景 |

## 音频
| 类型 | 标签 | 说明 |
|------|------|------|
| `bgm` | 背景音乐 | 背景音乐,含音量 |
| `playEffect` | 音效 | 播放音效 |
| `playVideo` | 播放视频 | 播放视频 |

## 控制流
| 类型 | 标签 | 说明 |
|------|------|------|
| `label` | 标签 | 定义跳转标签 |
| `jumpLabel` | 跳转标签 | 跳到场景内某标签 |
| `setVar` | 设置变量 | 设置变量值 |
| `setTextbox` | 文本框控制 | 显示/隐藏文本框 |
| `getUserInput` | 用户输入 | 提示用户输入文本 |
| `comment` | 注释 | 行内注释 |

## 特效
| 类型 | 标签 | 说明 |
|------|------|------|
| `setAnimation` | 设置动画 | 应用动画,可选目标 |
| `setTransform` | 设置变换 | 基于 JSON 的变换(位置/缩放等) |
| `unlockCg` | 解锁CG | 解锁 CG 入画廊,可设显示名 |
| `unlockBgm` | 解锁BGM | 解锁音乐入鉴赏,可设显示名 |

新建项目会默认在 `game/config.txt` 写入 `Enable_Appreciation:true;`,用于让 WebGAL 标题页显示鉴赏入口。实际可鉴赏内容仍需要剧情执行对应解锁指令,例如 `unlockCg:event_cg.webp -name=雨夜;`。CG 图片按 WebGAL 约定从 `game/background/` 读取。

> 分类同时用于「插入节点」下拉的分组与卡片标签着色。具体字段编辑见 [脚本与节点编辑](./node-editing.md)。

## 相关源码
- `apps/desktop/src/app/lib/webgal-types.ts`(`WebGalCommandType`、`commandLabels`、`commandCategories`、`categoryLabels`)
- `apps/desktop/src/app/components/DetailPanel.tsx`(`renderTypeFields` 各 case)
- `apps/desktop/src/app/lib/node-display.ts`(图标/着色/摘要)
