# V2 — 端到端 Agent 形态

> 把 Ollaic 从「AI 辅助编辑器」重塑为「一次性生成 + Flow 可视化」的端到端 Agent。本文档是 V2 的产品与架构基线；每个落地切片落地后再补对应 `doc/<模块>/` 子文档。

> 与 `WEBGAL_PRD.zh-CN.md` 中 V2 增强的关系：本文属于**重塑产品形态**的另一条主线（AGENT V2），与 PRD 5.3 中列举的可视化分支增强、TTS、模板市场等增强项**并行推进**。

---

## 1. 一句话目标

用户输入提示词（题材、风格、长度、女主数、语言）→ 系统自动跑完一条**可视化 Flow** → 输出一份可玩 WebGAL 项目。过程中每个 step 可**暂停、干预、重跑**，任意时刻 Flow 画布真实反映执行状态。

---

## 2. 三个范式转变

| 当前 0.1（辅助编辑器） | V2（端到端 Agent） |
|---|---|
| 多轮对话循环（`MAX_TURNS=6`） | 一次性 DAG 编排，无人值守 |
| 散落 change set + 聊天消息 | **StoryPlan IR** 单一事实源，可断点续跑 |
| 单体 LLM + 工具循环 | 多 Agent 分工（Worldbuilder / Plotter / Dialogist / AssetPlanner / Reviewer） |
| 用户从 AssetManager 挑资产 | **AssetTaskQueue** 自动生成 + 自动绑定 + 自动验收 |
| 聊天气泡显示状态 | **Flow 画布**为主视图 |

---

## 3. 八个新增模块

### 3.1 Pipeline Orchestrator ⭐ 编排核心

**作用**：声明式定义生成 Flow 的 DAG，调度 step 执行，处理依赖 / 重试 / 跳过 / 暂停 / 续跑，并作为事件源推送给前端。

**目标源码**：
- `src-tauri/src/pipeline/pipeline.rs` — 核心 scheduler
- `src-tauri/src/pipeline/pipeline_dsl.rs` — Step DSL 解析
- `src-tauri/src/pipeline/pipeline_state.rs` — 状态机 + 持久化（`.ollaic/pipeline/<runId>.json`）
- `src-tauri/src/pipeline/pipeline_events.rs` — 事件总线（`tokio::broadcast`）

**新增 IPC**：`pipeline_start / pipeline_pause / pipeline_resume / pipeline_retry_step / pipeline_event`（订阅）

**用户可见**：Flow 画布上的「运行 / 暂停 / 从 step K 重跑 / 跳过 step」。

**验收**：每 step 的开始 / 结束 / 失败 < 1 s 推到前端；应用异常关闭后能从最后未完 step 续跑，不重做已完成部分。

---

### 3.2 StoryPlan IR ⭐ 领域核心

**作用**：项目级「故事规格」中间表示，所有 step 的输入输出都落在同一结构上，可序列化、可校验、可视化。

**目标位置**：`.ollaic/plan.json`，由 `src-tauri/src/story_plan/` 维护。

**字段草案**：

```ts
interface StoryPlan {
  version: 1;
  prompt: string;                  // 用户原始提示词
  synopsis: string;
  memory: {
    worldbook: string;             // 长文世界观（Worldbuilder 产出）
    glossary: Record<string, string>; // 专有名词表
  };
  chapters: ChapterPlan[];         // 章节
  characters: Character[];         // 角色卡
  branches: BranchGraph;           // 分支图
  assetPlan: AssetTask[];          // 资产任务（详情见 3.5）
  pipelineRuns: PipelineRunSummary[]; // 历史运行
}
```

**验收**：Pipeline 启动前 schema 校验；任意 step 失败时能从 IR 还原完整上下文。

---

### 3.3 Multi-Agent（多角色分工）

**作用**：单 LLM 写不出 5w–10w 字一致性作品。按职责拆分，每个 Agent 独立 system prompt / 上下文裁剪 / 模型路由。

**目标源码**：
- `src-tauri/src/agents/worldbuilder.rs`
- `src-tauri/src/agents/plotter.rs`
- `src-tauri/src/agents/dialogist.rs`
- `src-tauri/src/agents/asset_planner.rs`
- `src-tauri/src/agents/reviewer.rs`
- `src-tauri/src/agents/router.rs` — 按 step 路由到合适 Agent + 模型

**模型路由建议**：

| Agent | 偏好 | 备选 |
|---|---|---|
| Worldbuilder | 长上下文 | 中等价即可 |
| Plotter | 结构化输出强 | — |
| Dialogist | 创意强 | 中等价即可 |
| AssetPlanner | 结构化输出 | 视觉语言可外接 |
| Reviewer | 长上下文 + 强推理 | — |

**验收**：5 个 Agent 都能被 pipeline 独立调用；新增 Agent 无需改 Orchestrator。

---

### 3.4 Flow 可视化画布 ⭐⭐ 用户最大改变

**作用**：取代当前 ProjectHome / StoryEditor 的首屏地位，所有交互从这张画布发出。

**目标组件**：
- `design/src/app/components/FlowBoard.tsx` — 画布主视图（候选 React Flow 或自研轻量方案）
- `design/src/app/components/StepNode.tsx` — 节点渲染（status / 名称 / 进度 / 摘要 / cost 角标）
- `design/src/app/components/FlowToolbar.tsx` — 运行 / 暂停 / 重跑 / 跳转
- `design/src/app/components/StepDetailDrawer.tsx` — 点击节点看 prompt / 输出 / 日志 / diff / 重试
- `design/src/app/components/FlowEventStream.tsx` — 实时事件流（订阅 `pipeline_events`）
- 复用并升级现有的 `MiniNodeCard.tsx` / `PerformanceTimeline.tsx`

#### 节点类型 / 状态

| 类型 | 触发来源 | 状态机 |
|---|---|---|
| Plan | 用户提示 → 概述 | `pending · running · succeeded · failed · awaiting-input` |
| Memory | 长文世界观 | 同上 |
| Outline | 章节 / 分支 | 同上 |
| Character | 单个角色 | 可并行 |
| Scene | 单个场景脚本 | 可并行，依赖前置 chapter |
| Asset | 资产队列父节点 | 内部折叠列表 |
| Lint | 静态检查 | 单次 |
| Review | AI 自审 | 单次 |
| Export | 打包 | 单次 |
| UserInput | 暂停等用户补充 | 触发点 |

**用户行为清单**：

| 操作 | 反馈 |
|---|---|
| 点节点 | 抽屉显示 step 详情、prompt、输出摘要、cost、duration |
| 拖节点 | 改变 DAG 依赖（仅 pending 内生效，已运行节点只读） |
| 右键节点 | 重跑 / 跳过 / 编辑 prompt 重跑 / 跳到目标 scene / 资产 |
| 画布操作 | 滚轮缩放、拖动平移 |
| 工具栏 | 运行 / 暂停 / 停止 / 续跑 / 时间倒带 |
| 顶栏 | 当前 IR 摘要、总体进度、token 总成本、当前 runId |

**与现有 UI 的关系**：

| 现状 | V2 中去向 |
|---|---|
| `StoryEditor.tsx` | 双击 Scene 节点打开 |
| `AssetManager.tsx` | 双击 Asset 节点打开 |
| `CharacterPanel.tsx` | 双击 Character 节点打开 |
| `SceneGraph.tsx` | 删除或并入 FlowBoard 的迷你预览 |
| `ProjectHome.tsx` | 替换为 FlowBoard 的项目首屏 |

**验收**：10w step 不卡顿（虚拟化）；暂停 / 续跑 / 单步重跑均可用；节点状态与真实 step 同步延迟 ≤ 1 s。

---

### 3.5 AssetTaskQueue ⭐ 资产闭环

**作用**：把 image / TTS / music 的零散调用变成统一队列，自动绑定到 scene / character，自带重试 / 验收。

**目标源码**：
- `src-tauri/src/asset_queue/queue.rs` — 状态机 `pending → running → succeeded / failed / retrying`
- `src-tauri/src/asset_queue/scheduler.rs` — 并发池（默认 2 image + 4 tts + 1 music，可配置）
- `src-tauri/src/asset_queue/binder.rs` — 按 `AssetTask.sceneRef` 自动写到 `game/background/*`、`game/figure/*`、`game/bgm/*`、`game/vocal/*`，并更新脚本引用
- `src-tauri/src/asset_queue/reviewer.rs` — 可选 AI 自评（构图、口型匹配、风格一致），不达标入 retry

**收敛现有能力**：`ai_generate_image / ai_generate_tts / generate_music / generate_batch_tts` 收敛为队列单一入口。

**用户可见**：Flow 画布上 Asset 节点展开后是进度列表，每条资产显示 prompt / 缩略图 / 重试次数 / 绑定 scene。

**验收**：12 场景 × 平均 8 段对白，30 分钟内完成全部语音；失败自动 retry 3 次再标 failed；生成产物**自动**写入 scene 引用，不需人工绑定。

---

### 3.6 Quality Gate（自动质检 + 自审）

**作用**：在 Export 前必须有自动关卡挡住致命问题。

**目标源码**：
- `src-tauri/src/quality/lint.rs` — WebGAL 语法 / 未声明变量 / 跳转死链 / 孤立场景 / 可达性 / 选项无下游
- `src-tauri/src/quality/auto_review.rs` — 调 Reviewer Agent 做一致性 / 风格 / 伏笔检查
- `src-tauri/src/quality/report.rs` — 生成质量报告

**用户在 Flow 上看到**：Quality 节点显示 ✅ / ⚠ N 项；点击跳到修复面板。

**验收**：每次 Export 前自动跑；阻断性问题不可绕过。

---

### 3.7 One-Click Run & Play（一键可玩）

**作用**：Flow 末尾自动 export → 起 Runtime Server → 用内嵌 Webview 打开预览。

**目标源码**：复用 `webgal/runtime_server.rs` + `webgal/project::export_project`，新增 `pipeline/finalize.rs` 收尾。

**用户可见**：全部 step 变绿后弹「试玩」按钮；点击进入 Runtime 窗口。

---

### 3.8 Observability & Cost（可观测 + 成本）

**作用**：让用户清楚每步花多少钱、为什么慢、能不能优化。

**目标源码**：
- `src-tauri/src/telemetry/usage.rs` — token 消耗、模型、时延
- `src-tauri/src/telemetry/cost.rs` — 按 provider 单价估算（表驱动）

**用户可见**：节点右上角角标显示 cost / duration；总览面板给总成本 / 总耗时 / 失败率。

---

## 4. 数据流总图

```
                ┌──────────────────────────────────────────────┐
                │              FlowBoard (React)               │
                │   DAG 渲染 / 状态镜像 / 用户操作              │
                └──────────────┬───────────────────────────────┘
                               │ Tauri event / IPC
                               ▼
       ┌────────────────────────────────────────────────────┐
       │   Pipeline Orchestrator (Rust, tokio)              │
       │   DAG 调度 / 重试 / 持久化 / 事件总线              │
       └───┬───────────┬───────────┬─────────────┬──────────┘
           ▼           ▼           ▼             ▼
        WorldBuilder  Plotter   Dialogist ...  Reviewer
           │           │           │             │
           └─────┬─────┴─────┬─────┘             │
                 ▼           ▼                   │
            ┌──────────────────────┐             │
            │       StoryPlan IR   │◄────────────┘
            │  .ollaic/plan.json   │
            └──────────┬───────────┘
                       ▼
              ┌────────────────────┐
              │  AssetTaskQueue    │
              │  image / tts / bgm │
              └─────────┬──────────┘
                        ▼
                  game/ (WebGAL)
                        ▼
                  Runtime Server → 试玩
```

---

## 5. 验收门槛（V2 上线标准）

| 维度 | 指标 |
|---|---|
| 端到端 | 任意提示词 → 12 场景 / 3 角色 / 中文 → 全部跑完 ≤ 30 min |
| 过程可视化 | Flow 画布节点状态与真实 step 同步延迟 ≤ 1 s |
| 干预能力 | 任意 step 可暂停、可重跑、可注入用户修订 |
| 资产闭环 | ≥ 80% 资产自动绑定，无需人工挑选 |
| 质检 | Export 前必跑 lint + AI 自审，致命问题阻断 |
| 可玩性 | 一键试玩，进入 Runtime 后能完整打完第一章 |
| 成本 | 单作品产出阶段 token 等效花销 ≤ $5（GPT-4.1 mini 估算） |
| 续跑 | 关闭应用再启动，能从最后未完 step 继续，不重做已完成部分 |

---

## 6. 落地切片（建议 4 个迭代）

| 切片 | 内容 | 价值锚点 |
|---|---|---|
| **P0 — Flow Shell** | Pipeline Orchestrator + StoryPlan IR + FlowBoard 空壳 + 2 个内置 step（Plan + Outline） | 骨架先立，UI 上能看到 DAG 跑起来 |
| **P1 — 内容链路** | 接 Plotter → Dialogist → AssetPlanner → SceneScript | 「提示词 → 可读剧本」闭环 |
| **P2 — 资产闭环** | AssetTaskQueue + 自动绑定 + 并发限流 | 真正闭环 |
| **P3 — 试玩 & 自审** | Quality Gate + One-Click Run & Play + Reviewer Agent | 端到端可玩 + 可信赖 |

P0 是地基，其余切片可以基于 P0 并行。**强烈建议先实现 P0**，否则后续每个功能都要 hack 状态。

---

## 7. 待跟踪决策

落地 P0 前需要明确的事项：

- [ ] Flow 画布技术栈：React Flow vs 自研轻量
- [ ] IR 落盘格式：JSON vs YAML vs 纯二进制
- [ ] Pipeline 持久化粒度：每 step 一次 vs 每节点一次
- [ ] 事件总线传输：Tauri event vs 独立 WS
- [ ] 多 Agent 上下文裁剪策略（每个 Agent 拿到 IR 的哪个子集）
- [ ] AssetTaskQueue 并发上限默认值（家用网络与 API rate 平衡）
- [ ] Quality Gate 中的「致命 vs 警告」分级阈值
