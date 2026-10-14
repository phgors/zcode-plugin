---
name: unattended-workflow
description: "Drive a ticket set to completion unattended using the dynamic-workflow engine: one driver workflow runs in the background, one fresh subagent per ticket (serial, frontier-ordered), deterministic verification per landing, a live ticket board, a confirmation gate before anything runs, and model selection via subagent_model. Same ticket discipline as the unattended skill, workflow-driven. Use whenever the user asks to 无人值守/后台跑完/overnight-run a ticket set AND names the engine or a model (用XX模型无人值守跑工单/换便宜模型跑/工作流引擎无人值守/要实时看板/要运行前确认把关), or to resume a stalled workflow-driver run — typically after tickets were broken down via /to-tickets. For the classic background-agent driver (no model named, no workflow requested), use the unattended skill instead. Not for interactive single-ticket work."
disable-model-invocation: true
---

# Unattended Workflow Driver（工作流驱动的无人值守模式）

Orchestrate a ticket set to completion with ONE dynamic-workflow script: the main session writes the script and stays lean; the run executes in the background, handing each ticket to a fresh subagent context, verifying each landing with deterministic checks, and reporting onto a live board. The main session never implements — same observer discipline as `unattended`, different engine.

## 与 unattended 技能的分工

| | unattended（默认） | 本技能 |
|---|---|---|
| 引擎 | 主会话逐张 spawn 后台 Agent | 一个 `CreateWorkflow` 运行 |
| 指定模型 | 不支持（后台代理固定用会话模型） | 支持 `subagent_model` |
| 运行前把关 | 无 | 确认页（阶段图 + 命令清单） |
| 实时进度 | 每张完成一条通知 | `artifact.board` 看板逐张更新 |
| 出错恢复 | 一句话续跑（repo 即状态） | 修订脚本 `AmendWorkflow`，已完成工单缓存零成本复用 |

用户点名了模型，或明说要工作流引擎/看板/运行前确认 → 本技能；否则 → `unattended`。看板与确认页是附带好处，不单独作为切换理由向用户推销。

## 前置：加载编写契约

Load the `dynamic-workflows` skill via the Skill tool BEFORE anything else — `CreateWorkflow` refuses to run without it, and its full authoring contract applies: phases required, typed results, `world.run` gates, artifact rules, amend-never-rebuild.

## Inputs

1. **Ticket set**: a directory of ticket files (e.g. `.scratch/<slug>/issues/`) or an equivalent tracker query. If the user didn't name one, discover it: read `AGENTS.md` / `docs/agents/issue-tracker.md` for the repo's tracker convention; if several efforts exist, ask which slug.
2. Optional: **model**（用户点名的模型，原样传 `CreateWorkflow` 的 `subagent_model`，只在用户要求时传；解析不了用 `ListModels`）, per-run ticket budget (default: all — run until done or blocked), dead-man cron (default: offer, don't auto-create).

## Startup self-check（主会话里做，写脚本之前）

1. Read repo conventions (`AGENTS.md`, tracker config) and the ticket set's `spec.md` if present.
2. Confirm the integration branch exists with a clean tree; run build + tests once — fix red BEFORE starting (a green baseline is what makes every later landing verifiable). This run doubles as the gate survey: write down the repo's real build/test commands; they go into the script as `world.run` **string literals**.
3. Scan ticket `Status:` lines; compute the **frontier** = open tickets whose `Blocked by` are all resolved, lowest number first.
4. If a ticket is `ready-for-agent` but its Comments record an unresolved blocker, skip it per stop rule R1.

## The driver script（骨架）

Repo-specific parts in `<>`；`world.run` 的命令名必须是编译期字面量（来自自检第 2 步的实地调查）：

```ts
interface Ticket {
  /** 工单号，如 "07"。 */
  id: string;
  /** 一句话标题。 */
  title: string;
  /** 工单文件的工作区相对路径。 */
  path: string;
}
interface TicketOutcome {
  /** 工单号。 */
  id: string;
  /** "landed" 已合并进集成分支 | "parked" 按停止规则搁置 | "blocked" 等用户决断。 */
  status: "landed" | "parked" | "blocked";
  /** 落地提交的短哈希；未落地为空串。 */
  commit: string;
  /** 验收摘要（落地时），或搁置/阻塞的原因与证据。 */
  note: string;
}

artifact.board("tickets", {
  title: "工单进度看板",
  key: "id",
  status: "status",
  columns: ["landed", "parked", "blocked"],
  detail: [{ field: "commit", label: "提交" }, { field: "note", label: "备注" }],
});

async function nextTicket(): Promise<Ticket | null> {
  // files.glob("<工单目录>/*.md") -> files.read 逐张解析 Status / Blocked by
  // 返回 frontier 上号数最小、可立即开工的工单；frontier 为空返回 null
}

const ROUND_CAP = <工单总数 + 少量余量；用户给了预算就用预算>;  // 禁止无上限循环
const retried = new Set<string>();   // R5：每张工单最多两次尝试
for (let round = 0; round < ROUND_CAP; round++) {
  phase("取 frontier 最靠前的工单，交给一位全新的实现工程师");
  const t = await nextTicket();
  if (t === null) break;
  const impl = agent(`实现工程师-${t.id}`, { system: <实现工程师 persona> });
  let outcome = await impl.ask<TicketOutcome>(<下方工单提示词模板，填好本票信息>);
  if (outcome.status !== "landed" && !retried.has(t.id)) {          // R5 的第一次重试
    retried.add(t.id);
    outcome = await impl.ask<TicketOutcome>(
      `上一次尝试未落地（${outcome.note}）。这是第二次也是最后一次机会，卡点若属规格缺口按停止规则搁置。`,
    );
  }
  report({ ...outcome, title: t.title }, "tickets");

  phase("用确定性检查核验这一张的落地");
  const ticketText = await files.read(t.path);
  const build = await world.run(<仓库真实构建命令字面量>, <args>);
  const verified = ticketText.includes("Status: resolved") && outcome.commit !== "" && build.exitCode === 0;
  if (outcome.status === "landed" && !verified) {
    // R2：小问题派回同一位 impl 修（第三次 ask，上下文还在）；
    // 大问题把工单置回 ready-for-agent、outcome 改 parked 并在 note 记卡点
  }
}

phase("收尾：全量构建与测试各真跑一次，产出最终报告");
const full = await world.run(<仓库真实全量测试命令字面量>, <args>, { timeoutMs: 1_800_000 });
await artifact.markdown("report", <逐票状态表 + 待人工清单 + 跳过原因 + 发布建议>, {
  title: "无人值守最终报告",
  primary: true,
});
return <WorkflowReport：conclusion（共 N 张、落地/搁置/待人工各多少、全量测试是否绿）、
        findings（逐票：where=工单号、what=状态与摘要、evidence=提交与测试输出、
        status=verified|unconfirmed、severity）、verified（跑过的命令）、notCovered（待人工项及原因）>;
```

Engine rules（工作流契约，不可协商）：**串行是纪律**——每轮一个 `await`，绝不并行扇出工单（R6）；`ROUND_CAP` 必须有；每轮从活的工单文件重算 frontier；phase 名与一切用户可见文字用用户的语言、说工作不说机制；**不轮询**——完成通知自带 return 与全部已报工单。

## 子代理：实现工程师（ask 模板，与 unattended 同文）

```
你是 <项目名> 的实现工程师，完成一张工单：<NN> <标题>。

必读（按序读完再动手）：
1. AGENTS.md（分支规范与编码规范——硬约束）
2. <工单文件路径>（目标/验收标准/规格出处/参考资料都在工单内）
3. CONTEXT.md（若仓库有）

流程（严格遵守）：
0. 确认在集成分支且工作树干净；核对本工单 Blocked by 均 resolved，否则报告退出。
1. 按 implement 纪律完成本票：默认直接实现，用既有测试验证；仅当工单/规格
   明确要求 TDD 或触及高风险/复杂逻辑（协议解析与编解码、加密/认证、路由
   与负载均衡决策、并发与状态机、配置迁移）时才走 TDD（红-绿-重构）；定期
   类型检查、经常跑单测文件、收尾一次全量测试；完成后按 code-review 双轴
   （编码规范＋规格符合）自审；提交到当前分支。
2. 工单置 Status: claimed（提交）；git checkout -b feat/<slug> <集成分支>。
3. 落地：切回集成分支 --ff-only 合并、删分支。
4. 工单置 resolved、勾选验收标准、Comments 追加验收证据（测试名/输出摘要）。
5. 最终报告（简短）：工单号与状态、最新提交、测试摘要、遗留/待人工项。

停止与跳过：规格缺口/需基线外依赖/两次尝试失败 → 置回 ready-for-agent＋
Comments 记卡点＋报告说明；真机/提权/真网类验收完成可自动化部分并标注
"待人工"；严禁半成品落地、擅改规格文档、同时多条任务分支。
```

persona 除角色外必带诚实条款："如果一项检查不可能通过，或你的指令互相矛盾，升级提问并如实说明，不要绕过去。" 子代理的返回值就是 `TicketOutcome`——把模板第 5 步的"最终报告"对齐到这三个字段。

## 停止规则（替不在场的用户做决定）

- R1 Spec gap / ticket conflict: record the blocker in the ticket's Comments, set it back to `ready-for-agent`, skip (→ `parked` + note)；frontier 全堵时收尾报告并标 `blocked`。
- R2 Red tests: fix within the ticket's scope; upstream defects — small fix directly (regression test + note back on the upstream ticket), large problem → R1.
- R3 Dependency outside the repo's approved baseline: treat as R1.
- R4 Acceptance needing real hardware / elevation / live network: complete everything automatable, check the box with a「待人工」note; never block on it（进 `notCovered`）。
- R5 Two failed attempts on one ticket: park it（骨架里的 `retried` 集合 + 第二次 ask 已实现）。
- R6 Never: land half-done work, skip a closure step, edit spec/ADR/convention docs, or run parallel task branches。

子代理升级提问（`dwfq-...` 通知）→ 用 `ResolveWorkflowQuestion` 回答，按 R1–R6 判 parked/blocked；通知丢了用 `GetWorkflowRun` 的 `pendingQuestions` 兜底。

## 运行中与出错

- 提交后拿 run ID，**不轮询**；完成通知携带 return + 全部已报工单。
- **errored（脚本自身失败）**：编辑通知点名的 scriptPath，`AmendWorkflow(run_id, path)` 重交——已完成工单零成本缓存复用。绝不 `CreateWorkflow` 从头再来。
- **stopped**：`ResumeWorkflowRun` 原样续跑；stop-reason 是 `provider` 类（登录过期/模型不在套餐/配额）先和用户解决再续。
- **跑偏**：趁还在跑就 `AmendWorkflow`——一次调用完成停旧、导缓存、起新；不用 TaskStop、不用等结算。

## Final report

脚本收尾阶段全量 build + test 各真跑一次（`world.run`）；`artifact.markdown` 发布逐票状态表、待人工核验清单、跳过原因、发布建议（`primary: true`），运行结束卡片仍在；return 用 WorkflowReport 四字段。主会话收到通知后向用户转述结论并指向报告卡片。

## Context budget & handoff

主会话天然精简——脚本提交后就没它的事了。交接一句话："按 <工单集> 的工作流驱动纪律继续"：在场运行 stopped → `ResumeWorkflowRun`；errored → `AmendWorkflow` 其 scriptPath；无在场运行 → 按本技能重开（工单状态在 repo 里，重开不丢进度）。

## Dead-man cron（optional）

If the user wants survival across session death, offer a recurring scheduled task (1–2h interval) whose prompt is: run the anti-collision self-check first (dirty tree / existing `feat/*` branch / commit within 30 minutes → exit silently); otherwise `ListWorkflowRuns` — a stopped run gets `ResumeWorkflowRun`, an errored one gets `AmendWorkflow` on its script file, no run in place starts fresh per this skill with a per-session budget of ~3 tickets. Always remind the user to delete it in the final report — and delete it yourself if the user asks.
