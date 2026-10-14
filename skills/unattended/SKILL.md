---
name: unattended
description: "Drive a ticket set to completion unattended (observer/driver mode). Spawn one fresh background agent per ticket, verify each landing, and never write code in the main session — so a whole effort finishes without occupying your context. Use whenever the user asks to 无人值守/观察者模式/后台跑完/overnight-run a ticket set, to 'run all tickets', to keep implementing tickets without occupying the main session, or to resume a stalled unattended run — typically after tickets were broken down via /to-tickets. Not for interactive single-ticket work."
disable-model-invocation: true
---

# Unattended Driver（无人值守驱动者模式）

Turn this session into a **driver**: orchestrate a ticket set to completion by spawning one fresh background agent per ticket, verifying each landing, and spawning the next. The driver is an **observer** — it never implements.

## Why this shape

Background agents work in their own context windows (a ticket can burn hundreds of thousands of tokens there); the driver only receives a short completion report. If the driver ever starts reading source or fixing code itself, its context balloons and the whole point is lost. The repo (tickets, status lines, commit history) is the durable state — any fresh session can resume from it.

## Inputs

1. **Ticket set**: a directory of ticket files (e.g. `.scratch/<slug>/issues/`) or an equivalent tracker query. If the user didn't name one, discover it: read `AGENTS.md` / `docs/agents/issue-tracker.md` for the repo's tracker convention; if several efforts exist, ask which slug.
2. Optional: per-session ticket budget (default: none — run until done or blocked), whether to set up a dead-man cron (see below; default: offer, don't auto-create).

## Startup self-check

1. Read repo conventions (`AGENTS.md`, tracker config) and the ticket set's `spec.md` if present.
2. Confirm the integration branch exists with a clean tree; run build + tests once — fix red before starting (a green baseline is what makes every later landing verifiable).
3. Scan ticket `Status:` lines; compute the **frontier** = open tickets whose `Blocked by` are all resolved, lowest number first.
4. If a ticket is `ready-for-agent` but its Comments record an unresolved blocker, skip it per stop rule R1.

## The loop (one ticket at a time)

**Spawn**: launch a background agent (`run_in_background`) with this prompt template — fill the bracketed parts, keep the discipline inline (the `implement` skill is user-invocation-only, so its discipline is inlined verbatim):

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

**Verify** (on each completion notification — light commands only, e.g. check the ticket Status, `git log -1` on the integration branch, run the build): ticket resolved + landing commit exists + build green. If the agent parked the ticket per stop rules, record the blocker and move on.

**Repeat**: recompute the frontier, spawn the next agent. Never spawn two at once unless the user explicitly asked for parallelism (repo branch discipline usually forbids it).

## Stop rules (decide for the absent user)

- R1 Spec gap / ticket conflict: record the blocker in the ticket's Comments, set it back to `ready-for-agent`, skip; if the frontier is fully blocked, stop and report.
- R2 Red tests: fix within the ticket's scope; upstream defects — small fix directly (with a regression test + a note back on the upstream ticket), large problem → R1.
- R3 Dependency outside the repo's approved baseline: treat as R1.
- R4 Acceptance needing real hardware / elevation / live network: complete everything automatable, check the box with a「待人工」note listing the manual steps; never block on it.
- R5 Two failed attempts on one ticket: park it (R1 mechanics).
- R6 Never: land half-done work, skip a closure step, edit spec/ADR/convention docs, or run parallel task branches.

## Final report

When everything is resolved (or parked): run the full build + tests once, then report — per-ticket status table, consolidated manual-verification checklist, skipped tickets with reasons, and a release recommendation (e.g. merge integration branch to trunk + tag).

## Context budget & handoff

The driver stays lean by design, but if the session does grow long: finish the current ticket, land it, then hand off — tell the user the one-line resume prompt is "按 <工单集> 的驱动者纪律继续" or point at the repo's driver doc if one exists.

## Dead-man cron (optional)

If the user wants survival across session death, offer to create a recurring scheduled task (1–2h interval) whose prompt is: run the anti-collision self-check first (dirty tree / existing `feat/*` branch / commit within 30 minutes → exit silently); otherwise resume the same driver discipline with a per-session budget of ~3 tickets. Always remind the user to delete it in the final report — and delete it yourself if the user asks.
