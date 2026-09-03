---
name: claw-platform-brain
description: How the Xyne Claw platform works end to end — architecture and the trust chain, the agent config model, the kinds of tools, subagents, skills, knowledge base, providers and the LEVELS they're set at, MCP credential levels and resolution order, memory, sandbox, and the latency model for why agents are slow. READ THIS before answering any platform/"how does Claw work" question or before advising on an agent's configuration. It is the mental model, not the full truth — when it doesn't cover a specific (exact field, current behavior, an edge case), read the source via the bitbucket subagent and cite the file.
---

# Claw Platform Brain

Your reference for how Xyne Claw actually works. Use it to answer platform
questions and to ground config recommendations. It's the model, not the full
truth, and it can drift — when a specific isn't covered (an exact field, current
behavior, a flag, an edge case), read the actual code via the `bitbucket`
subagent and cite the file. You are **read-only and advice-only**: inspect,
explain, recommend; a human applies changes in the editor.

---

## 0. What Claw is (architecture)

Claw is a multi-tenant agent platform. Agents live inside **Xyne Spaces** (chat
channels/threads); users @mention an agent and it replies in-thread.

Components and the trust chain `sandbox → claw pod → claw-auth → spaces`:

- **claw-auth** (gateway) — Express API. Holds secrets, runs MCP tools, verifies
  webhooks, dispatches runs, posts results back to Spaces, owns Postgres/Redis/queues.
- **xyne-claw** (the "claw pod") — the agent runtime / LLM loop. Runs the agent's
  turns, calls tools (MCP tools go back to claw-auth's `/mcp/call`), streams progress.
- **Sandbox VM** — a separate, untrusted, **egress-closed** coding environment the
  agent drives for code execution (see §9).
- **LiteLLM** — provider-agnostic model gateway (see §3).
- **Hindsight** — long-term memory engine (see §8).
- **Postgres (Prisma)**, **Redis + BullMQ** (scheduled jobs, run recovery), **GCS**
  (session checkpoints, result markers).

**Lifecycle**: Spaces webhook (HMAC-signed) → claw-auth resolves agent + creds →
dispatches `/run` to xyne-claw (S2S) → xyne-claw loops: LLM turn → tool calls
(`/mcp/call` back to claw-auth) → progress stream → completion callback → claw-auth
posts the reply to Spaces. Everything external runs as an MCP tool **through
claw-auth**, never directly from the model.

---

## 1. Agent configuration model

An **Agent** row: `slug` (unique), `name`, `description`, `systemPrompt`, `scope`
(`global`|`personal`), `enabled`, `modelId`, `kbScope` (`COLLECTIONS`|`USER`), and a
free-form **`config` JSON**.

### `config.tools` — the tool palette (main advice target)
```jsonc
config.tools = {
  "subagents": ["sandbox","grafana-prod-fork"], // subagent NAMES
  "direct":    ["github__search_repositories"], // MCP tool selection keys
  "custom":    ["webfetch","list_agents"],      // System tool slugs (custom:*)
  "gateway":   ["some-service"]                 // gateway service names
}
```
### Other `config` keys
`config.modelSettings` (`model`, `temperature`, `maxTokens`, `thinkingLevel`),
`config.outputFormat` (`type: json|markdown`, `schema`, `template`,
`requireToolsBeforeSubmit[]`), `config.memoryEnabled`, `config.memoryApprovalStrategy`,
`config.verifyResponses`, `config.citationReflection`, `config.skillTriggers[]`,
`config.sandboxRepo`, `config.promptInjection`, `config.provider` / `config.providerOrder`
/ `config.providerAlwaysOn` (see §3).

Related tables: `AgentSkill` (skills), `AgentCollection` (KB grants),
`AgentMcpConnection` (pinned MCP instances), `AgentProviderCredentials`,
`AgentPromptVersion` (append-only prompt history).

---

## 2. Tools — the kinds

| Kind | Slug form | Lands in | Needs |
|---|---|---|---|
| **MCP tool** | `serverType__tool` | `tools.direct[]` | a connected MCP server |
| **System / custom tool** | `custom:*` slug | `tools.custom[]` | nothing — claw-auth-executed (e.g. `webfetch`, `kb-*`, the introspection tools `list_agents`) |
| **Gateway service** | service name | `tools.gateway[]` | tenant gateway service |
| **Built-in FS tools** | `read/write/grep/find/ls` | always present in the pod | path-scoped; **no `bash`** in the pod (bash lives in the sandbox, §9) |

The catalog is `list_available_tools` → `integrations[]` (each with
`usageCount`, `readTools`/`writeTools`, `connected`), `subagents[]`, `customGroups[]`.
High `usageCount` on an integration a peer agent lacks is a strong "add it" signal.
A `selectionKey` links a listed tool to its config slug so the runtime gates it.

---

## 3. Providers & model selection (and at what LEVEL)

**Provider-agnostic via LiteLLM.** Supported providers: `spaces` (LiteLLM platform
default), `claude`, `copilot`, `codex`, `openrouter`. Two platform models:
`LITELLM_MODEL` = the **worker** model; `LITELLM_FAST_MODEL` = the cheap **judge/boss**
model used by chain-judge, goal-judge, eval roles (using the worker model there would
double per-turn cost for marginal quality).

**Levels where provider/model can be set:**
- **Per-user**: `UserProviderCredentials` (`provider`, encrypted key, `model`,
  `baseUrl`, `authType`, `reasoningEffort`). The user's own creds.
- **Per-agent**: `AgentProviderCredentials` (same shape + `createdByUserId`). Team
  fallback provider for the agent.
- **Per-user-per-agent**: `UserAgentConfig.provider` — a user's provider choice for
  one agent (`spaces` = no preference).
- **Per-run override**: `config.modelSettings.model`, `thinkingLevel`.
- **Platform default**: `spaces`/LiteLLM.

**Resolution mode** is governed by `config.providerAlwaysOn`:
- `!== false` (**always-on**, default): agent's `providerOrder[]` → `config.provider`
  → personal → any-with-creds → spaces.
- `=== false` (**kimi-first**): personal → escalation (via `/upgrade`) → spaces.
Headless runs (scheduled jobs) use agent-level creds only.

**Reasoning effort / thinking level**: `low|medium|high` (per-user, per-agent, or
per-subagent). Higher = slower & costlier; only meaningful on reasoning-capable models.

**Subagents bill separately.** A subagent resolves its own provider
(per-user subagent override → explicit → parent → else LiteLLM). Special case: if the
parent is on **Anthropic OAuth** (Pro/Max plan token), subagents are forced onto
LiteLLM to avoid plan→credits billing spillover (override `XYNE_SUBAGENT_FOLLOW_PARENT=1`).

---

## 4. MCP — at what LEVEL it can be set

An MCP **server** is defined either by a code **static adapter** (`STATIC_ADAPTERS`,
stdio launch command is code-reviewed only) or a DB `McpServer` row (transport
`stdio`|`http`). Tools sync into the `tools` table; **write tools** are HITL-gated
(`permission=ask`, `writeTools`/`writeToolPolicy`) and cannot be overridden.

**Credential levels** (resolution order = first hit wins, in `credentials-loader`):
1. **Per-agent** (`AgentMcpConnection`) — agent-pinned instance. Has a `slug`
   (default `"default"`) + `displayName`, so an agent can pin multiple instances of
   the same server type (e.g. Grafana `prod` vs `staging`). Only consulted when the
   call carries an `agentSlug`; narrowed by `instanceSlug` if given.
2. **Per-user** (`UserMcpConnection`) — the user's own creds for a serverType. Unique
   `[userId, mcpServerId]`. OAuth tokens are refreshed here before use.
3. **Global** (`GlobalMcpCredentials`) — admin-managed shared creds; used **only** when
   `McpServer.allowGlobalFallback = true` and no agent/user creds exist.

**Subagent instance pinning**: `SubagentDefinition.mcpInstanceMap`
(`Record<serverType, instanceSlug>`) restricts a subagent to one pinned instance per
server type (e.g. `{ "grafana": "prod" }`); missing keys inherit the parent's instances.

**Spawn/caching**: stdio servers spawn child processes; sessions cache by
`userId:serverType[:agentSlug]` with **20-min idle eviction**; request timeout is
10 min (`MCP_REQUEST_TIMEOUT_MS`). First spawn pays a provisioning cost (§11).

---

## 5. Subagents

A **subagent** is a *full nested LLM run* exposed to the parent as one tool (its
description starts `[Subagent — nested LLM run, expensive]`). It bundles a system
prompt + its own scoped tools. Built-ins live in code (`SUBAGENT_DEFINITIONS`:
`sandbox`, `spaces`, `bitbucket`, `slack`, …); custom ones are `SubagentDefinition`
rows. Attach by adding the **name** to `config.tools.subagents[]`.

- **Fork** (`POST /:slug/fork-subagent` → `mcpInstanceMap`) to pin a subagent to a
  specific MCP instance, e.g. `grafana` → `grafana-prod-fork`.
- **When to recommend a subagent over direct tools**: when a task needs *several*
  tools from one domain in a multi-step loop — the subagent keeps that work out of
  the parent's context. For a single factual lookup, a direct tool is cheaper/faster.
- **Cost**: a subagent call is ~20–60s (a whole nested loop). N **sequential** calls
  = N× wall-clock. They must be fired in the **same** assistant turn to run in parallel.

---

## 6. Skills

A **Skill** is reusable markdown (a playbook) + optional companion files, attached via
`AgentSkill`. Recommend a skill when an agent repeatedly needs the same procedure or
domain knowledge. `config.skillTriggers[]` (`{toolName, skillSlug, when: before|after}`)
auto-injects a skill around a matching tool call. Skills can attach to agents and to
subagents (`SubagentSkill`).

---

## 7. Knowledge base

`kbScope`: **COLLECTIONS** (agent allowlists specific Spaces collections via
`AgentCollection`) or **USER** (inherits the calling user's full KB). Six read-only
tools auto-surface when the agent has grants or USER scope: `kb-list-resources`
(top-level inventory), **`kb-list-files`** (the `ls` — files *and* sub-folders;
takes a collection **or folder** id, plus `depth`: 1 = collapsed children,
N = expand N levels, -1 = whole subtree, capped at 400 rows), `kb-search`
(Vespa over names + chunks), `kb-read-file`, `kb-search-within-doc`, `kb-get-chunks`.
Flag a COLLECTIONS-scope agent with zero grants that clearly needs documents.

Navigation: `kb-list-resources` → `kb-list-files` to map the layout →
`kb-search` / `kb-search-within-doc` to locate → `kb-read-file` / `kb-get-chunks`
to read. `kb-list-resources` is **top-level only** — a collection whose documents all
live in sub-folders looks empty there, so check its `file_count` (recursive) and
`folder_count` before concluding the KB is empty. File rows carry a root-relative
`path`, which is the only way to tell apart the repeated names a
convention-based layout produces (`services/<area>/service.md`).

Grants nest: a whole-collection grant covers every file at or below it, at any
depth (`services/` covers `services/release-deploy/service.md`). A single-file
grant exposes that file plus the folders on its path, nothing else. Both layers
still apply on every call — the allowlist, then the caller's live Spaces access.

---

## 8. Memory

Engine: **Hindsight** (vector + fact-extraction; multi-strategy recall). Each agent
has its own **bank** (`bankIdForAgent`); the Digital Twin keeps a **per-user** bank.

- **Recall** (read): the `memory-search` tool (query + optional subsystem, budgeted
  `low|mid|high`, token-capped). Tag-gated: `user:<id>` (twin), `subsystem:<name>` or
  `shared` (team) — enforced server-side AND re-checked in-process.
- **Write** (never live): session → **nightly curator** (LLM extracts facts) →
  **human approval** → `retain` to Hindsight. Rejected batches cost zero tokens. (The
  Digital Twin can auto-approve high-confidence candidates per the user's setting.)
- **Enable**: `config.memoryEnabled`; `config.memoryApprovalStrategy`
  (`HUMAN_ONLY|EVALS_ONLY|EVALS_THEN_HUMAN`); `HINDSIGHT_URL` toggles globally.
- Recommend enabling for continuity-heavy agents (recurring triage/incident work).

---

## 9. Sandbox

The agent runs in two isolated layers:
- **Claw pod (LLM runtime)** — only **5 path-scoped FS tools** (read/write/grep/find/ls),
  **no bash**, **no webfetch as a raw fetch**; every outbound call signed with a 6h HMAC
  session token. Its only egress is back to the claw-auth gateway.
- **Sandbox VM (coding platform)** — a full Linux env **with bash** and a noVNC live
  preview, driven by the agent's `sandbox-*` tools. It is a *separate, isolated VM*:
  **egress closed, no network, no access to gateway credentials**. So bash is available
  but safe by isolation. (Lockdown context: the May-14 exfil ran in the sandbox before
  egress was closed; the old `/users/:uid/mcp/call` route + LFI vector were removed.)

Recommend the `sandbox` subagent for agents that genuinely run/build code; it's heavy,
so don't add it to agents that only need lookups.

---

## 10. Why agents are slow (latency model)

Per-run metrics are recorded (in `AgentRun`): `totalMs`, `llmWaitMs` (queue/provider
startup), `llmDecodeMs` (streaming), `llmTotalMs`, `llmTurns`, `llmRetries`, `ttftMs`,
`tokensPerSec`, `toolMs`, plus `toolInvocations[]` (per-tool `durationMs`, `isError`).
Event metrics: `agent_compaction`, `tool_output_spill`, `agent_provider_fallback`,
`agent_empty_completion`, `agent_llm_stall`, `agent_stop_error`.

**The main causes (highest impact first):**
1. **Sequential subagents** — the #1 cause. Each is a full nested loop (~20–60s); N in
   separate turns = N× wall-clock. Fix: fire them in ONE turn (parallel), or use one
   well-scoped subagent question instead of 3–4 narrow ones.
2. **Slow model / high reasoning** — `thinkingLevel=high` can be 3–10× slower decode;
   low `tokensPerSec` (<~50) signals a slow model or reasoning. Fix: lower thinking
   level or pick a faster model for factual work.
3. **Context compaction** — when context nears the window, the runtime compacts
   (`agent_compaction` kinds `mid_turn_stop`/`forced_threshold`), adding ~2–10s each.
   Driven by large tool outputs (`tool_output_spill`: retrieval tools cap ~128KB,
   bulk/file tools ~32KB; overflow spills to `.context/` with a preview). Fix: fewer/
   narrower tools per turn.
4. **Provider fallback** — quota/transient errors or empty completions trigger a
   compact-then-retry on the next provider (`agent_provider_fallback`), ~30–90s each.
   Fix: check quota/creds; for stable speed use the platform default.
5. **MCP cold-start** — first spawn provisions the server (npm install, up to 3 min,
   though usually 5–30s; build-time prewarm avoids it); cached reuse is sub-second.
   Server flapping (`fetch failed`) causes retries/timeouts. (Note: a self-hosted MCP
   on a personal Tailscale node flapping = tools intermittently vanish + slow.)
6. **Memory/KB calls** — `memory-search` ~2–5s each; batch queries instead of many calls.
7. **Tool serialization** — independent tools run across separate turns instead of one
   turn; `toolMs` is max-of-parallel, so batching independent calls is a direct win.

**Diagnostic playbook** (for a slow agent/run):
- `llmTurns` high → context grew → more compaction.
- `llmTotalMs >> toolMs` → LLM-bound (model/reasoning). `toolMs >> llmTotalMs` →
  tool-bound (slow external calls / serialization).
- `llmRetries > 0` or `agent_empty_completion`/`agent_provider_fallback` → overflow or
  provider instability.
- `subagentName` repeated across turns → sequential subagents → recommend parallel.
- `tokensPerSec` low / `ttftMs` high → model/reasoning choice.
- multiple `agent_compaction forced_threshold` → tool-output bloat or too many tools.

---

## 11. How to advise on a config

Flow: `list_agents` → pick target → `get_agent_config` → `list_available_tools` →
cross-reference this skill → recommend. For each recommendation give: the exact
slug/name, which `config.tools.*` array it goes in, and a one-line reason.

Heuristics:
1. **Missing high-usage integrations** for the agent's stated purpose (read
   `description`/`systemPrompt`) — e.g. a deploy agent with no GitHub/Bitbucket.
2. **Consolidate direct tools → a subagent** when many tools from one domain are listed
   (saves parent context; but note subagent latency cost — §10).
3. **Write tools** only when the job needs mutation (they're HITL-gated).
4. **Skills** for repeated procedures visible in the prompt.
5. **KB**: flag COLLECTIONS-scope agents with zero grants that need docs.
6. **Memory**: suggest `memoryEnabled` for continuity-heavy agents.
7. **Providers**: if an agent needs a stronger/faster model, advise the right level
   (per-agent vs per-user) and note reasoning/thinking trade-offs.
8. **MCP levels**: if an agent must hit a specific instance (prod vs staging), advise an
   `AgentMcpConnection` pin (+ fork the subagent with `mcpInstanceMap`).
9. **Performance**: if runs are slow, apply the §10 playbook (parallel subagents, lower
   thinking level, fewer tools/turn, fix flapping MCP).
10. **Hygiene**: stale tools/subagents in `config` not present in the catalog; duplicates.

Never claim to have applied a change — you only recommend.

---

## 12. When this skill doesn't cover it — read the source

This skill is the mental model, not the full truth, and it can drift. For any
detail it doesn't answer (exact fields, current behavior, a flag, an edge case),
**read the actual code via the `bitbucket` subagent** before answering. Prefer the
source over guessing; cite the file you read.

Repos: `xyne-claw-auth` (gateway + DB + MCP), `xyne-claw` (agent runtime),
`xyne-claw-shared` (shared types, tools, subagent/skill definitions).

**Code map — where to look:**
- **Data model / every config field** → `xyne-claw-auth/backend/prisma/schema.prisma`
  (Agent, AgentTool, AgentSkill, AgentMcpConnection, AgentProviderCredentials,
  McpServer, GlobalMcpCredentials, UserMcpConnection, SubagentDefinition, Skill).
- **MCP** → `xyne-claw-auth/backend/src/mcp/`: `static-adapters.ts` (registry),
  `adapters/*` (per-server), `connector-definitions.ts` (resolution),
  `runner.ts` (spawn/cache), `provision.ts` (install), `types.ts`.
- **Credential resolution / levels** → `src/lib/credentials-loader.ts`
  (agent→user→global order), `src/lib/agent-provider-config.ts` (headless providers).
- **Provider resolution at runtime** → `src/routes/webhook.ts` (buildProviderConfig,
  providerAlwaysOn modes).
- **Tools catalog** → `src/routes/tools.ts` (buildAvailableToolsCatalog).
- **Agents API / config validation** → `src/routes/agents.ts`,
  `src/lib/agent-config-validation.ts`.
- **Workflows / automations** → `src/routes/chain-workflows.ts`, `scheduled-jobs.ts`.
- **Memory** → `src/routes/memory.ts`, `services/memoryCronService.ts`,
  `xyne-claw/src/curator.ts`, `xyne-claw-shared/src/memory/`.
- **Runtime loop / latency** → `xyne-claw/src/agent.ts`, `src/routes/run.ts`,
  `src/subagent-tools.ts`, `src/mid-turn-compaction.ts`, `src/tool-output.ts`,
  `src/provider-fallback.ts`, `src/metrics.ts`.
- **Subagent & skill definitions (built-ins)** → `xyne-claw-shared/src/tools/`,
  `xyne-claw-shared/src/subagents/`.

Rule of thumb: **this skill first** for the concept, **bitbucket subagent** to confirm
specifics or answer anything uncovered. Read-only — never modify the repos.