# Better agent creation

Elevate Xyne Spaces agent creation (Hub + Xyne Agent DM + approve) toward Codex-class ergonomics **without** breaking the 3-tier model: claw-auth holds DB/secrets; xyne-claw is untrusted loop; Kata is shell/sandbox. Deny and policy live in claw-auth / Kata parent — **not** inside xyne-claw hooks.

**Branch:** `agent-creation-deveshp` only  
**Status:** Phase 1 **implemented** · Phase 2 **implemented** · Phases 3–6 in progress on tip  
**Concurrent:** Live Hub/DM Phase 1 walk may run in parallel ([bc-df0ecd78](https://cursor.com/agents/bc-df0ecd78-426f-58fd-8114-b7d44133b643))

Prior P1 unit evidence: [`internal/better-agent-creation-p1-p2.md`](../internal/better-agent-creation-p1-p2.md) @ `1a6f54966`

---

## Corrections (apply to all phases)

- Postgres remains source of truth for Agent rows. **xyne-claw never writes** the Agent row.
- Pod has **no DB / secrets**.
- Path A/B/C stay three transports; **Hub does not call propose-agent**.
- Do **not** rename repo `AGENTS.md`; agent `systemPrompt` stays **persona** only.
- No `.xyne/hooks.json` executing inside xyne-claw.
- `/agent spawn` = **run**, not agents row; must not skip propose-agent for catalog agents.
- File-scope + 3-cycle **BLOCKED** only for **coding coordinators** (repo write tools).
- `apply_patch` only if current edit tool can tear files — else skip second grammar.
- Do **not** bake Vespa into `systemPrompt` at create time.

---

## Phase 1 — Authoring contract & ask-first — **IMPLEMENTED**

### Acceptance

1. **"Make an agent" on Hub** → clarify / ask job; empty canvas; no propose-agent.
2. **Same in Xyne Agent DM** — ask, no propose-agent yet.
3. **Named job drafts**; prompt has seven sections OR propose-agent rejects missing workflow/guardrails.
4. **Draft that can delete/send includes permission mode**; blank → ask-first.
5. **Approve still one personal agent**, catalog tools only, audit, no double-click double row.
6. **Skill slug attached**; missing skill fails approve, draft stays pending.
7. **Scheduled runs still cannot author.**

### Key files

- `apps/xyne-claw/src/propose-agent.ts`
- `apps/xyne-claw-auth/backend/src/routes/agents.ts` (POST)
- `apps/dashboard/src/components/flowUI/nodes/agent/create/classifyCreateTurn.ts`
- `apps/dashboard/src/components/flowUI/nodes/agent/create/createChatMode.ts`
- `apps/xyne-claw-auth/backend/scripts/seed-xyne-agent.ts`
- `apps/dashboard/src/components/flowUI/nodes/agent/DraftAgentCard.tsx`
- `apps/xyne-claw/test/propose-agent.test.ts`
- createChatMode / classifyCreateTurn tests

### Seven system-prompt sections

Identity & tone · Operational Workflow · When to use each tool · Guardrails · Decision rules · Error recovery · Contrastive examples

Hard reject: missing Workflow / Guardrails (via shared `validateSystemPromptContract`).

Permission modes: `ask-first` (default) · `read-only` · `can-write`.

### P1 unit evidence

| Criterion | Result | Evidence |
|-----------|--------|----------|
| Hub ask / no propose | PASS | `classifyCreateTurn` → clarify; Hub appendix `XYNE_CREATE_ASK` |
| DM ask | PASS | `seed-xyne-agent` AUTHORING_PROMPT_APPENDIX |
| Seven sections / reject | PASS | `propose-agent.test.ts`, `agent-prompt-contract.test.ts` |
| ask-first default | PASS | `normalizePermissionMode` |
| Approve one personal | PASS | `claimPendingAgentCreate` + DraftAgentCard lock |
| Skill on approve | PASS | missing → 400 + revert pending |
| Scheduled cannot author | PASS | `agentAuthoringEnabled` + `!isScheduledOrAutomationRun` |

---

## Phase 2 — TOML projection — **IMPLEMENTED**

Postgres stays SoT. `xyne-claw` never writes the agent row. No secrets in file. Explicit import/export only — **no** live two-way watcher.

### Path

`.xyne/agents/<slug>.toml` (Space repo or export download)

### Fields

- `name`, `description`
- `system_prompt` / `system_prompt_file`
- `model`, `permission_mode`
- `skill_slugs`
- tool allow / deny
- `kb_scope`, collection ids

### Forbidden keys (reject on import)

`signing_secret`, `spaces_app_token`, `service_account` secrets, raw MCP tokens (and related)

### Import

- Admin/owner → same approve/update path as Path B
- Audit AGENT update
- Skills resolved **before** mutate
- Optimistic `updatedAt`
- Hash match → no-op
- Non-admin cannot set scope global

### Export

- From row; re-import no-op if hash matches

### Precedence

Resolved in claw-auth before dispatch; pod gets one resolved config.

### API

- `GET /agents/:slug/toml`
- `POST /agents/:slug/toml` `{ toml, expectedUpdatedAt?, scope? }`

### Key files

- `packages/xyne-claw-shared/src/agent-toml.ts` (+ tests)
- `apps/xyne-claw-auth/backend/src/lib/agent-toml-sync.ts` (+ tests)
- `apps/xyne-claw-auth/backend/src/routes/agents.ts`

Validation report: [`internal/better-agent-creation-p2-validate.md`](../internal/better-agent-creation-p2-validate.md)

---

## Phase 3 — Layered guidance (capped 32 KiB)

- Org default (tenant) + Space root + optional leaf
- Compile in **claw-auth**; leaf wins; truncate leaf if over `32_768`; **record truncation on run**
- Inject as stable prefix **after tool defs**, before Vespa/tool output
- Do **NOT** rename repo `AGENTS.md`; agent `systemPrompt` stays persona

### Key files

- `packages/xyne-claw-shared/src/guidance-chain.ts` (`SPACE_DOC_MAX_BYTES = 32_768`)
- `apps/xyne-claw-auth/backend/src/lib/run-guidance.ts`
- `apps/xyne-claw-auth/backend/src/lib/start-run.ts` (compile + forward `teamGuidance`)
- `apps/xyne-claw/src/routes/run.ts` (inject after sorted tools)

---

## Phase 4 — Isolation audit first, then only if needed

- Measure `subagent-tools.ts` + `AgentDelegationGrant`: parent gets **summary** vs full transcript?
- If summary already exists, **extend existing path** — no second spawn
- `/agent spawn` = run not agents row; must not skip propose-agent for catalog agents
- File-scope + 3-cycle BLOCKED only for coding coordinators (`isCodingCoordinator`)

Document measurement in internal report; implement only what measurement justifies.

### Key files

- `packages/xyne-claw-shared/src/subagent-isolation-audit.ts`
- `packages/xyne-claw-shared/src/coding-review-budget.ts`
- `apps/xyne-claw/src/subagent-tools.ts`
- `apps/xyne-claw-auth/backend/prisma/schema.prisma` (`AgentDelegationGrant`)

---

## Phase 5 — Policy outside pod

- Tool deny list on `/mcp/call` in claw-auth **before** write card; forbidden beats card
- Compound shell split in Kata parent / shared policy; unsplittable → approval / block path
- No `.xyne/hooks.json` executing inside xyne-claw
- `apply_patch` only if current edit tool can tear files — else skip (sandbox-edit exists)

### Key files

- `apps/xyne-claw-auth/backend/src/routes/mcp.ts` (`deniedTools` / read-only before ask card)
- `packages/xyne-claw-shared/src/shell-policy.ts`
- `apps/xyne-claw/src/command-guard.ts`

---

## Phase 6 — Prompt prefix + compaction

- Order: platform directives → tool schemas (**sorted by slug**) → P3 guidance → dynamic Vespa/tools
- Extend `compactBeforeRun`; do **NOT** add new compaction service until measured
- Vespa must not be baked into `systemPrompt` at create time

### Key files

- `packages/xyne-claw-shared/src/prompt-prefix.ts` (`assembleStaticPrefix`, `sortToolSlugsForPrefix`)
- `apps/xyne-claw/src/routes/run.ts` (sort tools; `compactBeforeRun`)

---

## Acceptance (roll-up)

| Phase | Gate |
|-------|------|
| 1 | Seven acceptance rows above (unit + live walk when concurrent agent finishes) |
| 2 | GET/POST toml; forbidden secrets; skills-before-mutate; optimistic updatedAt; hash no-op; non-admin ≠ global; Postgres SoT |
| 3 | Org/space/leaf compile ≤ 32 KiB; truncation recorded; persona untouched |
| 4 | Measurement documented; no duplicate spawn; coding-only review budget |
| 5 | Deny before write card; shell split outside hooks.json; no tear-file apply_patch unless needed |
| 6 | Sorted tool prefix; compactBeforeRun only; no Vespa-in-create-prompt |

---

## Non-goals

- Live bidirectional TOML ↔ Postgres watcher
- Starlark rules engine as product surface
- `.xyne/hooks.json` lifecycle bus inside xyne-claw
- Second compaction microservice
- Renaming repo `AGENTS.md` / replacing persona with SPACES.md
- Writing Claw agents into Spaces backend `agents` table
- Subagent spawn UX that creates catalog Agent rows without propose-agent
- Second `apply_patch` grammar when sandbox-edit already does surgical replace

---

## Reports

| Doc | Purpose |
|-----|---------|
| [`internal/better-agent-creation-p1-p2.md`](../internal/better-agent-creation-p1-p2.md) | P1 unit + P2 ship (prior) |
| [`internal/better-agent-creation-p2-validate.md`](../internal/better-agent-creation-p2-validate.md) | P2 tip validation |
| [`internal/better-agent-creation-p3-p6.md`](../internal/better-agent-creation-p3-p6.md) | P3–P6 ship + P4 measurement |
