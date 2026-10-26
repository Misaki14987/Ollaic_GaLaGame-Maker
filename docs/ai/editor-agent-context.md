# 编辑 Agent 上下文与记忆系统设计

> 设计基线,尚未实现。目标:用户每次发起修改时,编辑 Agent 无需多轮试探就能基于**整个剧情**(世界观、已写章节、角色正史、素材现状)和**用户写作偏好**产出最好的剧本修改与素材绑定,同时单轮上下文成本可控。与 V2 生产 Flow 的上下文问题(`v2-agent-pipeline.md` 第 7 节「动态裁剪留待扩展」)同源,本文只覆盖编辑 Agent 一侧;组装器设计为后续 Flow 复用预留。

## 1. 目标与非目标

**目标**

1. 修改任意场景时,Agent 上下文天然包含:全剧世界观与术语、全部场景卡(章节/大纲)、用户记忆条目、当前场景全文、相邻场景衔接文本、当前场景已绑定素材。
2. 素材建议基于语义(tags/descriptions/aliases)而非文件名巧合,引用真实文件名。
3. 用户的写作风格、创作约束、剧情决策通过项目记忆进入每一轮,并由修改行为产生新的记忆建议(ADR 0048/0049)。
4. 单轮注入有预算上限;静态前缀稳定以命中 provider 前缀缓存;重活(纪要、摘要)走便宜模型离线任务。

**非目标**

- 向量检索、embedding、知识图谱(受控词表 + 场景卡已够;见 `reports/Agent 记忆系统 设计调研.md`)。
- 隐藏式自动记忆:一切新增记忆条目经工具落盘、在管理页可见可编辑。
- 改动 V2 生产 Flow 的 DAG 编排,或把编辑器记忆搬进 `.ollaic`。
- 跨项目、云端记忆。

## 2. 现状与差距

| 能力 | 现状 | 差距 |
|---|---|---|
| 全剧概览 | 无。system prompt 只注入当前场景全文(`useAiAgent.ts:464`),其余场景靠 `list_scenes`/`read_scene` 工具试探 | 模型不知道「整个剧情」有什么,不知道该去查哪个场景;修改第 3 章时对第 1–2 章伏笔、人物关系无感知 |
| 世界观/术语 | `StoryPlan.memory`(worldbook + glossary)只服务生产 Flow,存 `.ollaic/plan.json` | 编辑 Agent 完全不读;两套记忆互不相通 |
| 项目记忆 | 6 分类条目全量注入(`buildMemoryContext`,`project-memory.ts:74`);管理页 + `add/update/delete_memory` 工具齐备 | 条目只来自对话中模型手动维护;无剧情事实的系统性来源;与 `sessions-and-memory.md` 记录的截断策略配合但无预算概念 |
| 会话历史 | 最近 8 轮 + 助手消息 500 字截断(`story-agent.ts:145`);会话存 localStorage 约 40 条 | 早期创作决策(改人名、伏笔约定)被静默丢弃,长会话反复重申 |
| 素材上下文 | `search_assets` 按文件名子串匹配(`ai-tools.ts:249`);legacy 模式注入每类前 24 个文件名 | `AssetMetadata` 已有 `descriptions/tags/aliases`(`assets/commands.rs:31`)但未暴露给检索;当前场景已绑定的背景/立绘/BGM 不在上下文里,模型看不到现状,谈不上「填最好的」 |
| 偏好 | 有 `style`/`preference`/`constraint` 分类 | 无捕获机制,ADR 0049(行为信号 → 建议 → 确认)未落地 |

## 3. 上下文分层模型

每轮 system prompt 按固定顺序组装,稳定内容在前(命中 provider 前缀缓存),易变内容在后:

| 层 | 内容 | 来源 | 变化频率 | 预算(默认) |
|---|---|---|---|---|
| L0 指令 | 角色、工具说明、方法论、WebGAL 格式规则(现状文本) | 静态 | 几乎不变 | ~4k tok |
| L1 全剧正史 | 世界观条目、术语表、全部场景卡(按章节分组)、角色名单、全部启用记忆条目 | 记忆 + sceneHeaders | 记忆/大纲变更时 | ~6k tok |
| L2 当前与邻域 | 当前场景全文(行号)、入边场景尾部 / 出边场景头部各 K 行 | 场景文件 + 引用解析 | 每次脚本编辑 | ~8k tok |
| L3 会话 | 编辑纪要(更早轮次)+ 最近 8 轮原文 | session + 纪要任务 | 每轮 | ~4k tok |
| L4 素材与参考 | 当前场景已绑定素材清单、附件清单(现状 `buildUploadContext`) | 脚本解析 + uploads | 每次脚本编辑 | ~2k tok |

总预算默认 ~24k tok(可配置)。中文按 ≈1.6 字符/token 估算。超预算时按 **L4 → L2 邻域 → L3 早期**顺序裁剪;L0/L1 不裁(L1 超预算时场景卡只保留当前章节 + 相邻章节,世界观/记忆条目永不裁)。每次裁剪在 agent trace(`ai-agent-trace.jsonl`)记 warning,可观测。

实现:新模块 `apps/desktop/src/app/lib/agent-context.ts`,纯函数组装器 + 单测(沿用 `story-agent.ts` 惯例);`useAiAgent.ts` 改为调用它。暂不做 Rust 服务端化(见 §11)。

## 4. 全剧正史(L1)

### 4.1 正史单一来源

**项目记忆(`game/ai-memory.json`)是编辑 Agent 读取的唯一记忆来源**;V2 生产产物通过回写进入它,而不是让编辑 Agent 再读一份 `plan.json`:

- Flow 的 Memory / Outline / Character step 提交成功后,Rust 端把产物回写进项目记忆(source=agent):worldbook 按小节拆成 `world` 类条目(单条仍受 4000 字上限约束,拆条而非放宽);glossary 并入术语条目;章节大纲写入对应场景的 `outline` 字段(复用 `set_scene_header` 通道,见 §4.2)。
- 回写走既有条目写入通道(项目锁 + `expectedUpdatedAt`),已存在的同内容条目不重复添加(现状 `add_project_memory_entry` 已去重)。
- 用户在管理页对回写条目的修改是终态;Flow 重跑**不得**覆盖用户改过的条目(按内容去重已保证;重写场景另议)。

### 4.2 场景卡

场景卡 = `sceneHeaders` 已有的 `chapter` + `outline` 字段(`webgal-ipc.ts:48`),由用户和 Agent 通过 `set_scene_header` 共同维护,**不新增存储**。全剧概览按章节分组列出所有场景卡;缺 outline 的场景显示文件名,Agent 在对话中被问到相关剧情时先用 `set_scene_header` 补大纲再继续(工具已存在,补一句提示词即可)。

### 4.3 注入内容与工具

每轮 L1 注入:① `world` 类条目 + 术语条目;② 全部场景卡;③ 其余启用记忆条目(`character`/`plot`/`style`/`preference`/`constraint`);④ 角色名单(id + name + 别名,卡片仍走 `get_character`)。

新增只读工具 `read_story_overview`:返回同样的四段内容,供多轮循环中在修改落盘后重新拉取场景卡。首轮靠注入,后续靠工具。

## 5. 剧情邻域(L2)

- 当前场景全文带行号注入(现状保留)。
- 衔接上下文由**确定性解析**得到,不靠模型猜:解析当前场景的 `choose`/`changeScene` 得到出边目标;用既有引用扫描(参考 `AssetUsage.references` 的实现方式)得到入边来源。入边场景注入**尾部 K 行**(≈15)、出边场景注入**头部 K 行**,保证选项跳入/跳出处的语气和状态衔接。
- 同章节其他场景只保留场景卡(§4.2),需要正文再 `read_scene`(已有分页)。

## 6. 会话与编辑纪要(L3)

- 最近 8 轮原文保留(现状)。
- 更早轮次合并为一条**编辑纪要**(条目式:已定决策 / 新增设定 / 待办),由便宜模型在空闲时离线生成,存入 session 消息数组头部,跨应用重启生效。生成走后端单轮调用,失败降级为现状的 500 字截断。
- 纪要取代「按条数截断」成为 L3 的主要形态:长会话成本从 O(轮数) 降为 O(1),且早期决策不再丢失。

## 7. 素材上下文(L4)

「填写最好的素材」需要模型看见两件事:**库里有**(语义可查)、**现状是什么**(当前绑定)。

- `search_assets` 升级:匹配范围从文件名扩展到 `AssetMetadata` 的 `descriptions`/`tags`/`aliases`(数据已存在,`read_asset_metadata` 命令已可达);返回增加 title/tags/描述摘要,分页保留。
- 新注入**当前场景已绑定素材清单**:从当前脚本解析 `changeBg`/`bgm`/`changeFigure`/`playEffect` 行,列出 类别:文件名(figure 附带 character/emotion)。模型改场景前先看到现状,决定沿用还是替换。
- `plan_assets` 规划卡(`scene_cards`)与缺失素材流程保持现状(`change-preview.md`)。

## 8. 记忆写入侧与偏好捕获

- **修改后记忆提醒**:变更集 accepted 后,下一轮注入一条系统提示,附变更摘要;提示 Agent「若本次修改引入了应长期保留的设定、事实或风格决策,先 `read_memory` 再 `add/update_memory`」。现有方法论第 6 条(`useAiAgent.ts:442`)只有静态提醒,这里变成事件驱动且带具体内容。合规于 ADR 0049:模型提议 → 工具落盘 → 管理页可见可改。
- **偏好建议(最后落地)**:记录用户对 step 输出/变更集的重跑、修改后重跑、拒绝事件(带当轮指令摘要);同类信号重复出现时生成建议条目,进管理页**建议区**(不注入 prompt),用户确认后转为启用条目。示例:同一场景两次要求「放慢节奏」→ 建议新增 `preference`:「本作对白节奏偏慢,少用短句堆叠」。
- 不做:自动写入剧情事实、记忆条目 scope 字段(全剧/单场景/单角色)——分类 + 正文已够,避免过度设计。

## 9. 成本优化汇总

| 手段 | 节省点 | 备注 |
|---|---|---|
| 稳定前缀(L0+L1 在前) | 每轮命中 provider 前缀缓存,重复内容不再全价计费 | 前提:前缀逐字节稳定,组装顺序固定 |
| `read_story_overview` | 一次调用代替多轮试探性 `list_scenes`/`read_scene` | 省工具往返轮次,也省延迟 |
| 编辑纪要 | L3 从 O(轮数×500 字) 降为 O(1) | 便宜模型离线生成,不占交互延迟 |
| 预算上限 + 裁剪顺序 | 防单轮撑爆窗口,坏情况可预期 | 裁剪写 trace |
| 便宜模型离线任务 | 纪要、回写摘要不占用交互模型 | 复用现有单模型配置,后续接 §11 的模型路由 |

## 10. 落地切片

| 切片 | 内容 | 验收 |
|---|---|---|
| S1 全剧概览 | L1 注入(场景卡 + 记忆条目 + 角色名单)+ `read_story_overview` 工具 | 打开第 3 章直接下修改指令,trace 中 0 次试探性 `read_scene`,修改引用了第 1–2 章既有事实 |
| S2 素材语义化 | `search_assets` 匹配/返回 metadata;注入当前场景绑定清单 | 素材建议优先命中 tags/descriptions;修改场景时模型能复述现状绑定 |
| S3 正史回写 | Flow 产物回写项目记忆(§4.1) | 跑完 Flow 后管理页出现 world/glossary 条目,source=agent,用户可改可停用 |
| S4 预算化组装 | `agent-context.ts` 收拢组装 + 预算 + trace 裁剪记录 | 人为压小预算时,裁剪顺序符合 §3 且 trace 可见 |
| S5 编辑纪要 | 纪要生成、存储、注入、降级 | 超过 8 轮的长会话中,早期决策仍能影响后续修改 |
| S6 偏好捕获 | 修改后记忆提醒 + 建议区(§8) | 重复行为信号产生建议条目,确认前不进入 prompt |

S1 不依赖新存储,纯前端注入,收益最大;S2 需要后端把 metadata 接进检索;S3 跨端但走既有条目通道;S4 在前三片稳定后收拢;S5/S6 独立。S1+S2 合并验收用户目标:「每次修改都能根据整个剧情生成最好的剧本,填写最好的素材」。

## 11. 需要 ADR / 开放问题

- **ADR 候选 1**:编辑 Agent 正史以项目记忆为单一来源,V2 StoryPlan 产物回写(方向性决策,落地 S3 前定稿)。
- **ADR 候选 2**:场景卡以 scene header `outline` 为准,不为场景卡新增存储。
- 上下文组装是否下沉 Rust(为 V2 Flow 复用同一组装器):S4 之后再评估;当前编辑 Agent 的数据前端均已持有,服务端化收益只有跨端一致,先不做。
- 便宜模型路由:纪要/摘要任务当前与交互共用 `AiConfig.model`;若需要,扩为按任务的模型覆盖,与 V2 的按 Agent 模型路由一并设计。

## 12. 相关源码

> 模块级详细设计(接口签名、借鉴映射、时序与测试)见 [`editor-agent-context-modules.md`](./editor-agent-context-modules.md)。

- `apps/desktop/src/app/hooks/useAiAgent.ts` — system prompt 组装与 Agent 循环(改造点)
- `apps/desktop/src/app/lib/story-agent.ts` — 现有上下文构建与截断(部分逻辑迁入 `agent-context.ts`)
- `apps/desktop/src/app/lib/ai-tools.ts` — 工具定义(`search_assets` 升级、`read_story_overview` 新增)
- `apps/desktop/src/app/lib/project-memory.ts` — 记忆读取与 `buildMemoryContext`
- `apps/desktop/src/app/lib/webgal-ipc.ts` — `SceneHeader`(chapter/outline,场景卡数据源)
- `apps/desktop/src-tauri/src/webgal/memory.rs` — 项目记忆条目存储与回写通道
- `apps/desktop/src-tauri/src/assets/commands.rs` — `AssetMetadata` descriptions/tags/aliases
- `apps/desktop/src-tauri/src/ai/commands.rs` — 后端单轮调用(纪要等离线任务入口)
- `docs/ai/sessions-and-memory.md` — 现状文档,本设计落地后同步更新
