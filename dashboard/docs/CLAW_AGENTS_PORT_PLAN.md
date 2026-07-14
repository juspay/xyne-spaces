# Claw Agents — Port Plan (source → dashboard)

**Status:** Living plan. Branch `feature/claw-settings-dashboard-toggle`.
This doc now focuses on the **remaining work**; completed work is summarized in §2.

---

## 1. Orientation (how we port)

| | Path | Role |
|---|---|---|
| **Source of truth** | `../xyne-spaces/xyne-claw-auth/frontend/src` | Reference app, port **from**. `v3/*` is canonical; ignore `v1`/`v2` except where `v3` delegates. |
| **Destination** | `dashboard/src` | Port **to**, embedded in the Spaces dashboard. |

**Where to look in the source:** `v3/AppV3.tsx` (routes) → `v3/components/*PageV3.tsx`
(page orchestrators) → `v3/components/agent-detail/*` and feature dirs
(`subagents/`) → `v3/lib/*` (pure logic) → `v3/hooks/*` → `lib/api.ts` (the one
fetch layer; every endpoint lives here).

**Port the behaviour, not the shape.** The dashboard deliberately re-shapes the
source. When porting, adapt to the dashboard's stack:

- **Data:** source has no data-fetch lib → dashboard uses **react-query**. New
  calls get a `services/claw/*Service.ts` fn + a `useClaw*` hook with a query
  key; writes invalidate the relevant keys.
- **Transport:** route through `clawRequest` (raw, un-enveloped responses like
  `/metrics`, `/runs`) or `clawApiRequest` (unwraps `{success,data}`, e.g.
  `/agents`, `/subagents`, `/organizations`). Both resolve
  `VITE_CLAW_API_BASE_URL || '/claw'` + `/api/v1`, cookie auth, `x-user-id` header.
- **Toasts:** `sonner` (`toast.*`), not `Snackbar`. **Icons:** `lucide-react`,
  not phosphor. **Styling:** semantic tokens (`text-foreground`, `bg-muted`,
  `border-border`, `text-destructive`), not `zinc-*`/`xyne-*`. Literal
  hex/palette colors are fine for charts and data-viz accents only.
- **Admin:** use `useIsClawAdmin()`; ownership-only actions must re-check
  `agent.ownerUserId === userId` directly (admins are promoted to `owner` in
  `getAgentPermissions`, so `role === 'owner'` is NOT an ownership check).

**Permission contract** (`services/claw/agentPermissions.ts`) —
`getAgentPermissions(agent, userId, shares, isAdmin) → { role, canEdit, canShare,
canViewPage }`. `canEdit` = owner|editor|contributor, `canShare` = owner,
`canViewPage` = role !== none. Thread `permissions` into every editable surface
and disable inputs when `!canEdit` (see `BehaviourTab` for the pattern).

---

## 2. Done so far (brief)

The agents flow is complete and navigable end-to-end; all services hit the real
claw-auth backend (no mocks).

- **Creation** — 5-step wizard (Identity → Persona → Toolbox → Knowledge →
  Review), live name check, two-phase create.
- **Viewing / editing** — detail screen with permissioned tabs: Persona, Tools,
  Knowledge, Behaviour, Model & Provider, People, Memory, Connections, Schedule,
  Activity (+ owner-only Requests). Editable tabs gated by `permissions`.
- **Lifecycle** — real admin status (`useIsClawAdmin`), admin Promote/Demote,
  owner-only Publish/Delete/Rename-handle/Model-change/Clone-review, clone-request
  inbox, prompt version history + activation.
- **Metrics route** (`/claw-agents/metrics`) — workspace + per-agent latency /
  throughput / sentiment / improvements, admin org-scope toggle. Reviewed as
  high-fidelity; one cosmetic follow-up open (see §6).
- **Activity / run history** — real per-agent run feed with status filtering,
  permission-gated all-users scope, and run-owner filtering.
- **Subagents** — builtin/custom list, create and four-tab edit experience,
  preview panel, enable/disable lifecycle, contributor management, and
  permission-aware read-only treatment for builtins.
- **Organization** — caller-org details and membership table, with OWNER/ADMIN
  add/change/remove controls and a read-only MEMBER experience.
- **Housekeeping** — consolidated `clawRequest`/`ClawApiError`; dead branch removed.
- **Route access** — `/claw-agents` is open to all authenticated dashboard users;
  per-agent permissions + backend ACL gate view/edit (no `ResourceProtectedRoute`).

**Deliberately not ported:** chain workflows (`WorkflowsTab`).

---

## 3. Completed work items

Three work items, in priority order. Each is independently shippable; verify
against the named source files and gate with `permissions`.

### ✅ Step 1 — Activity: show all runs (agent run history)

**Goal:** replace the Activity tab's lifecycle-only summary with the real run
history feed, including the admin/contributor "all users' runs" view.

**Source:** `v3/components/agent-detail/tabs/RunHistoryTab.tsx`. API:
`listRuns` / `getRun` in `lib/api.ts`.

| Endpoint | Notes |
|---|---|
| `GET /runs?agentSlug=&status=&limit=&scope=all` (`x-user-id`) | `scope=all` = every user's runs of this agent (server enforces admin/contributor + ACL); requires `agentSlug`. Returns `AgentRun[]`. |
| `GET /runs/:sessionId` (`x-user-id`) | Single run detail (optional, for drill-in). |

**Type:** port `AgentRun` (status `running|completed|failed|cancelled`,
`triggerSource spaces|scheduled|chat|api`, `task`, timing breakdown `totalMs /
llmTotalMs / toolMs / ttftMs`, tokens, `toolsUsed`, `userName/userEmail` for the
all-runs owner label).

**Build:**
1. `services/claw/clawRunsService.ts` (`listAgentRuns`, `getAgentRun`) +
   `clawRunsTypes.ts` (`AgentRun`, `ToolInvocation`).
2. `hooks/useClawAgentRuns(slug, { status, allUsers })` — key includes
   slug/status/allUsers/userId; `enabled` on slug.
3. Rewrite `tabs/ActivityTab.tsx`: run list with status icon, trigger label,
   task, relative time + duration; **status filter**; **"all users" toggle only
   when `permissions.canEdit`** (maps to `allUsers` → `scope=all`), with an owner
   filter using `runName || runEmail || user <id8>`. Keep the existing
   lifecycle/prompt-version summary above or beside the feed.

**Gate:** all-runs (`scope=all`) only when `canEdit`; non-privileged users see
their own runs of the agent.

**Verify:** owner/contributor sees all users' runs + owner filter; viewer sees
only their own; status filter works; empty/loading/error states.

**Verification status:** targeted formatting/ESLint, full dashboard typecheck,
`git diff --check`, and the production build are clean. Authenticated role-matrix
runtime checks remain to be exercised in a signed-in session.

### ✅ Step 2 — Subagents (entire section)

**Goal:** port the full subagents area — list, create, edit (Persona / Knowledge
/ Tools / Contributors), enable-toggle, delete, and sharing. Nothing exists in
the dashboard yet; this is the largest item.

**Source:** `v3/components/SubagentsPageV3.tsx` (list, ~308 lines),
`SubagentEditPageV3.tsx` (edit, ~462 lines, tabs `persona|knowledge|tools|
contributors`), `v3/components/subagents/*` (Row, SlideOver, PersonaTab,
KnowledgeTab, ToolsTab, ContributorsTab, EditHeader, EditSkeleton, NotFound),
`dialogs/CreateSubagentDialog.tsx`, hooks `useSubagents` / `useSubagentDetail`.

| Endpoint | Purpose |
|---|---|
| `GET /subagents` | List (`SubagentDef[]`; `source: builtin|custom`). |
| `POST /subagents` | Create custom (`SubagentInputBody`). |
| `GET /subagents/:name` | Detail. |
| `PUT /subagents/:name` | Update. |
| `DELETE /subagents/:name` | Delete (custom only). |
| `POST /subagents/:name/enable` | Enable/disable. |
| `GET/POST/DELETE /subagents/:name/shares[/:userId]` | Contributors. |

**Type:** `SubagentDef` (builtin exposes `serverType`; custom exposes
`tools.{direct,custom}`, `mcpInstanceMap`, `skills`, `shares`, creator fields),
`SubagentInputBody`, `SubagentShareEntry`.

**Build:**
1. `services/claw/clawSubagentsService.ts` + `clawSubagentsTypes.ts`.
2. Hooks: `useClawSubagents` (list), `useClawSubagentDetail(name)`,
   `useCreateClawSubagent`, mutations for update / enable / delete / shares
   (invalidate `['claw-subagents']` + the detail key).
3. Routes under `claw-agents`: `subagents` (list),
   `subagents/:subagentName` (edit). Add a **Subagents** entry to
   `ClawAgentsSidebar`.
4. Components in `components/ClawAgents/subagents/`: list rows + slide-over peek,
   create dialog, edit screen with the 4 tabs. Reuse `ToolboxPicker` /
   `KnowledgeBasePicker` / share UI patterns from the agent detail port.

**Gate:** builtin subagents are read-only (no delete); custom edit/delete/share
follow the same owner/contributor rules as agents (creator = owner; `shares`
drive editor/contributor/viewer).

**Verify:** list shows builtin + custom; create → edit; persona/tools/knowledge
save; enable toggle; contributor add/remove; delete custom only; builtin stays
read-only.

**Verification status:** targeted formatting/ESLint, full dashboard typecheck,
`git diff --check`, and the production build are clean. Runtime role-matrix and
backend integration checks remain to be exercised in a signed-in session.

### ✅ Step 3 — Organization section

**Goal:** port phase-1 org management — show the caller's org (details + member
list); OWNER/ADMIN can add members, change roles, and remove members; members
get a read-only view.

**Source:** `v3/components/OrganizationsPageV3.tsx`. (Source itself defers org
creation, invitations, workspaces, delete, ownership transfer — keep those out.)

| Endpoint (`x-user-id`) | Purpose |
|---|---|
| `GET /organizations` | Caller's orgs (`OrgSummary[]`; one-org-per-user). |
| `GET /organizations/:id` | `OrgDetail` incl. `members: OrgMemberRow[]`. |
| `POST /organizations/:id/members` `{ userIdOrEmail, role }` | Add member (ADMIN/MEMBER). |
| `PATCH /organizations/:id/members/:userId` `{ role }` | Change role. |
| `DELETE /organizations/:id/members/:userId` | Remove member. |

**Type:** `OrgRole (OWNER|ADMIN|MEMBER)`, `OrgSummary`, `OrgMemberRow`, `OrgDetail`.

**Build:**
1. `services/claw/clawOrgService.ts` + `clawOrgTypes.ts`.
2. Hooks: `useClawOrganization` (list → resolve the single org → detail) +
   add/updateRole/remove member mutations (invalidate the org detail key).
3. Route `claw-agents/organization` → `ClawOrganizationScreen`; add an
   **Organization** entry to `ClawAgentsSidebar`.
4. Screen: org header (name/description/status), member table with role badges;
   `canManage = role === 'OWNER' || 'ADMIN'` → add-member form (email/id + role
   select), inline role change, remove with `ConfirmDialog`. Members see
   read-only.

**Gate:** `canManage` derived from the caller's own membership role; hide all
mutation UI otherwise.

**Verify:** owner/admin can add (by email or id), change role, remove (with
confirm); member sees read-only; toasts + invalidation on each mutation.

**Verification status:** targeted formatting/ESLint, full dashboard typecheck,
`git diff --check`, and the production build are clean. The UI additionally
prevents ADMIN users from attempting OWNER-only role changes enforced by the
backend. Authenticated OWNER/ADMIN/MEMBER runtime checks remain to be exercised
in a signed-in session.

---

## 4. Shared conventions for all three steps

- One `*Service.ts` + `*Types.ts` per domain; go through `clawRequest` /
  `clawApiRequest`. Match source endpoints/verbs/params exactly.
- One `useClaw*` hook per read; mutations invalidate the right keys. Include
  `userId` in keys; guard `enabled` on required params.
- Reuse existing building blocks: `ConfirmDialog`, `MetricsCard`-style cards,
  `ToolboxPicker`, `KnowledgeBasePicker`, share/contributor UI, `Skeleton`,
  `errText` 403 handling.
- Register routes under the `claw-agents` children in `routes/AppRoot.tsx` and
  add nav entries in `components/ClawAgents/ClawAgentsSidebar.tsx`.

---

## 5. Verification checklist (per step)

- Typecheck + targeted ESLint + prod build clean.
- Role matrix exercised (owner / editor / contributor / viewer / admin, or
  OWNER/ADMIN/MEMBER for orgs).
- Writes invalidate their query keys; no stale UI after mutate.
- 403 → "You don't have permission to do that" (`errText`).
- Loading / empty / error states present.

---

## 6. Open follow-ups (low priority)

- **Metrics dark-mode tooltip** — the port uses recharts' default (light) tooltip
  box; restore a themed tooltip for dark-mode readability
  (`components/ClawAgents/metrics/MetricsCharts.tsx`).
- **Route protection** — `/claw-agents` is currently open to all authenticated
  users. If gating is later desired, wrap the route in `ResourceProtectedRoute`.

---

## 7. File index

**Dashboard:** `routes/ClawAgentsScreen/*`, `components/ClawAgents/*`,
`hooks/useClaw*.ts`, `services/claw/*`. Wiring: `routes/AppRoot.tsx` (claw-agents
children), `components/ClawAgents/ClawAgentsSidebar.tsx`.

**Source (reference for the next steps):**
- Step 1: `v3/components/agent-detail/tabs/RunHistoryTab.tsx`; `listRuns`/`getRun`.
- Step 2: `v3/components/SubagentsPageV3.tsx`, `SubagentEditPageV3.tsx`,
  `v3/components/subagents/*`, `dialogs/CreateSubagentDialog.tsx`,
  `v3/hooks/useSubagents.ts` / `useSubagentDetail.ts`.
- Step 3: `v3/components/OrganizationsPageV3.tsx`; the `/organizations` fns in
  `lib/api.ts`.
