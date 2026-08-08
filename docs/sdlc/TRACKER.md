# AI SDLC Hub v1 — Implementation Tracker

This tracker is the delivery checklist for [PRD.md](./PRD.md). A box is complete only when code exists and listed evidence passes. No new automated tests are required for v1.

Legend: `[ ]` not started, `[~]` in progress, `[x]` complete, `[!]` blocked.

## T0 — Product and architecture source of truth

- [x] T0.1 Record product goals, non-goals, users, ACLs, information architecture, lifecycle, failure behavior, and acceptance criteria.
- [x] T0.2 Lock repository-scoped hidden Channel + flat Baseline/PRDs/Tech Docs folders.
- [x] T0.3 Lock one shared Project SDLC Board and existing Tickets as Tickets.
- [x] T0.4 Lock five baseline documents, manual approval/upsert, and all-five coding gate.
- [x] T0.5 Lock one generic entity-link table and actual-source-only policy.
- [x] T0.6 Lock deep `SdlcHub` boundary and thin route/Zero/job adapters.
- [x] T0.7 Lock desktop-only v1 and no-new-automated-tests constraint.

Evidence: `docs/sdlc/PRD.md`.

## T1 — Persistence and shared contracts

- [x] T1.1 Extend `Repo` with Project, hidden Channel, canonical URL, and setup execution relations/fields.
- [x] T1.2 Extend `Project` with optional shared SDLC Board relation.
- [x] T1.3 Add `SdlcEntityLink` with duplicate guard and lookup indexes; add safe 1:1 indexes in migration if supported.
- [x] T1.4 Add migration preserving legacy Repo rows and existing uniqueness behavior.
- [x] T1.5 Mirror fields/table/relations in shared Zero schema.
- [x] T1.6 Add shared Zod unions/input/output types without new Prisma enums.
- [x] T1.7 Generate Prisma client and build shared package.

Evidence: Prisma schema + migration, shared schema/types, generated client, shared build.

## T2 — Deep SDLC backend module

- [x] T2.1 Create `SdlcHub` public interface and input/result contracts.
- [x] T2.2 Centralize repository membership/admin authorization.
- [x] T2.3 Implement repository URL canonicalization and workspace duplicate detection.
- [x] T2.4 Implement transactional `attachRepository` cheap shell.
- [x] T2.5 Implement Project SDLC Board/stage ensure logic.
- [x] T2.6 Implement setup idempotency, durable-state derivation, and single-active-run rule.
- [x] T2.7 Implement artifact creation/folder routing/cardinality.
- [x] T2.8 Implement link/unlink duplicate and source-ACL rules.
- [x] T2.9 Implement baseline approval authorization/upsert and all-five approval gate.
- [x] T2.10 Implement Ticket reuse/creation and stage movement.
- [x] T2.11 Implement `startWork` preconditions/context assembly/delegation.

Evidence: module source, callers use interface rather than duplicating invariants, backend typecheck/lint.

## T3 — Repository attachment and visibility

- [x] T3.1 Add Zod-validated attach route and stable error responses.
- [x] T3.2 Add backend + dashboard Zero reads scoped by hidden-channel membership.
- [x] T3.3 Keep legacy Repo behavior compatible where Project/Channel fields are absent.
- [x] T3.4 Filter SDLC hidden Channels from normal Chat surfaces.
- [x] T3.5 Add Project Detail **Add Repository** dialog/action. This records the current implementation;
      the workspace-credential phase later moves the action into the new Repos tab.
- [x] T3.6 Show attach success and **Take to SDLC** navigation.
- [x] T3.7 Add repository member management entry for admins using existing Channel participation.

Evidence: API/manual attach, database rows, member/non-member UI, Chat navigation inspection.

## T4 — Baseline setup workflow

- [x] T4.1 Register ticketless durable setup workflow and execution state.
- [x] T4.2 Acquire Redis lock while treating DB execution as durable truth.
- [x] T4.3 Validate clone allowlist and clone one base-branch commit.
- [x] T4.4 Analyze repository with generated/vendor/trivial exclusions.
- [x] T4.5 Generate Core Code Map canvas with paths/symbols/function chains.
- [x] T4.6 Generate Frontend Design System canvas or explicit no-frontend result.
- [x] T4.7 Generate Code & Lint Standards canvas.
- [x] T4.8 Generate Run Guide canvas without secret values.
- [x] T4.9 Generate Test Guide canvas from existing test setup.
- [x] T4.10 Persist each canvas and metadata immediately with admin/member sharing policy.
- [x] T4.11 Publish live progress and expose refresh-safe durable progress read model.
- [x] T4.12 Implement retry/resume from first incomplete document without duplication.
- [x] T4.13 Surface actionable clone/generation failures.
- [x] T4.14 Expose admin cancel/restart, reject stale callbacks, and terminalize unreconcilable runs.

Evidence: setup execution + five canvases from one commit, forced interruption/retry manual smoke, logs/state inspection.

## T5 — Baseline review and permanent memory

- [x] T5.1 Allow repository admins to edit baseline canvases; members remain viewers.
- [x] T5.2 Add reusable **Approve memory** action.
- [x] T5.3 Upsert one Knowledge Document per baseline canvas on first/repeated approval.
- [x] T5.4 Persist approval user/time/Knowledge Document ID metadata.
- [x] T5.5 Compute and expose five-document approval gate.
- [x] T5.6 Preserve legacy knowledge-approval behavior outside SDLC.

Evidence: two approvals update one Knowledge Document; role smoke; coding gate state.

## T6 — PRDs, Tech Docs, Tickets

- [x] T6.1 Add create/edit/list/open flows for PRD canvases.
- [x] T6.2 Add create/edit/list/open flows for Tech Doc canvases.
- [x] T6.3 Add Ticket creation using existing Ticket on Project SDLC Board Backlog.
- [x] T6.4 Enforce PRD→Tech Doc optional 1:1.
- [x] T6.5 Enforce PRD/Tech Doc→Ticket optional 1:1.
- [x] T6.6 Starting from PRD/Tech Doc reuses linked Ticket or creates one.
- [x] T6.7 Add AI actions that create directly editable drafts.

Evidence: manual chain creation, duplicate attempt returns 409, rows/canvases/ticket inspect correctly.

## T7 — Generic related context

- [x] T7.1 Add link/unlink routes and mirrored Zero query/mutator surfaces.
- [x] T7.2 Support canvases, tickets, channels, conversations, messages/threads, emails, calls, recordings, attachments, and PR IDs.
- [x] T7.3 Reuse existing context picker in Related drawer.
- [x] T7.4 Enforce source ACL on create/read; inaccessible sources never leak title/content.
- [x] T7.5 Record only explicit or actually retrieved/cited AI sources.
- [x] T7.6 Show truthful linked-item counts and empty states.

Evidence: add/remove each available source class, duplicate/unauthorized attempts, UI refresh persistence.

## T8 — SDLC desktop experience

- [x] T8.1 Add global `/sdlc` route and navigation item.
- [x] T8.2 Build member-scoped repository list/empty/loading/error states.
- [x] T8.3 Build repository/module rail for Overview/Baseline/PRDs/Tech Docs/Tickets.
- [x] T8.4 Build Overview summary and setup/progress/retry states.
- [x] T8.5 Build baseline cards/review/approval status.
- [x] T8.6 Build artifact lists and existing Canvas/Ticket editor navigation.
- [x] T8.7 Build accurate PRD→Tech Doc→Ticket→PR trace spine.
- [x] T8.8 Build a canvas-scoped Related drawer that opens only on explicit user action and remains absent from Overview.
- [x] T8.9 Integrate persistent Xyne AI sidebar in SDLC mode.
- [x] T8.10 Reuse existing tokens/components; meet desktop keyboard/focus/accessibility behavior.
- [x] T8.11 Keep derived UI state computed during render; effects only synchronize external systems.
- [x] T8.12 Show generated-document progress, last durable update, cancel/restart controls, and terminal failure
      state.

Evidence: desktop manual walkthrough at relevant loading/empty/partial/ready states; dashboard build/lint.

## T9 — AI context and code answers

- [x] T9.1 Assemble approved baseline memory in deterministic order.
- [x] T9.2 Add current artifact chain and authorized linked sources.
- [x] T9.3 Include hidden repository Channel conversation history.
- [x] T9.4 Require explicit selection/authorized retrieval for wider workspace context.
- [x] T9.5 Provide read-only live repository tools for code Q&A.
- [x] T9.6 Render exact relevant snippet with path, symbol, and line range; do not create code Vespa index.
- [x] T9.7 Store agent-created links only for real inputs/retrieval/citations.

Evidence: AI prompt/context inspection and answers against known functions; ACL smoke with second user.

## T10 — Start Work and PR lifecycle

- [x] T10.1 Add start-work route/UI from Ticket, PRD, and Tech Doc.
- [x] T10.2 Block before five approvals and on conflicting active Ticket execution.
- [x] T10.3 Launch one coding agent with approved baseline/current chain/linked context/channel history/tools.
- [x] T10.4 Create a safe non-default branch, edit, run safe repository checks, commit, push, and open draft PR.
- [x] T10.5 Never merge from agent workflow.
- [x] T10.6 Move Ticket to In Progress on start.
- [x] T10.7 Move Ticket to In Review on PR create/update.
- [x] T10.8 Move Ticket to Done on merge using provider-adapter reconciliation; do not require repository
      webhook installation.
- [x] T10.9 Display linked PR status in trace spine/Ticket.

Evidence: dry/manual run in test repository, remote draft PR, ticket stages, workflow state/log inspection.

## T11 — Verification and delivery audit

- [x] T11.1 `pnpm --filter @xyne/shared build`
- [x] T11.2 `pnpm --filter xyne-spaces-backend typecheck`
- [x] T11.3 Run backend lint and isolate the repository baseline — the full command reports 252 unrelated existing errors; every changed SDLC surface passes targeted lint.
- [x] T11.4 `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter xyne-spaces-dashboard build`.
- [x] T11.5 `pnpm --filter xyne-spaces-dashboard lint` (passes with the repository's existing warnings).
- [x] T11.6 `pnpm test:enum`
- [x] T11.7 Inspect migration against existing data/nullability/uniqueness.
- [x] T11.8 Audit every PRD acceptance criterion against authoritative code and available runtime evidence. Local service smoke proved repository attachment, canonical duplicate rejection, folder/board/stage/admin creation, durable setup execution, Redis job creation, current-schema materialization, and direct SDLC migration application.
- [x] T11.9 Record known v1 limitations without marking incomplete scope complete.

Evidence: command output and final criterion-by-criterion audit.

## T12 — Claw-first SDLC migration

- [x] T12.1 Route baseline, AI artifact generation, and Start Work through the existing Claw `ask-ai` agent; remove the local SDLC AI executors.
- [x] T12.2 Add an S2S-only SDLC execution profile that overlays tools/output contracts without creating a new agent.
- [x] T12.3 Add run-scoped public GitHub repository pinning and safe dynamic sandbox setup.
- [x] T12.4 Add the narrow `spaces-sdlc-create-artifact` tool and backend-owned folder/ACL/metadata validation.
- [x] T12.5 Create baseline canvases sequentially and AI artifacts directly, without placeholder canvases.
- [x] T12.6 Persist Claw conversation/session identity, process S2S callbacks, and reconcile stale executions against Claw run state.
- [x] T12.7 Validate returned pull requests belong to the attached repository before linking and moving a Ticket to In Review.
- [x] T12.8 Give SDLC Ask AI the repository/tool context required to create PRDs and Tech Docs from chat.
- [x] T12.9 Reuse the Ask AI debug panel with repository-admin authorization for baseline runs.
- [x] T12.10 Automatically queue baseline setup after repository attachment while retaining explicit
      setup/retry fallbacks. This records the current implementation; the workspace-credential phase replaces
      automatic baseline dispatch with the approved access-check/manual-Next flow.
- [x] T12.11 Run a live configured Claw smoke: attach public repo → five canvases → debug trace → AI PRD/Tech Doc → draft PR.

Evidence: Claw webhook profile, sandbox metadata bridge, SDLC artifact tool/route, execution callback
service, dashboard debug panel, shared/backend/dashboard/Claw typechecks, and a configured live smoke.

## T13 — Workspace VCS credential source of truth

- [x] T13.1 Decide v1 provider/auth scope: GitHub.com fine-grained PAT, one credential and one GitHub
      resource owner per workspace.
- [x] T13.2 Decide credential ownership: workspace owner/admin manages; project-authorized users consume
      capability without reading secret.
- [x] T13.3 Decide provider-neutral deep `SdlcVcs` module with internal provider adapter seam; GitHub is
      first adapter and legacy Bitbucket remains untouched.
- [x] T13.4 Decide Project Detail `Boards → Repos → Release` information architecture.
- [x] T13.5 Decide progressive gate: access check → manual baseline Next → five approvals → artifacts;
      Start Work additionally requires push/PR capability.
- [x] T13.6 Decide direct-repository feature-branch push and no fork flow for v1.
- [x] T13.7 Accept/document v1 PAT sandbox exposure and instruction-only branch restriction; defer
      broker/backend-finalization and transport ref enforcement.
- [x] T13.8 Record implementation plan, PRD changes, and v2 decision register.

Evidence: `docs/sdlc/VCS_CREDENTIALS_PLAN.md`, `docs/sdlc/DECISIONS_NEEDED_FOR_V2.md`, and updated
`docs/sdlc/PRD.md`.

## T14 — Credential persistence, ACL, and lifecycle

- [x] T14.1 Add workspace/provider credential persistence with versioned authenticated-encryption metadata,
      revision, validation metadata, identity, actors, and timestamps. T21.4 moved the delivered persistence
      from the temporary `SdlcVcsCredential` model into a dedicated `ExternalSource` type.
- [x] T14.2 Extend `Repo` with provider-neutral access status, normalized capabilities/evidence, credential
      revision, identity/visibility, checked time, and stable error fields.
- [x] T14.3 Add a safe migration preserving existing Repo rows, baseline approvals, and legacy provider data.
- [x] T14.4 Implement authenticated credential encryption; do not reuse unauthenticated AES-CBC for PATs.
- [x] T14.5 Add workspace owner/admin checks for configure/replace/disconnect and project/repository checks
      for credential consumption.
- [x] T14.6 Validate replacement before atomic swap; disconnect/replacement increments revision and marks
      all workspace GitHub repository checks stale.
- [x] T14.7 Ensure no user-facing API/Zero/query/log path returns ciphertext, plaintext, helper contents, or
      reversible token fragments; the S2S bootstrap returns only a sandbox-public-key-bound encrypted envelope.
- [x] T14.8 Emit metadata-only audit events for credential create/validate/replace/disconnect.

Evidence: migration/schema inspection, ACL attempts by owner/admin/member, DB ciphertext inspection,
response/Zero/log secret audit.

## T15 — Deep `SdlcVcs` module and GitHub adapter

- [x] T15.1 Define the small `SdlcVcs` interface for credential lifecycle, repository access checks,
      capability gates, runtime grants, draft PR creation, and PR validation.
- [x] T15.2 Define the internal `VcsProviderAdapter` seam with provider-neutral inputs/results.
- [x] T15.3 Implement `GitHubVcsAdapter` for GitHub.com URL parsing/canonicalization, identity validation,
      repository/branch inspection, Git authentication, draft PR creation, and PR URL validation.
- [x] T15.4 Move SDLC GitHub URL/PR assumptions behind the new module; SDLC callers stop using legacy
      `getGitProvider` and deployment `GITHUB_TOKEN`.
- [x] T15.5 Normalize `READ_REPOSITORY`, `PUSH_BRANCH`, and `CREATE_PULL_REQUEST` capability evidence and
      distinguish proven, inferred/required, stale, and runtime-failed states.
- [x] T15.6 Keep provider payload and owner/repo parsing private to the adapter so future Bitbucket/GitLab
      adapters need no generic route/gate/schema change.
- [x] T15.7 Translate GitHub auth, org-approval, resource-owner, repository, branch, rate-limit, and outage
      failures into stable actionable errors.

Evidence: module interface review/deletion test, direct callers use the module, configured API probes,
targeted lint/typecheck.

## T16 — Workspace settings and Project Repos tab

- [x] T16.1 Add Workspace Management repository-credential settings following existing tab/card patterns.
- [x] T16.2 Show GitHub.com fine-grained PAT setup guidance, one-resource-owner limitation, intended minimum
      permissions, masked input, and **Validate and save**.
- [x] T16.3 Show connected metadata only: identity, resource owner, fingerprint, validation state/time,
      attached repository count, replace/revalidate/disconnect actions.
- [x] T16.4 Hide mutation actions from non-admins and enforce identical backend authorization.
- [x] T16.5 Change Project Detail tabs to `Boards → Repos → Release` and move Add Repository into Repos.
- [x] T16.6 Build Repos list/empty/loading/error states with provider, visibility, base branch, capabilities,
      setup state, Check/Retry, and Open SDLC actions.
- [x] T16.7 Allow users with existing project-board-management access to attach public/private repos;
      never reveal shared credential material.
- [x] T16.8 Show administrator settings link or non-admin **Ask a workspace admin** remediation.

Evidence: role walkthrough, tab order/keyboard/focus inspection, public/private attach walkthrough,
dashboard typecheck/lint.

## T17 — Durable access check and progressive setup gate

- [x] T17.1 Attachment commits the existing cheap shell, then queues one durable non-mutating access check;
      remove automatic baseline dispatch for new repositories.
- [x] T17.2 Enforce one active check, PostgreSQL truth, Redis coordination only, refresh-safe progress, retry,
      and credential-revision staleness.
- [x] T17.3 Check identity, repository/visibility, configured base branch, API read, and authenticated
      `git ls-remote` without creating remote resources.
- [x] T17.4 Support anonymous public read fallback and credentialed private read; label fallback/invalid-token
      state truthfully.
- [x] T17.5 Present capability evidence and enable **Next: Generate baseline** only after proven read access.
- [x] T17.6 Require repository admin for baseline start; preserve existing setup retry/cancel/restart/debug.
- [x] T17.7 Lock PRD, Tech Doc, Ticket, and AI artifact UI/actions until read is ready and all
      five baseline documents are approved.
- [x] T17.8 Enforce the same artifact gates inside `SdlcHub`; crafted route/tool calls cannot bypass them.
- [x] T17.9 Require current read/push/PR capability plus approvals in `startWork`.
- [x] T17.10 Preserve existing approved/artifact data during rollout; require a fresh check before new
      mutable actions rather than deleting or rolling back data.

Evidence: durable state/refresh walkthrough, route bypass attempts, public/read-only/private/full capability
matrix, baseline/artifact/Start Work gate inspection.

## T18 — Runtime credential delivery, private clone, and draft PR

- [x] T18.1 Add opaque runtime grants bound to execution, session, workspace, repository, provider,
      operation, credential revision, and expiry.
- [x] T18.2 Add S2S-only grant redemption; reject replay, expiry, wrong execution/session/repository, stale
      credential, and inactive workflow.
- [x] T18.3 Keep runtime grant IDs backend-only. Forward durable execution/repository/session binding through
      authoritative SDLC context; never serialize PAT or grant ID into workflow/queue/prompt/conversation/debug/Redis/Zero state.
- [x] T18.4 Extend dynamic sandbox setup for credentialed private clone/fetch and direct push using a
      restrictive temporary Git credential helper with cleanup.
- [x] T18.5 Keep public no-credential clone path working.
- [x] T18.6 Capture repository branch conventions in approved Code & Lint Standards and validate the safe
      non-default branch returned by the agent.
- [x] T18.7 Update agent instructions: use only a convention-conforming work branch; never base/default branch, force-push, or
      merge. Do not claim this is a hard v1 enforcement control.
- [x] T18.8 Add narrow `spaces-sdlc-create-pull-request`/backend route using `SdlcVcs` and workspace PAT;
      do not sync PAT to generic Claw user/global MCP credential stores.
- [x] T18.9 Validate remote commit and draft PR provider/repository/base/head before callback success and
      ticket movement.
- [x] T18.10 On clone/push/PR 401/403, mark capability stale/blocked and surface credential revalidation.
- [x] T18.11 Extend redaction/path guards for fine-grained PAT, authenticated URLs, helpers, Git config,
      command errors, and callbacks.

Evidence: private clone, branch/commit/direct push/draft PR in disposable repo; secret absence audit;
grant negative cases; callback/provider/repo/head validation.

## T19 — Verification, rollout, and delivery audit

- [x] T19.1 `pnpm --filter @xyne/shared build`.
- [x] T19.2 Backend typecheck plus targeted lint for every changed credential/SDLC surface.
- [x] T19.3 Dashboard typecheck and lint.
- [x] T19.4 Claw auth/runtime/shared/Kata package typechecks for changed runtime-secret surfaces.
- [x] T19.5 `pnpm test:enum` and migration application/inspection against current data.
- [x] T19.6 Static audit that PAT/ciphertext never enters user-facing API responses, Zero, logs,
      workflow/queue context, Redis progress, prompts, conversations, or debug bundles; exclude the intentional
      one-use S2S redemption response.
- [x] T19.7 Run the agreed basic configured sanity: credential replacement, access check, authenticated clone,
      feature-branch push, draft PR, merge reconciliation, and secret-free persisted execution state. The broader
      public/no-token, invalid-token, org-approval, private-read, wrong-owner, missing-branch, disconnect, and role
      matrix remains explicitly assigned to user acceptance in `VCS_CREDENTIALS_RUNBOOK.md`.
- [x] T19.8 Exercise strict-gate bypass paths for baseline, artifact commands, AI tools, and Start Work.
      Focused policy sanity plus backend call-site inspection confirms read/approval/push/PR gates run before mutation.
- [x] T19.9 Configured credentialed end-to-end smoke: public fork attach → check → manual baseline Next → five
      approvals → PRD/Tech Doc/Ticket → convention-derived safe feature branch → draft PR → merge → Ticket Done.
      This exercised the same one-use grant and sandbox credential-helper path used by private repositories; private
      repository visibility remains a user-acceptance case per T19.7.
- [x] T19.10 Confirm legacy Bitbucket, Release, commit-analysis, webhook, and deployment GitHub paths remain
      behaviorally unchanged. SDLC uses its new module/profile; legacy provider callers retain the default non-draft
      path, and webhook SDLC configuration is S2S/profile-conditional.
- [x] T19.11 Roll out behind a workspace flag until configured smoke passes; document rollback and known v1
      security limitations.
- [x] T19.12 Audit every new PRD/VCS-plan acceptance criterion against code and runtime evidence.

Evidence: command output, migration result, manual evidence, token non-disclosure audit, disposable remote
branch/PR, criterion-by-criterion delivery report.

## T20 — Imported repository Wiki

- [x] T20.1 Add a repository-scoped Wiki screen backed by private Canvas documents and a source-path tree.
- [x] T20.2 Add an operator-run Research Agent importer that fetches Markdown with pagination and upserts one
      Canvas per source path without deleting absent pages.
- [x] T20.3 Sync imported pages to Y-Sweet and Vespa so repository members can open and cite them through
      existing Canvas/search infrastructure.
- [x] T20.4 Keep Wiki metadata out of the core SDLC Zero payload and authorize its dedicated listing route by
      hidden repository-channel membership.
- [x] T20.5 Give interactive SDLC questions multi-source retrieval instructions without modifying setup,
      artifact-generation, or Start Work execution profiles.

Deferred: agentic Wiki generation, scheduled refresh, drift detection, source-link reconciliation, and
clickable commit-pinned code citations.

## T21 — Code cleanup

- [x] T21.1 Keep legacy required `Repo.prefix` schema field unchanged, but remove branch-prefix input and
      behavioral usage from SDLC attach/start-work implementation. SDLC attachment writes an empty string only
      as a database-compatibility placeholder; no SDLC flow reads it or treats it as a branch rule. During
      baseline creation, capture repository Git lint and branch-naming conventions in the Code & Lint Standards
      memory. Agent must create its work branch from those approved baseline conventions instead of a
      server-generated `<prefix>/<ticket-id>` rule. Update SDLC PRD, contracts, UI, prompts, and branch/PR
      validation to match.
- [x] T21.2 Prepare v1 persistence for one hidden SDLC Channel/hub to contain multiple repositories: keep
      nullable `Repo.channelId String?`, remove its uniqueness constraint/index, and change the reverse
      `Channel.sdlcRepo` relation into `Channel.sdlcRepos Repo[]`. Update Prisma, migration SQL,
      generated/shared Zero schemas, relations, queries, and ACL assumptions. Keep v1 attachment behavior
      creating a repository-specific hidden Channel; defer shared-Channel attachment and hub behavior to v2.
- [x] T21.3 Respect datasource `relationMode = "prisma"`: remove every manually added physical SDLC foreign-key
      constraint from the two new migrations, including Project→Board, Repo→Project/Channel/WorkflowExecution,
      SdlcEntityLink→Repo, and SdlcVcsCredential→Workspace. Keep scalar ID columns, Prisma `@relation` fields,
      uniqueness rules, and query indexes. Audit deletion flows so SDLC modules perform required cleanup and do
      not depend on database `CASCADE`/`SET NULL` behavior.
- [x] T21.4 Remove the new `SdlcVcsCredential` model/table and reuse workspace-scoped `ExternalSource` rows for
      long-lived VCS credentials. Use a deterministic workspace/provider source name, dedicated SDLC source type,
      `isActive` lifecycle, and an AES-256-GCM authenticated envelope serialized in `credentials`; retain revision,
      provider identity, validation, fingerprint, and error metadata inside the encrypted payload. Keep the
      `SdlcVcs` interface as the persistence seam, retain `SdlcVcsRuntimeGrant` for one-use Claw delivery, and make
      no Claw database-schema change. Explicitly prevent `ExternalSource.credentials` from entering Zero, public
      reads, logs, queues, workflow context, prompts, conversations, or debug artifacts.
- [x] T21.5 Remove duplicated Repo VCS metadata columns: `vcsProvider`, `vcsRepositoryOwner`,
      `vcsRepositoryName`, `vcsResourceOwner`, `vcsVisibility`, and `vcsDefaultBranch`. Derive provider and
      repository owner/name from `canonicalUrl` through the provider adapter, use existing `baseBranch` as the
      configured SDLC target branch, read credential provider/resource owner from the workspace `ExternalSource`,
      and place cached visibility only inside the consolidated access-check result if the UI still needs it.
- [x] T21.6 Extract one SDLC agent-context wrapper used by every SDLC conversation and execution flow. Build its
      deterministic context from durable state (workspace/project/channel/repository, ticket/artifact, workflow
      execution/session, configured base branch, permissions/gates, and other required IDs/invariants) and inject
      it at the agent seam on initial start, resume, retry, handoff, and every post-compaction continuation. Do not
      rely on IDs or rules surviving conversational history compression, and do not re-inject expired runtime
      grants or secrets. Audit all baseline, artifact, interactive chat, and Start Work entry points to use the
      wrapper instead of assembling context independently.
- [x] T21.7 Move SDLC Git credential provisioning into a sandbox-creation bootstrap module, outside agent
      conversation memory. Each sandbox generates an ephemeral keypair; trusted Claw carries only public-key
      stdout from Kata to the backend and never reads the pod directly. It registers the key against the
      authenticated `sdlc-agent`/workspace/repository/execution/session, receives an authenticated encrypted PAT envelope,
      decrypts it locally, and installs a restrictive temporary Git credential helper. Bind delivery to operation,
      credential revision, expiry, and one-time/replay state; never expose PAT, private key, grant ID, helper path,
      or decryption commands to the agent. Re-provision with a fresh key and envelope when a sandbox is recreated,
      remove all secret/key material on success, failure, cancellation, timeout, and destruction, and retain
      backend-owned remote-SHA/head/base verification plus draft-PR creation. Use vetted cryptographic libraries,
      not custom shell cryptography, and retain the accepted-v1 warning that arbitrary code in the same sandbox can
      access a credential after decryption.
      Bootstrap remains an automatic nested operation of `sandbox-repo-setup`, not a model-controlled upload/run
      tool. After decryption, the sandbox alone calls GitHub `/user` and installs a temporary post-commit hook
      that assigns both author and committer to the PAT account; the derived commit name/email never enters
      backend state, Claw payloads, prompts, or conversations.

Evidence: repository attach has no prefix input; SDLC code writes only the empty compatibility placeholder and
never reads or behaviorally uses `Repo.prefix`; generated baseline records Git branch conventions; Start Work
agent creates and returns a conforming branch; backend validates the returned remote branch and draft PR without
assuming the legacy prefix format. Multiple Repo rows may reference
one Channel without a uniqueness failure, while repository-scoped reads and authorization remain correct. New
SDLC migrations create no physical foreign keys, matching existing Prisma relation-mode policy.

Long-running SDLC execution evidence: force conversation compaction between tool calls, then resume and confirm
the agent receives the same authoritative IDs, scope, gates, and repository rules without stale grants, leaked
secrets, cross-repository context, or caller-specific prompt reconstruction.

Sandbox credential evidence: ciphertext cannot decrypt outside its bound sandbox session; replay, wrong binding,
expiry, and credential-revision mismatch fail; Git push survives conversation compaction in a live sandbox; sandbox
recreation provisions a fresh envelope; teardown leaves no helper, plaintext PAT, private key, or credential-bearing
remote/config/log artifact.

Implementation verification (2026-08-06): Prisma/Zero regeneration and backend, Claw Auth, Claw runtime, and
shared sandbox typechecks pass. The persisted baseline-context injection test passes. The one local legacy
credential was decrypted, re-encrypted into an active `ExternalSource`, verified, and its old row deleted; cleanup
SQL then removed the legacy table and all six duplicate Repo columns. The temporary migrator and its package
command were deleted after successful verification. Crypto tests prove correct-key decryption, wrong-key and
tampered-binding rejection, no plaintext in the envelope, Node preflight before network use, fresh sandbox-bound
bootstrap requests on recreation, no grant ID in bootstrap requests, strict `sdlc-agent` request/AAD binding,
syntactically valid hidden bootstrap/hook scripts, and real Git commits rewritten to the sandbox-fetched PAT
identity for both author and committer. Local DB verification confirms the
unique replay-binding index across execution, session, repository, operation, sandbox, and ephemeral public-key
hash. Run-finally cleanup removes helper/key material on success, failure, cancellation, and timeout; cached
sandbox reuse first scrubs old material and performs a fresh key/envelope bootstrap. Configured live-sandbox compaction/recreation/push acceptance remains an operational
rollout check because no Kata sandbox was provisioned during this cleanup.

## V2 backlog — multi-ticket Tech Doc execution

Credential/provider/security v2 decisions are tracked separately in
[`DECISIONS_NEEDED_FOR_V2.md`](./DECISIONS_NEEDED_FOR_V2.md); they are decision triggers, not committed
delivery scope.

- [ ] V2.1 Start all Tickets linked to a Tech Doc in explicit dependency order.
- [ ] V2.2 Start the next ticket only after the previous execution succeeds; stop the chain on failure or cancellation.
- [ ] V2.3 Preserve one active execution per ticket and expose each execution through its Ticket debugger.
- [ ] V2.4 Define branch/PR dependency behavior for later tickets instead of treating queue dispatch order as execution order.

V1 operational rule: trigger implementation from individual Ticket tickets. Tech Doc-level sequential
orchestration is intentionally deferred.

### Known delivery limitations

- Local PostgreSQL/Redis and configured Claw/Kata/GitHub/S2S smoke completed against
  `ameernoufil/pets-workshop`: five approved baselines, PRD, Tech Doc, Ticket, selected safe branch,
  draft PR #1, merge reconciliation, and Ticket Done.
- The repository's historical clean-database migration chain currently fails before this feature at `20250311192600_add_ticket_to_external_entity_type` because `ExternalEntityType` does not yet exist. The current Prisma schema pushes successfully, and the new SDLC migration applies successfully against a reconstructed pre-SDLC schema.
- Backend full-repository lint is red on 252 pre-existing errors; all changed SDLC backend files pass targeted lint.
- Dashboard full lint passes with its existing warning baseline.
- Bitbucket Server represents draft state with a `[Draft]` title prefix because its current provider adapter has no native draft flag.
- No new automated tests were added, per the v1 delivery decision.
- Dashboard production build requires an 8 GB Node heap in this worktree; it completes with
  `NODE_OPTIONS=--max-old-space-size=8192` and reports only existing bundle/chunk warnings.
- Claw-auth typecheck remains blocked by two pre-existing Express v4/v5 handler overload errors in `agent-chat.ts:570` and `agents.ts:2470`; the SDLC changes add no new compiler diagnostics.
