# 编辑 Agent 上下文与记忆 · 模块详细设计

> 补充 [`editor-agent-context.md`](./editor-agent-context.md) 的模块级设计:接口签名、数据结构、落点文件与开源借鉴映射。切片编号 S1–S6 沿用基线文档 §10。原则:每个模块只借鉴开源项目的**机制**,不引入其运行时;全部落地为 Rust/TypeScript 纯函数 + 现有存储通道。

## 0. 模块总览与借鉴映射

| 模块 | 切片 | 职责 | 借鉴来源 → 采纳的机制 | 明确不抄 |
|---|---|---|---|---|
| M1 记忆存储 | 已实现+微调 | 正史单一写入通道 | Mem0 单一 `add()` API;Zep 来源链 → `originRef` | 向量化、跨客户端 MCP |
| M2 上下文组装器 | S1/S4 | 分层组装 + 预算 + 裁剪 | Letta memory blocks(块级预算与溢出告警);Anthropic 组合顺序(稳定前缀) | 记忆进模型参数 |
| M3 全剧概览 | S1 | 正史投影为注入文本与工具 | Claude Code「启动加载 + 按需取」;LangGraph 状态投影 | — |
| M4 邻域解析 | S1 | 确定性剧情邻域 | Zep「先过滤范围,再谈相似」→ 只做图邻接 | 相似度检索 |
| M5 素材检索与绑定注入 | S2 | 语义化素材上下文 | Anthropic contextual retrieval(带上下文返回);Zep provenance → 引用场景随素材返回 | embedding 索引 |
| M6 会话纪要 | S5 | compaction | Anthropic compaction(保关键细节的摘要);Letta sleep-time compute;Mem0 `infer=False`(文档直存,不做事实抽取) | 纪要混入正史 |
| M7 候选与偏好 | S6 | 记忆写回治理 | Mem0 四操作裁决(ADD/UPDATE/DELETE/NOOP);LangMem 后台抽取(取舍:后台而非同步) | 同步抽取拖慢交互 |
| M8 Flow 回写 | S3 | V2 产物入正史 | Mem0 按 identity upsert;Zep provenance → `originRef` 幂等回写 | 覆盖用户改动 |

## 1. M1 记忆存储(已实现,一处扩展)

落点 `apps/desktop/src-tauri/src/webgal/memory.rs`,现有条目模型、项目锁、乐观锁、写入去重全部保留。唯一扩展:

```rust
pub struct MemoryEntry {
    // ...现有字段不变...
    /// 回写来源指针,格式 "flow:<runId>:<kind>"(如 flow:r-42:worldbook)。
    /// 用户手动条目为 None。serde default,向后兼容。
    #[serde(default)]
    pub origin_ref: Option<String>,
}
```

`origin_ref` 服务两个消费方:M8 回写按它 upsert(而非按内容去重,避免"用户改过 → 内容不同 → 重复添加");管理页展示条目来源链(哪次 Flow 写入)。借鉴对应关系:`origin_ref` = Mem0 更新阶段的 identity 判定 + Zep 的 fact↔source 关联,但只存一个指针字符串,不建关联表。

管理页建议区(S6)数据**不进** `entries`:新增同文件内的 `suggestions: Vec<MemorySuggestion>`(`{ id, category, content, reason, createdAt }`),确认后转正为条目并从建议区移除。理由:ADR 0049 要求建议先展示后生效,候选不进 prompt,分字段比 `enabled=false` 语义更干净。

## 2. M2 上下文组装器(S1 骨架,S4 收拢预算)

新建 `apps/desktop/src/app/lib/agent-context.ts`,纯函数 + 单测(与 `story-agent.ts` 惯例一致);`useAiAgent.ts` 的 `buildAgentSystemContext`/`buildLegacySystemContext` 改为调用它。

```ts
export type BlockId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface ContextBudget { totalTokens: number; blocks: Record<BlockId, number>; }

export interface ContextInput {
  sceneName: string; sceneHeaders: Record<string, SceneHeader>; scriptSource: string;
  memory: ProjectMemory | null; characters: Character[];
  assets: AssetInfo[]; assetMetadata: AssetMetadata | null;
  uploads: AiUpload[]; attachedIds: string[];
  history: ChatMessage[]; digest: SessionDigest | null;
  neighborhood: SceneNeighborhood | null;   // M4 产物
  lastChangeSummary: string | null;          // M7 产物
}

export interface AssembledBlock { id: BlockId; text: string; estTokens: number; trimmed: boolean; }

export interface TrimEvent { blockId: BlockId; droppedChars: number; reason: string; }

export function assembleContext(input: ContextInput, budget: ContextBudget): {
  system: string; blocks: AssembledBlock[]; trims: TrimEvent[]; estTokens: number;
}
```

组装顺序固定 L0→L1→L2→L3→L4(稳定前缀在前);`estimateTokens` 中文按 ≈1.6 字/token、ASCII 按 ≈4 字/token 估。超预算裁剪顺序 L4→L2 邻域→L3 早期,L0/L1 永不裁;每次裁剪产出 `TrimEvent`,追加进 `useAiAgent.ts` 的 `AiAgentTrace`(新增 `trims` 字段,随现有 `ai-agent-trace.jsonl` 落盘)。

借鉴细节:Letta 的块是「有名字、有大小、超限告警、可自编辑」的一等公民——这里每个 L 层就是一个 block,块级 `estTokens`/`trimmed` 进 trace,而不是只看总量;Anthropic cookbook 的组合顺序(memory 写文件 / compaction 压历史 / 清旧工具结果)对应我们的 L1 永注入、L3 纪要化、历史截断丢工具结果,三者正交并存。

## 3. M3 全剧概览(S1)

同一个 builder 服务两个出口(注入 L1 + 工具返回),保证两者永不漂移:

```ts
// agent-context.ts
export function buildStoryOverview(input: Pick<ContextInput,
  'sceneHeaders' | 'memory' | 'characters'>): {
  worldEntries: MemoryEntry[];      // world 类启用条目(含术语)
  scenes: Array<{ file: string; chapter?: string; outline?: string }>; // 按章节分组排序
  characterRoster: Array<{ id: string; name: string; aliases: string[] }>;
  otherEntries: MemoryEntry[];      // 其余分类启用条目
}
```

注入端把返回值渲染为文本;工具端在 `ai-tools.ts` 新增只读工具 `read_story_overview`(零参数),直接返回该结构,供多轮循环在修改落盘后重取场景卡。数据全部来自 hook 已持有状态(`sceneHeaders`/`memory`/`characters`),无新增 IPC、无新存储——借鉴 Claude Code 的分工:**稳定项目事实启动即注入,细节走工具按需取**。

## 4. M4 剧情邻域解析(S1)

新建 `apps/desktop/src/app/lib/scene-links.ts`:把 `SceneGraph.tsx` 里现成的跳转解析抽到 lib 共享(组件与组装器同源,避免两份正则)。

```ts
export function parseSceneOutlinks(script: string): string[];          // changeScene/choose 目标
export function buildNeighborhood(
  current: string, script: string,
  readScene: (file: string) => Promise<string>,                        // 复用 staging 已有通道
  sceneIndex: Map<string, { chapter?: string }>,                       // 反向入边由缓存索引得出
): Promise<SceneNeighborhood | null>;
// SceneNeighborhood { inEdges: Array<{ file: string; tail: string }>;
//                    outEdges: Array<{ file: string; head: string }> }  // 各 ~15 行
```

入边需要全项目扫描,做两层缓存:以项目路径 + 场景文件 mtime 为键存 `Map<file, outlinks[]>`,变更集应用后失效。借鉴对应:Zep 的检索哲学是「先按任务范围过滤,再排序」——VN 的任务范围就是图邻接(跳入/跳出当前场景的地方),确定性解析即过滤,不需要任何相似度。

## 5. M5 素材检索与绑定注入(S2)

两处改动,数据源都是现有存储:

**search_assets 语义化**(`ai-tools.ts`):`run` 内追加拉取一次 `assetMetadata`(前端已有 `asset-metadata.ts` 封装),匹配范围从文件名扩展到 `descriptions`/`tags`/`aliases`(大小写不敏感子串);排序 权重:标签命中 > 别名 > 描述 > 文件名;返回每条附 `tags`/`description`(截断 80 字)/`usedIn`(来自 `AssetMetadata.references` 的引用场景列表)。`usedIn` 就是 Anthropic contextual retrieval 的「返回块带上下文」与 Zep provenance 的组合:模型看到的不是一个裸文件名,而是「它是什么、被哪些场景用过」。

**L4 绑定注入**(`agent-context.ts`):新增 `parseSceneAssetBindings(script: string): Array<{ category: string; file: string; figure?: { character: string; emotion: string }>`,解析 `changeBg`/`bgm`/`changeFigure`/`playEffect` 行——正则与 `change-set.ts` 的 `extractPatchAssetRefs` 同族,抽到共享模块避免漂移。让模型改场景前先看见「现状绑定了什么」。

## 6. M6 会话纪要(S5)

借 Anthropic compaction 的内容策略 + Letta sleep-time 的触发时机 + Mem0 `infer=False` 的定性(整段摘要,不做事实抽取):

- **触发**:会话消息数 > 8 且 Agent 空闲(`status === 'idle'`)时,`useAiAgent` 调度后台任务;同会话已有进行中的纪要任务则跳过。
- **生成**:新 Tauri 命令 `ai_summarize_session(projectPath, messages) -> SessionDigest`,后端复用 `complete_agent_text` 单轮调用;提示词要求输出结构化 JSON:`{ decisions: string[], facts: string[], todos: string[] }`(沿用 router 的解析/校验/一次修复模式)。
- **存储**:`SessionDigest` 作为特殊消息存入 session 头部(`useChatSession.ts` 的 `ChatMessage` 增加 `kind: 'digest'` 变体),被摘要的原始消息保留但标记 `archived`,注入时只取 digest + 最近 8 轮。存储上限从「40 条消息」改为「40 条未归档消息」。
- **注入**:M2 的 L3 块渲染 digest + 最近轮次。
- **降级**:生成失败沿用现状 500 字截断;纪要只存在于会话层,**永不写入正史**——进入 `game/ai-memory.json` 的事实必须经 M7 的显式确认路径。

## 7. M7 记忆候选与偏好捕获(S6)

- **修改后提醒**:变更集 accepted 时记录 `{ summary, sceneFile }`;下一轮组装在 L0 尾部追加一段事件提示(经 M2 传入 `lastChangeSummary`):「上次已接受的修改:…;若引入了应长期保留的设定、事实或风格决策,先 `read_memory`,再按 判断新增(ADD)/扩充既有条目(UPDATE)/删除过时条目(DELETE)/不值得记(NOOP) 维护」。借鉴 Mem0 的四操作裁决词表;工具本身(add/update/delete_memory)不变——最小修复。
- **偏好信号**:useAiAgent 在 `rejected`/重跑/修改后重跑时追加信号记录 `{ type, sceneFile, instruction摘要, ts }`,存编辑器状态目录(不进 `game/`,不是可玩内容)。同一场景同类信号 ≥2 次 → 生成 `MemorySuggestion` 进管理页建议区(经 M1 扩展)。确认前绝不注入 prompt。
- 取舍对应既有调研结论(LangMem 同步 vs 后台):抽取一律后台/下一轮,不在当前响应路径里做。

## 8. M8 Flow 正史回写(S3)

Rust 侧新文件 `apps/desktop/src-tauri/src/pipeline/memory_writeback.rs`,由 step 提交钩子触发(`output_commit.rs` 成功路径后异步执行):

1. **worldbook 拆条**:按空行/小节标题切块,每块 ≤ 1200 字,以 `origin_ref = "flow:<runId>:worldbook:<i>"` upsert 为 `world` 条目;
2. **glossary**:整表渲染为一条 `world` 条目(超 4000 字时按字母序分片),`origin_ref = "...:glossary"`;
3. **章节大纲**:Outline 产物中每个 `scenePlan.outline` 对应写入场景 header 的 outline 字段(复用现有场景元数据保存路径);场景尚不存在则跳过,由后续 Scene step 创建后补写;
4. **幂等**:upsert 以 `origin_ref` 为键——同 run 重跑覆盖自家条目,绝不触碰用户改动过的条目(用户改过的条目 `origin_ref` 保留,内容已属于用户)。

借鉴:Mem0 更新阶段的「先找 identity 再决定操作」+ Zep 的来源关联,收敛成一个指针字段;对比 10-21 报告的三层表结构(sources/memories/derived_index),这是其最小可用子集——`origin_ref` 即 provenance,场景卡即 derived index,暂不需要更多。

## 9. 一轮请求时序

```
用户输入
  └→ useAiAgent: 组装 ContextInput
       ├→ M3 buildStoryOverview ─────────→ L1
       ├→ M4 buildNeighborhood ──────────→ L2
       ├→ M5 parseSceneAssetBindings ────→ L4
       ├→ M7 lastChangeSummary ──────────→ L0 尾部提示
       └→ M2 assembleContext(预算/裁剪/TrimEvent→trace) → system prompt(稳定前缀)
            └→ ai_chat_turn(Rust 工具循环)
                 ├→ 读工具: read_story_overview(M3)/read_scene/search_assets(M5)/read_memory
                 └→ 写工具 → change-set → 用户确认 → game/ 文件
                      └→ accepted 事件
                           ├→ M7: 下一轮记忆提醒 + 偏好信号
                           └→ 空闲时 M6: ai_summarize_session → digest → L3(下轮)
```

## 10. 测试与验收

- 纯函数单测:`agent-context.ts`(预算裁剪顺序、token 估算、TrimEvent)、`scene-links.ts`(choose/changeScene 解析、缓存失效)、M3 builder(注入与工具返回一致)、M5 排序与 `usedIn`。
- Rust 单测:M1 `origin_ref` upsert 幂等、用户条目不被覆盖;M8 worldbook 拆条边界(空输入、超长块、重跑幂等)。
- 链路回归:沿用 `agent-harness editor` 离线重放,新增带 L1 注入的 cassette 用例;trace 断言「修改第 3 章场景时 0 次试探性 `read_scene`」(基线文档 §10 S1 验收)。
- 降级路径:M6 失败回退截断、M4 无入边时 L2 退化为仅当前场景、M8 失败不阻塞 step 提交(仅记 warning)。

## 相关源码

- 基线设计:[`editor-agent-context.md`](./editor-agent-context.md)(分层模型、切片、ADR 候选)
- 改造点:`apps/desktop/src/app/hooks/useAiAgent.ts`、`apps/desktop/src/app/lib/ai-tools.ts`、`apps/desktop/src/app/lib/story-agent.ts`(逻辑迁入 `agent-context.ts`)
- 新建:`apps/desktop/src/app/lib/agent-context.ts`、`apps/desktop/src/app/lib/scene-links.ts`、`apps/desktop/src-tauri/src/pipeline/memory_writeback.rs`
- 复用:`apps/desktop/src/app/lib/change-set.ts`(资产引用正则)、`apps/desktop/src/app/components/SceneGraph.tsx`(跳转解析抽lib)、`apps/desktop/src/app/lib/asset-metadata.ts`、`apps/desktop/src-tauri/src/webgal/memory.rs`、`apps/desktop/src-tauri/src/ai/commands.rs`(`complete_agent_text`)
