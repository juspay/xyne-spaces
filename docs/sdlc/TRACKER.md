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
- [x] T6.8 Give the hidden repository Channel `VIEWER` access on every new baseline, PRD, Tech Doc, and Wiki
      Canvas while preserving creator edit access. Leave existing participant rows unchanged.

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
- [x] T14.2 Extend `Repo` only with normalized `accessCapabilities`; keep transient access-check state,
      timestamps, errors, and evidence in Redis job metadata.
- [x] T14.3 Add a safe migration preserving existing Repo rows, baseline approvals, and legacy provider data.
- [x] T14.4 Implement authenticated credential encryption; do not reuse unauthenticated AES-CBC for PATs.
- [x] T14.5 Add workspace owner/admin checks for configure/replace/disconnect and project/repository checks
      for credential consumption.
- [x] T14.6 Validate replacement before atomic swap; disconnect/replacement increments revision and
      atomically clears affected repository capabilities before rechecking.
- [x] T14.7 Ensure no user-facing API/Zero/query/log path returns ciphertext, plaintext, helper contents, or
      reversible token fragments; the S2S bootstrap returns only a sandbox-public-key-bound encrypted envelope.
- [x] T14.8 Emit metadata-only audit events for credential create/validate/replace/disconnect.

Evidence: migration/schema inspection, ACL attempts by owner/admin/member, DB ciphertext inspection,
response/Zero/log secret audit.

## T15 — Deep `SdlcVcs` module and GitHub adapter

- [x] T15.1 Define the small `SdlcVcs` interface for credential lifecycle, repository access checks,
      capability gates, runtime credential delivery, draft PR creation, and PR validation.
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
- [x] T17.2 Enforce one active check using repository ID as Bull job ID; Redis owns progress/retry/error state,
      while PostgreSQL stores only resulting capabilities.
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

- [x] T18.1 Add S2S-only runtime credential bootstrap bound to execution, session, workspace, repository,
      provider, operation, sandbox public key, credential revision, and expiry.
- [x] T18.2 Validate current capability, credential, and active execution/session/repository scope before each
      encrypted credential delivery.
- [x] T18.3 Forward durable execution/repository/session binding through authoritative SDLC context; never
      serialize PAT into workflow/queue/prompt/conversation/debug/Redis/Zero state.
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
- [x] T18.10 On clone/push/PR 401/403, remove failed capability evidence and surface credential revalidation.
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

The importer is superseded by the accepted incremental pipeline in T27. Scheduled refresh and drift polling
remain out of scope; safe importer retirement is tracked in T27.10.

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
      `SdlcVcs` interface as the persistence seam, validate runtime delivery directly from active execution state,
      and make no Claw database-schema change. Explicitly prevent `ExternalSource.credentials` from entering Zero, public
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
      rely on IDs or rules surviving conversational history compression, and do not re-inject secrets. Audit all
      baseline, artifact, interactive chat, and Start Work entry points to use the wrapper instead of assembling
      context independently.
- [x] T21.7 Move SDLC Git credential provisioning into a sandbox-creation bootstrap module, outside agent
      conversation memory. Each sandbox generates an ephemeral keypair; trusted Claw carries only public-key
      stdout from Kata to the backend and never reads the pod directly. It registers the key against the
      authenticated `sdlc-agent`/workspace/repository/execution/session, receives an authenticated encrypted PAT envelope,
      decrypts it locally, and installs a restrictive temporary Git credential helper. Bind delivery to operation,
      credential revision and expiry; never expose PAT, private key, helper path,
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
bootstrap requests on recreation, strict `sdlc-agent` request/AAD binding,
syntactically valid hidden bootstrap/hook scripts, and real Git commits rewritten to the sandbox-fetched PAT
identity for both author and committer. Local DB verification confirms the
request-time binding checks across execution, session, repository, operation, sandbox, and ephemeral public key.
Run-finally cleanup removes helper/key material on success, failure, cancellation, and timeout; cached
sandbox reuse first scrubs old material and performs a fresh key/envelope bootstrap. Configured live-sandbox compaction/recreation/push acceptance remains an operational
rollout check because no Kata sandbox was provisioned during this cleanup.

## T22 — SDLC human conversations and Activity projection

- [x] T22.1 Lock desktop v1 ownership, UX, ACL, reuse, non-goals, failure behavior, and acceptance walkthrough.
      Pipeline means one PRD-rooted chain; Wiki and Repo Knowledge use direct Canvas owners. Keep Ask AI unchanged.
- [x] T22.2 Add `DISCUSSION` to shared SDLC relation contracts without adding a database enum/table. Define the
      canonical link direction as owner Canvas → Conversation and enforce one discussion owner per conversation.
- [x] T22.3 Add authorized owner resolution for PRD, Tech Doc, Ticket, linked Pull Request, Wiki, and Repo
      Knowledge selections. Return no owner for Overview, lists, or unlinked Ticket/Pull Request selections.
- [x] T22.4 Add repository-member-scoped reads for owner discussion links and linked normal Conversation rows.
      Validate every result belongs to the repository's hidden Channel; preserve Chat ordering and pagination.
- [x] T22.5 Create the initial Message, normal Conversation, participant state, and `DISCUSSION` link atomically
      through existing conversation domain logic. Make retries duplicate-safe and preserve normal Chat side effects.
- [x] T22.6 Mirror required Zero query/mutator surfaces in backend and dashboard, including optimistic behavior,
      without fetching or exposing unrelated hidden-Channel conversations.
- [x] T22.7 Integrate a mutually exclusive SDLC right-panel owner alongside current Assistant/debugger ownership.
      Add **Conversations** beside **Assistant** only when a concrete owner resolves; leave Assistant behavior
      unchanged.
- [x] T22.8 Build the single-column list → thread → Back flow by reusing Chat list rows, message rendering,
      composer, attachments, mentions, reactions, unread/notification state, editing, deletion, loading, empty,
      offline, retry, and error behavior. Add no titles, labels, colors, or SDLC-only message features.
- [x] T22.9 Encode selected conversation in the SDLC URL. Preserve refresh and Back/Forward behavior; clear or
      reject IDs outside the resolved owner/repository Channel without leaking metadata.
- [x] T22.10 Clean `DISCUSSION` links when normal conversation deletion occurs and audit owner deletion for stale
      links without relying on database cascades.
- [x] T22.11 Add Overview's view-only current-user Activity projection filtered by the hidden repository Channel.
      Reuse all existing activity types, ordering, pagination, and read/unread display; do not create events, mutate
      read state, or navigate into hidden Chat.
- [x] T22.12 Add existing-style instrumentation for panel open/close, owner kind, new conversation, and thread
      selection without recording message content.
- [x] T22.13 Route global Activity for hidden SDLC Channels back into the repository Hub. Open exact linked
      messages, Canvases, and Tickets; use Overview for other activity; never expose the hidden normal-Chat view.
- [ ] T22.14 Verify shared/backend/dashboard builds, targeted lint/typecheck, enum coverage, and the manual
      acceptance walkthrough in `CONVERSATIONS_PLAN.md`. Confirm Chat/global Wiki/global Pull Request/mobile,
      existing Ask AI, and non-SDLC repositories remain unchanged.

Evidence: [CONVERSATIONS_PLAN.md](./CONVERSATIONS_PLAN.md), shared contracts, atomic conversation mutators,
mirrored Zero surfaces, SDLC panel integration, reused Chat components, Activity projection, command output, and
the pending manual walkthrough checklist.

Automated implementation verification (2026-08-09): shared build, backend/dashboard typechecks, dashboard
production build, targeted dashboard lint (zero errors; existing warnings only), and `git diff --check` pass.
T22.14 remains open solely for the authenticated two-member interactive walkthrough and cross-surface smoke test.

## T23 — SDLC Chat shell and title-first conversation index

- [x] T23.1 Lock the v1.1 UX: one **Chat** action, Conversations/AI tabs, title-first creation, topic-index list,
      normal thread after selection, and same-Channel Related Work suppression.
- [x] T23.2 Replace the separate top-bar Conversations/Assistant controls with one Chat entry point while retaining
      owner-aware behavior and existing Assistant context.
- [x] T23.3 Add a shared SDLC Chat tab contract across the local human panel and the existing global AI panel;
      preserve URL navigation, mutual exclusion, streaming, and refresh behavior.
- [x] T23.4 Replace root Chat rows with compact topic rows derived from each Conversation's first Message. Preserve
      unread, author/time, reply count, pagination, loading, and empty states.
- [x] T23.5 Replace the root message composer with an explicit required-title creation form. Send that title through
      the existing atomic conversation mutation as the first normal Message; add no title column or backend fork.
- [x] T23.6 Keep selected-thread rendering and composer behavior identical to normal Chat, including replies,
      attachments, mentions, reactions, editing, deletion, and hover actions.
- [x] T23.7 Hide same-repository-Channel Conversation links from Related Work while retaining cross-Channel
      Conversation context links. Keep `DISCUSSION` unlinking unavailable.
- [x] T23.8 Update instrumentation for Chat open, tab switch, title creation, and topic selection without logging
      title/message content.
- [ ] T23.9 Verify shared/backend/dashboard typechecks, targeted lint, production build, URL refresh/Back/Forward,
      human↔AI switching, title validation, topic/thread flow, and Related Work filtering.
- [x] T23.10 Remove automatic AI opening so the Chat action defaults to owner Conversations; close the AI actor only
      after the Conversations URL transition commits, preventing the old `chat=ai` state from reopening it.
- [x] T23.11 Place the Conversations/AI switch in the Chat title row in both panel modes.
- [x] T23.12 Reuse one SDLC Chat header across human and AI modes so height, title, tabs, spacing, active state,
      and close affordance cannot drift; suppress the AI toolbar's duplicate close action.
- [x] T23.13 Refine the SDLC Chat visual hierarchy: consistent inherited panel surfaces, fewer divider rows, compact Assistant
      chrome, icon-labelled tabs, and topic cards with creator/replier avatars.

Evidence: [CONVERSATIONS_PLAN.md](./CONVERSATIONS_PLAN.md), SDLC Chat panel components, existing Assistant shell,
normal conversation mutator, scoped Zero queries, and verification output.

Automated implementation verification (2026-08-09): title/rendering and same-vs-cross-Channel policy tests pass;
shared build, backend/dashboard typechecks, targeted dashboard lint (zero errors; existing warnings only),
dashboard production build with an 8 GB heap, and `git diff --check` pass. T23.9 remains open for authenticated
browser checks of URL navigation and human↔AI interaction.

## T24 — Stable resizable SDLC Chat shell

- [x] T24.1 Keep the SDLC content/Canvas subtree mounted while Chat opens, closes, or switches tabs.
- [x] T24.2 Move SDLC Assistant presentation from AppRoot into the SDLC right panel while reusing the core
      `XyneAISidebar` unchanged as the conversation implementation.
- [x] T24.3 Reuse the core `ThreadMessages`, Chat input, message, hover-action, avatar, and Assistant modules so
      improvements to normal Chat continue to flow into SDLC Chat.
- [x] T24.4 Use one persisted horizontal resize group for Conversations and Assistant with the same size limits and
      drag affordance.
- [x] T24.5 Preserve URL tab/thread state and background Assistant streaming across tab switches.
- [x] T24.6 Add regression coverage for stable shell selection and complete targeted typecheck/lint/build checks.
- [x] T24.7 Preserve the open Chat panel across SDLC location changes; keep Conversations only when the destination
      has discussion topics, clear the previous thread selection, and otherwise fall back to Assistant.

Automated implementation verification (2026-08-09): stable shell policy tests, dashboard typecheck, targeted lint
(zero errors; existing warnings only), structural core-component reuse check, `git diff --check`, and dashboard
production build pass. Authenticated browser interaction remains covered by the open T23.9 acceptance check.

## T25 — Repo Knowledge document navigator

- [x] T25.1 Replace Related context with the Repo Knowledge document list while viewing a Repo Knowledge canvas.
- [x] T25.2 Reuse the Wiki sidebar navigator, including search, selected state, keyboard focus, and compact rows.
- [x] T25.3 Use Repo Knowledge-specific labels, empty states, accessibility text, and analytics names.

## T26 — Local-change review remediation

- [x] T26.1 Preserve the current SDLC Assistant session when switching back from human Conversations in the same
      repository; start fresh only for a closed, different-agent, different-Channel, or different-repository context.
- [x] T26.2 Validate every client-selected Canvas, Ticket, or Pull Request through its backend-resolved canonical
      discussion owner before creating the atomic `DISCUSSION` link.
- [x] T26.3 Resolve selected conversation URLs independently of the paginated topic list and order topic pages by
      `lastActivityAt` so old-but-active and deep-linked threads remain valid.
- [x] T26.4 Add conversation offline, reconnect, query-error, and retry states; replace Activity's 100-row ceiling
      with cursor pagination.
- [x] T26.5 Remove unused core `ChatInput` SDLC props, duplicate tab types, and unused owner props; move discussion
      owner/surface/list derivation behind one tested SDLC discussion model interface.
- [x] T26.6 Complete mirrored tests, typechecks, lint, builds, and a final finding-by-finding review.

Automated remediation verification (2026-08-09): 10 focused policy/domain tests pass; shared, backend, and
dashboard typechecks pass; backend and dashboard production builds pass (dashboard with the documented 8 GB
heap); targeted dashboard lint has zero errors; new backend owner/query modules have zero lint errors; mirrored
backend/shared query definitions and `git diff --check` pass. The legacy backend mutator still reports its existing
lint baseline outside the changed lines.

## T27 — Incremental repository Wiki pipeline

Design source: [WIKI_PIPELINE_DESIGN.md](./WIKI_PIPELINE_DESIGN.md). Product requirements and acceptance
criteria: [PRD.md](./PRD.md#8a-incremental-wiki-generation).

### T27.1 — Contracts and deterministic policy

- [~] T27.1.1 Lock manual trigger, base-branch first-parent ordering, percentage/custom ranges, bootstrap
      semantics, Agent Chunks, quality modes, source/history policy, Canvas concurrency, archive behavior,
      freshness policy, no-new-schema constraint, acceptance criteria, and implementation order. The original
      per-commit-inside-chunk meaning is superseded by the accepted history-window decision in T27.10.7; contract,
      PRD, and design updates remain.
- [x] T27.1.2 Add shared Zod/types for history ranges (`20|50|FULL|CUSTOM_SHA`), chunk sizes
      (`1|10|25|50|100`), quality, run status, progress, Wiki actions, validation reports, revision evidence,
      freshness, and stable error codes without Prisma enums.
- [x] T27.1.3 Add pure first-parent range calculation: target-head snapshot, percentage ceiling/minimum-one,
      full/custom ancestor validation, bootstrap parent/root behavior, refresh range, and immutable endpoints.
- [x] T27.1.4 Add versioned Workflow Execution context/output parsers and compare-and-swap checkpoint policy.
      Reject out-of-order, foreign-session, duplicate-after-cursor, partial, and cancelled commit advances.
- [x] T27.1.5 Split versioned prompt source into modular mission/evidence, change/history, writing/diagram,
      validation, tool-contract, and role policies for bootstrap, generator, architecture validator, operations
      validator, and correction. Prompt v2 carries the full conceptual Wiki contract while treating
      repository/Wiki/history text as untrusted data.

Evidence: shared contracts, pure policy modules/tests, prompt snapshots/contract tests, no Prisma schema diff.

### T27.2 — Deep backend module and persistence reuse

- [x] T27.2.1 Add deep `SdlcWikiPipeline` interface with `start`, `refresh`, `retry`, `cancel`, and `getStatus`.
      Keep routes, queue, callbacks, tools, and dashboard as thin adapters.
- [x] T27.2.2 Enforce repository-admin mutations, member status reads, successful read-access gate, one active run
      per repository, immutable target head/range, and baseline-independent Wiki availability. Delegate the read
      gate to structured `SdlcVcs` capability evidence rather than treating evidence objects as string flags.
- [x] T27.2.3 Create/reuse text workflow type `SDLC_WIKI`; persist state/evidence in existing Workflow Execution
      context/output and link `REPOSITORY --WIKI_RUN--> WORKFLOW_EXECUTION` with `SdlcEntityLink`.
- [x] T27.2.4 Implement current Wiki lookup through Canvas metadata, including defensive adoption of pre-existing
      importer pages, archived filtering, source overlap, and latest successful Wiki cursor/head resolution.
- [x] T27.2.5 Prove implementation adds no Prisma model/field/enum/migration and does not write `.doc_runs.json`,
      `.doc_sources.json`, Markdown, or any state into the attached repository.

Evidence: module/interface tests, ACL/gate tests, Workflow/Canvas/entity-link rows, schema diff audit.

### T27.3 — Queue, dispatch, and recovery

- [x] T27.3.1 Add `WIKI` job type to existing `sdlc` Bull queue and normal global/per-repository admission.
- [x] T27.3.2 Extend SDLC Agent context/operation and execution service for Wiki bootstrap, Agent Chunk,
      validator, and correction roles using the configured `sdlc-agent` only.
- [x] T27.3.3 Snapshot base-branch target head, fetch selected first-parent history, assign ordered Agent Chunks,
      and dispatch next work only from durable cursor truth.
- [x] T27.3.4 Reuse a stable Wiki conversation/sandbox across chunks, clear model session history between chunks,
      clean credentials after runs, and recreate/fetch when the cached sandbox is missing.
- [x] T27.3.5 Reconcile callbacks and stale runs. Resume from checkpointed prefix after partial chunk, no-tool
      stall, truncation, lost/duplicate callback, transient network/429/5xx, or sandbox loss. Callback terminal
      transitions use active-status compare-and-swap so duplicates cannot enqueue twice. Exclude `SDLC_WIKI`
      from generic lock recovery and generic pending claims because it is owned by the existing `sdlc` Bull queue;
      accept `PENDING` tool callbacks only with the exact trusted execution/repository/session binding.
- [x] T27.3.6 Make cancel stop future dispatch, best-effort cancel current Claw run, preserve checkpoints, and
      expose truthful retryable state. A late callback cannot requeue, finish, or fail over a cancelled terminal
      execution. Retain failed commit diagnostics until retry/retention cleanup.
- [x] T27.3.7 Remove the `PREPARE` LLM role. Resolve the base-branch head, fetch first-parent history, apply the
      selected percentage/custom range, order commits oldest-first, split chunks, and persist the immutable run
      plan deterministically in the backend. Start agent execution at `BOOTSTRAP`. Use a credential-safe,
      blob-filtered temporary Git fetch and remove it after range calculation.
- [x] T27.3.8 Keep full commit SHAs as private canonical identities for persistence, checkpoints, source evidence,
      Canvas metadata, and authorization. Give the agent and UI shortest-unique commit abbreviations with a
      minimum of 9 characters. Accept abbreviated refs at Wiki tool boundaries, resolve them server-side, and
      require an exact match to the full SHA assigned by the trusted run context before reading or applying.

Evidence: queue/worker/execution tests, context transitions, callback/reconciler tests, failure-injection output.

### T27.4 — Wiki-only historical Git tool

- [x] T27.4.1 Add one structured `sandbox-sdlc-wiki-git-context` tool supporting assigned commit metadata/diff,
      tree listing, file read, tree search, and bounded path/rename history.
- [x] T27.4.2 Bind repository, execution, session, assigned SHA/range, and base target through trusted SDLC
      context. Reject arbitrary refs, paths, shell strings, interpreters, checkout, reset, clean, branch, commit,
      push, and destructive flags.
- [x] T27.4.3 Fetch enough history despite current dynamic clone depth 1. Resolve the immutable first-parent range
      deterministically in the backend; return small assigned-commit diffs inline and large diffs through bounded
      sandbox patch files; cap per-call and cumulative output/time.
- [~] T27.4.4 Add root, merge/first-parent, rename, delete, binary, large-diff, invalid-path/ref, output-cap,
      timeout, private clone, and sandbox-recreation tests. Root, merge/first-parent, rename, delete, binary,
      large-diff, invalid-path/ref, UTF-8 byte-cap, and per-Agent-Session cumulative-budget fixtures now pass;
      SDK timeout, independent wall-clock timeout, missing-session recreation signal, and stale-session
      classification now pass. A configured public smoke exposed an SDK command promise that did not settle after
      its requested timeout; the Wiki tool now independently expires it, evicts/destroys the unhealthy sandbox,
      and tells the same execution to recreate it. Configured private clone/recreation remains.

Evidence: Claw shared tool source/tests, tool registration/palette, redaction/security review, live sandbox probe.

### T27.5 — Wiki Canvas read/write/finalize tools

- [x] T27.5.1 Add authenticated `spaces-sdlc-wiki-list-pages` and `spaces-sdlc-wiki-read-page` tools confined to
      active execution repository Wiki Canvases. Read live Y-Sweet Markdown/content hash.
- [x] T27.5.2 Add authenticated `spaces-sdlc-wiki-write-page` and
      `spaces-sdlc-wiki-finalize-commit`; bind repository, execution, session, initiating user, assigned ordered
      commit, and role. Permit exactly one create/update/restore/archive page per write call, then advance only on
      explicit changes/no-op finalization.
- [x] T27.5.3 Validate normalized Wiki paths, unique actions, Markdown/title/size limits, expected hashes,
      source existence at assigned commit, full non-empty sources for active pages, and zero actions for no-op.
- [x] T27.5.4 Derive nested Wiki folders from agent-supplied relative page paths, plus visibility, participants,
      editor, metadata, and version names server-side. Support arbitrary safe depth such as
      `architecture/runtime/workers.md`; the agent never needs a separate create-folder tool. Block generic/
      cross-repository Canvas writes and remove apply from validator palettes.
- [x] T27.5.5 Create/reuse content-addressed `CanvasVersion` for each generated page state. Record current
      SHA/hash/version/sources in Canvas metadata and full Wiki Revision evidence in Workflow output.
- [x] T27.5.6 Implement optimistic live-content conflict as stable `CONTENT_CONFLICT`; retry same commit against
      human-edited content instead of overwriting it.
- [x] T27.5.7 Archive whole obsolete topics through metadata, hide them from normal Wiki listing, preserve
      comments/versions, and restore same Canvas/path later. Never hard-delete.
- [x] T27.5.8 Persist pending per-page revision evidence in existing Workflow Execution JSON so partial
      DB/Y-Sweet/Vespa failure is idempotently repairable without a schema change. Advance the checkpoint only
      after every one-page write and required sync/index dispatch completes, followed by explicit finalization.

Evidence: route/tool/service tests, Canvas/CanvasVersion/metadata/output rows, Y-Sweet/index failure injection.

Archive policy note: active source mappings are cleared when a whole topic is archived, while the prior source
paths remain in revision evidence and archived Canvas metadata. Retry/repair reuses that evidence without creating
a session-specific duplicate version.

### T27.6 — Bootstrap and incremental generation

- [x] T27.6.1 Bootstrap the complete repository tree at parent(selected start), reconciling any existing pages;
      handle root start by skipping the unreadable synthetic bootstrap ref, keeping an empty Wiki, then processing
      the real root commit normally.
- [~] T27.6.2 The existing implementation processes each commit inside its Agent Chunk in strict order and
      finalizes each commit. Live scale testing showed that this makes one LLM own a fragile multi-step state
      machine. Replace it through T27.10.7: one selected chunk becomes one history window, with one conceptual Wiki
      transformation and one endpoint checkpoint; size `1` remains exact commit-by-commit mode.
- [x] T27.6.3 Select affected pages through current source overlap and bounded changed-path/rename history; allow
      surrounding historical source inspection without loading entire history or Wiki.
- [x] T27.6.4 Enforce conceptual/current/source-grounded writing rules, evidence precedence, uncertainty labels,
      source pointers, stable page structure, useful diagrams only, and compressed evolution.
- [x] T27.6.5 Deterministically no-op commits whose changed paths are entirely test-only, generated-only, or
      lockfile-only. Require generator inspection before treating formatting-only, refactor, dependency, or bug-fix
      commits as no-op; path classification alone must never skip a mixed source commit.
- [x] T27.6.6 Detect missing tool progress and truncated output from checkpoints, not natural-language completion;
      replace session and continue from cursor when needed.
- [x] T27.6.7 Keep Wiki tool identity independent of model context: bind execution/session/repository IDs from
      trusted server context, remove them from model-required arguments, and overwrite omitted or hallucinated
      values after compaction. Keep role-specific tool palettes and commit authorization server-owned.
- [x] T27.6.8 Make post-compaction progress recovery deterministic: Wiki list/read responses expose the
      server-owned current abbreviated commit ref, chunk index/size, and already-written pending page paths.
      Prompt the agent to recover from this field rather than summary memory, and suppress canonical full SHAs
      from page commit identities returned to the agent.

Evidence: fixture-repository end-to-end tests with relevant/no-op/refactor/rename/delete/root/merge histories.

### T27.7 — Quality modes and final correction

- [x] T27.7.1 Quick completes after commit processing without an LLM validator.
- [x] T27.7.2 Standard runs one read-only structured validator then one correction role only for actionable
      findings.
- [x] T27.7.3 Thorough runs independent architecture/domain/flow and operations/failure/security/source validators,
      merges reports deterministically, then runs one correction role.
- [x] T27.7.4 Bind validators read-only; correction must verify findings at target head and create
      `Wiki audit @ <short-head>` revisions only for confirmed changes.
- [x] T27.7.5 Validate report schemas, missing/stale/contradictory/source findings, empty-report skip, invalid-report
      retry, duplicate corrections, and final completion.

Evidence: role/palette tests, structured report fixtures, correction/version evidence.

### T27.8 — Wiki freshness in interactive Ask AI

- [x] T27.8.1 Derive `CURRENT|STALE|UNKNOWN` from latest successful Wiki SHA and observed base-branch head;
      missing/failed VCS evidence never yields current.
- [x] T27.8.2 Add both SHAs/freshness to verified interactive SDLC Agent context without changing baseline,
      artifact, or Start Work behavior.
- [x] T27.8.3 Instruct Assistant: current complete Wiki may answer; stale/unknown Wiki requires live-code
      inspection and disclosure; exact implementation/security/config/unsupported behavior still checks code.
- [x] T27.8.4 Add freshness derivation and prompt-policy tests, including Wiki/code conflict where current code wins.

Evidence: Agent context tests, prompt tests, interactive public/private repository smoke.

### T27.9 — Dashboard generation and progress UX

- [x] T27.9.1 Replace importer empty state with admin **Generate Wiki** and explanatory member state.
- [x] T27.9.2 Add start panel: Latest 20% default / Latest 50% / Full / Custom SHA; 1 / 10 default / 25 / 50 /
      100 commits per Agent Session; Quick / Standard default / Thorough.
- [x] T27.9.3 Explain each option's quality/time/cost tradeoff, show the exact selected count after preparation,
      and display the common quality/runtime/cost warning before start.
- [x] T27.9.4 Show durable phase, branch/head, processed/total, chunk/current commit, update/no-op counts, quality
      stage, last update, and actionable error. Reconnect from backend truth.
- [x] T27.9.5 Add admin Cancel/Retry/Refresh; keep member view-only. Disable duplicate active starts and explain
      access gate/custom-SHA/range/conflict errors.
- [x] T27.9.6 Hide archived pages from normal tree while preserving existing Wiki search/navigation, Canvas open,
      version diff/restore, conversation ownership, and compact sidebar behavior.
- [x] T27.9.7 Expose the existing inline SDLC debugger from the Wiki run card and follow the current role's
      conversation/session across preparation, generation, validation, correction, failure, and retry.
- [x] T27.9.8 Keep in-progress debugger snapshots synchronized at tool start and tool completion. Serialize
      partial writes so a completed Claw tool cannot remain displayed as `Running` until a later assistant turn.

Evidence: dashboard policy/component tests, typecheck/lint/build, authenticated role/progress/navigation smoke.

### T27.10 — Retirement, verification, and rollout

- [x] T27.10.1 Remove operator Research Agent importer command/routes/dependencies once generated flow works;
      preserve/reconcile existing imported Canvases and never bulk-delete user Canvas data.
- [x] T27.10.2 Run focused shared/backend/dashboard/Claw tests, typechecks, targeted lint, production builds,
      enum validation, schema-diff audit, and `git diff --check`.
- [~] T27.10.3 Configured public-repository smoke: Generate with defaults → inspect checkpoint/version/source
      evidence → inject mid-chunk failure → Retry → human-edit conflict → complete Standard validation → Refresh.
- [ ] T27.10.4 Configured private-repository smoke proves sandbox credential bootstrap/reuse/recreation, no token
      disclosure, read-only Git behavior, and cancel/retry.
- [~] T27.10.5 Verify existing access check, baseline, PRD/Tech Doc/Ticket, Start Work/PR, Wiki Canvas navigation,
      Chat/conversations, Activity, global Wiki, and non-SDLC repositories remain unchanged.
- [~] T27.10.6 Audit every PRD acceptance criterion and design invariant against code/runtime evidence before
      marking T27 complete.
- [~] T27.10.7 Replace per-commit execution inside an Agent Chunk with the accepted **history-window** model.
      Chunk size means commits combined into one Wiki update: size `1` gives exact commit-level fidelity; sizes
      `10|25|50|100` compare the Wiki/repository state before the window with the repository at its endpoint. The
      endpoint checkpoint is mandatory. The agent may also create optional Wiki checkpoints at meaningful
      intermediate commits when an intermediate state, decision, migration, or evolution remains useful; it must
      not create intermediate versions for routine churn. Backend-owned monotonic checkpoint state—not model
      memory—controls their order.
- [x] T27.10.7.1 Update PRD, design, shared contracts, prompt terminology, and acceptance criteria from ambiguous
      “Agent Chunk”/per-commit processing to `HistoryWindow { beforeSha, afterSha, includedCommitShas }`. Keep
      history range, history-window size, and quality as three independent user controls.
- [x] T27.10.7.2 Version Workflow Execution JSON state/output for assigned/pending/completed windows without a
      Prisma change. Persist immutable before/after SHAs, ordered included SHAs, endpoint cursor, commit progress,
      window progress, optional intermediate checkpoint cursor/plan, summaries, revisions, and errors; never
      mislabel skipped or aggregated intermediate commits as no-op.
- [x] T27.10.7.3 Deterministically partition the selected oldest-first first-parent range into non-overlapping
      windows, including size `1`, root/bootstrap, refresh, merge, and final partial-window cases. Bootstrap remains
      the state at parent(selected start); window 1 compares that state with its last included commit, and every
      later window starts at the previous endpoint. Within a window, accept only strictly increasing optional
      checkpoint refs from its included first-parent sequence, and always require its endpoint last.
- [x] T27.10.7.4 Extend the Wiki Git module with bounded `range_context`: ordered commit metadata, aggregate file
      statuses/statistics, before→after diff/patch paging, rename/delete/binary evidence, and endpoint tree/file
      reads. Permit selective `commit_context` inside the assigned window for rationale, but never require the
      whole aggregate patch or every commit diff to fit model context.
- [x] T27.10.7.5 Rewrite generator instructions around one window transformation: inspect final code at `afterSha`,
      compare against the current Wiki/before state, compress intermediate churn, preserve only history that
      explains the endpoint, and normally write once at the endpoint. Permit an optional intermediate checkpoint
      only when its temporary state or historical meaning is worth retaining. Require the agent to begin that
      server-authorized checkpoint explicitly before writing. Allow parallel read-only investigation inside the
      same window; serialize every one-page write and wait for it before the next write/finalization.
- [x] T27.10.7.6 Add a narrow server-owned checkpoint interface: begin the next chosen intermediate/endpoint ref,
      write/finalize only that active ref, then advance monotonically. Reject parallel, backward, skipped-active,
      foreign-window, and post-endpoint mutations. Finalizing the mandatory endpoint completes the window and
      returns the next server-authored window assignment. Preserve partial one-page writes, expected-hash
      conflicts, idempotent retry, source verification at each checkpoint ref, and duplicate/lost-callback
      compare-and-swap behavior.
- [x] T27.10.7.7 Record provenance for the endpoint and any chosen intermediate Canvas versions: before/after SHA,
      included commit SHAs, every chosen checkpoint SHA, meaningful supporting commit refs when cited, Canvas
      ID/version/content hash, action, and complete sources verified at that checkpoint. Keep active source mappings
      tied to the latest checkpoint/endpoint truth, preserve older source evidence in revision history, and remove
      deleted sources at the endpoint.
- [x] T27.10.7.8 Update UI copy and progress. Label the selector **Commits per Wiki update**; explain that larger
      windows are faster and reduce churn but compress/may miss intermediate rationale, while `1` maximizes
      commit-level fidelity. Explain that the agent may retain a small number of meaningful intermediate
      checkpoints, but they are not guaranteed snapshots of every commit. Show processed commits,
      intermediate-checkpoint activity, and completed/total windows separately. Quality continues to control final
      read-only validation/correction depth, not window size.
- [x] T27.10.7.9 Preserve compatibility for already-running/terminal version-1 executions. Do not reinterpret,
      rewrite, or automatically restart the active `hyperswitch` smoke; new window semantics apply only to newly
      planned version-2 runs. Retry must follow the execution's persisted version and checkpoint model.
- [~] T27.10.7.10 Add planner, prompt, Git-tool, page-store, callback/recovery, compaction, UI, and configured-run
      coverage for sizes `1|10|25|50|100`, exact boundaries, final partial windows, huge aggregate diffs, relevant
      changes cancelled within a window, no-intermediate fast path, a meaningful intermediate checkpoint, rejected
      out-of-order/parallel checkpoints, mandatory endpoint finalization, partial failure/retry, cancel, validation,
      provenance, and 7,000+ commit planning.
- [x] T27.10.8 Add and verify a stable conceptual Wiki path/folder policy. Explain directly that a page path such
      as `flows/payment-lifecycle.md` automatically creates/uses simulated Canvas folder `Wiki/flows`; no separate
      folder tool exists. Reserve the Wiki root for stable navigation/overview pages, prefer evidence-backed
      families such as `concepts/`, `subsystems/`, `flows/`, `interfaces/`, `operations/`, and `decisions/`, and
      avoid empty/template folders, source-directory mirroring, duplicate topics, or routine page movement. Make
      bootstrap establish the initial taxonomy, require endpoint and optional intermediate writes to reuse that
      taxonomy while investigating existing pages before creating another, make later generators preserve existing
      topic paths, make validators flag root-page sprawl/broken navigation, and cover the prompt plus a configured
      nested-page run.
      Do not reorganize the currently running Wiki automatically; decide any one-time root-page migration only
      after inspecting its completed output and preserving Canvas/version/source history.
- [x] T27.10.9 Add an atomic, run-bound Wiki page move/rename capability before reorganizing generated pages.
      Keep removal as the existing recoverable `archive` action—never hard-delete a Wiki Canvas. A move must accept
      normalized source and destination paths, reject an occupied destination and stale expected content hash,
      preserve the same Canvas ID, CanvasVersion history, Markdown/content hash, active/archived source history,
      permissions, participants, and revision provenance, update `wikiRelativePath` plus the derived simulated
      Canvas folder, and record explicit moved-from/moved-to evidence against the current assigned commit. Make
      retries idempotent, clean up only an empty pipeline-owned old Wiki folder, repair affected Wiki cross-links
      through separate guarded page updates, and add create→move→archive→restore plus conflict/retry tests. Do not
      emulate a move by creating a new Canvas and archiving the old one because that splits page identity/history;
      do not add a bulk folder-move tool until a real need appears.
- [x] T27.10.10 **Implementation-agent stop gate.** After T27.10.7–T27.10.9 are implemented, run the relevant
      automated suites/typechecks/builds and at most one small configured sample Wiki run that is intentionally
      bounded for quick verification. Inspect its basic window ordering, nested path/folder creation, Canvas
      version/source evidence, move/archive behavior, and clean terminal state. Then stop and report the exact
      results, remaining risks, and suggested human stress settings. Do not keep generating additional sample
      runs in an attempt to prove scale.
- [ ] T27.10.11 **Human-only manual stress handoff.** Preserve the stopped `hyperswitch` version-1 run as-is; do
      not resume, retry, cancel, reinterpret, or replace it automatically. After the implementation-agent stop gate,
      a human chooses the repository, history range, commits-per-update, and quality, manually starts the new
      version-2 stress run, and owns any cancel/retry decision. The agent may inspect or monitor that run only after
      an explicit human request. Leaving this manual stress item unchecked at implementation handoff is expected
      and must not cause an autonomous agent loop to continue running tests or creating Wiki executions.

Handoff rule: “complete the implementation tracker” means finish code, automated verification, documentation, and
the single bounded sample in T27.10.10, then yield to the human. It does not authorize starting or babysitting the
large/manual stress test in T27.10.11.

Version-2 implementation gate (2026-08-12): new runs persist non-overlapping History Windows and require a
server-begun monotonic endpoint checkpoint; optional intermediate checkpoints remain explicit. The Git tool now
returns bounded aggregate range evidence with paged patches. Prompt v3 uses range-first generation, serialized
mutations, conceptual nested folders, and the atomic page-move tool. Move preserves Canvas identity/content/source
history, records moved-from/to provenance, rejects stale/occupied destinations, supports idempotent evidence repair,
and removes only an empty pipeline-owned old folder. Aggregate commits are counted separately instead of being
mislabelled no-op. Full backend Wiki tests pass 74/74; focused Claw shared Wiki Git tests pass 26/26; trusted Wiki
binding tests pass 3/3; shared build plus backend/Claw/Claw Auth/Claw shared/dashboard typechecks pass; dashboard
production build and `git diff --check` pass. Existing build chunk warnings are unchanged. Per the human's explicit
handoff, no configured sample or stress run was started; T27.10.7.10 and T27.10.11 retain that manual runtime proof.

Evidence: command output, fixture/live run IDs, Canvas/version/source records, security log audit, acceptance table.

Current verification (2026-08-12): the complete backend `tests/sdlc` suite passes 128 tests across 25 suites;
backend, Claw, Claw Auth, and Claw shared typechecks pass. The full Claw run reaches 220 passing tests, with five unrelated
existing/environment-sensitive failures (memory mocks, GCS-unavailable freshness cases, and logging expectation);
the focused Claw Wiki identity/file-forwarding set passes 16/16. The focused Wiki/Ask-AI/GitHub-adapter proof set
passes, including durable
mid-chunk recovery, archive source-history/version identity, optimistic checkpoint concurrency, terminal-state
CAS, duplicate-callback collapse, stale live-Canvas conflict protection, and idempotent post-DB side-effect
repair. The complete Claw shared suite passes 136/136; the focused Wiki Git guardrail suite includes the independent
wall-clock deadline and deterministic relevance/path-parser coverage; shared,
dashboard, and all three Claw TypeScript builds/typechecks pass; dashboard production build, enum guard, targeted
backend lint, targeted dashboard lint (one pre-existing warning), and `git diff --check` pass. The full Claw Auth
suite reaches 304 passing tests with four unrelated mention-transform mock failures. Configured public and
private fault-injection coverage, private sandbox probes, and final regression audit remain; importer retirement
and the public Quick Generate/Retry path are complete.
Backend SDLC regression coverage is complete; configured dashboard/Chat/Activity/global-Wiki/non-SDLC runtime
regression remains under T27.10.5.

Large-repository readiness audit: synthetic first-parent histories of 7,100 commits parse within the deterministic
planner limits. For the intended 7,000-commit repository settings, Latest 20% selects exactly 1,400 oldest-to-newest
commits and chunk size 25 produces exactly 56 generator sessions without gaps or reordering. Planning now fetches
commit ancestry with `--filter=tree:0`; the reusable Wiki sandbox uses a full-history, blobless, single-branch clone
with a 30-minute clone timeout so current files are present while old blobs load lazily. Focused planner/prompt/ref
coverage passes 25/25, including the 7,000-commit calculation and 7,100-commit parser. This is scale simulation,
not a claim that an overnight 1,400-commit agent run has completed locally.
The complete Dashboard test suite passes 40/40, and its production build includes Mermaid rendering support.
An end-to-end page-store unit proves a one-page create at `flows/security/authentication.md` derives the simulated
Canvas folder `Wiki/flows/security`, persists the relative path and source mapping, and leaves commit advancement
to explicit finalization. A second end-to-end page-store unit proves archive retains the Canvas, creates/reuses a
CanvasVersion, moves active sources into archived source history, and applies archive metadata without Y-Sweet
content replacement or hard deletion. A matching restore unit proves the same Canvas/path is reused, archive
metadata is cleared, current source paths are verified, a restore version is recorded, and live Canvas content is
resynchronized.

Static completion audit (2026-08-12): Wiki PRD criteria 25–35 and the design's locked decisions, orchestration,
tool, persistence, content, recovery, freshness, UI, security, and non-goal sections were rechecked against current
source and focused tests. The audit corrected one stale design description: commit processing uses separate
one-page writes followed by explicit finalization, and the contract now contains six narrow tools rather than a
single multi-page apply/four-tool description. No static implementation gap was found. T27.10.6 remains partial
because the delivery gate explicitly requires configured public/private fault injection, Standard validation,
human-edit conflict, incremental Refresh, and stale Ask AI runtime evidence; static tests cannot substitute for
those observations.

Compaction identity audit: Wiki MCP page/list/read/write/finalize calls now receive execution ID, session ID, and
repository ID from trusted server context after model argument generation. Those fields are removed from the
model-required schema and trusted values override missing or hallucinated values, while the backend still verifies
the binding. Focused Claw regression tests pass 3/3 and Claw typecheck passes. Tool palette, Wiki role, assigned
commit authorization, repository binding, and durable commit cursor remain server-owned rather than summary-owned.
Wiki list/read additionally return the durable current assignment, completed/total chunk position, and pending
page paths after compaction; page commit identities are abbreviated before reaching the agent. Focused commit-ref
and prompt recovery coverage passes 11/11, with backend and Claw Auth typechecks passing.

Prompt-quality audit: Wiki prompt v3 now explicitly covers WHAT/HOW/WHY/WHERE, evidence precedence,
fact/rationale/inference, surrounding-code investigation, direct/transitive impact, deletions/refactors/bug fixes,
decision and historical memory, conceptual information architecture, page/flow design, security and consistency,
source pointers, cross-links, tables, stability, knowledge compression, and a pre-write validation checklist.
Mermaid is permitted only when it materially improves understanding, must use an evidence-backed focused
`mermaid` fenced code block, and must be updated with the implementation. Direct code remains rare, minimal, and
must use a correctly labelled fenced block. The tool-based one-page/finalize output contract replaces the reference
prompt's incompatible monolithic XML bundle.

Static acceptance audit (criteria 25–35): all required module, route, tool, state, Canvas-version/source,
checkpoint, quality-mode, dashboard, and freshness paths are present. Automated evidence covers range/order,
root bootstrap policy, no-op classification, archive/source history, stale checkpoint rejection, mid-chunk cursor
recovery, and freshness. Criteria 28–35 still require the configured public/private fault-injection smokes before
T27.10.6 or the overall feature can be marked complete.

| PRD criterion | Current authoritative evidence | Audit state | Remaining release proof |
| --- | --- | --- | --- |
| 25 — manual Generate/Refresh after read access | Wiki routes have no attach/schedule caller; pipeline requires repository admin plus proven `READ_REPOSITORY`; configured public run proved manual Generate/Retry and no-change Refresh planning | Automated + runtime | Process a later real incremental Refresh |
| 26 — 20%/50%/full/custom and parent bootstrap | shared input schema plus `wikiRangePolicy.test.ts`, including invalid custom SHA and root bootstrap; configured default 20% selected 23/111 and preserved bootstrap | Automated + runtime | None beyond final audit |
| 27 — first-parent oldest-first and 1/10/25/50/100 chunks | deterministic VCS preparation, Git merge fixture, range/chunk tests, immutable Workflow context; configured run completed all 23 in first-parent order | Automated + runtime | None beyond final audit |
| 28 — missing sandbox recreation from latest checkpoint | missing/stale sandbox signals, execution recovery, and durable prefix tests | Automated | Kill sandbox during public/private run and observe recreation/resume |
| 29 — relevant page mutations and irrelevant no-op | relevance classifier tests, generator contract, one-page write/finalize tools; configured run produced 9 updates, 14 no-ops, and six coherent conceptual pages | Automated + runtime | Final content-quality audit |
| 30 — current and historical revision/source tuple | page-store tests plus configured 24 outcomes, 19 revisions, 21 CanvasVersions, content hashes, version identities, and 58 revalidated source mappings | Automated + runtime | None beyond final audit |
| 31 — human-edit conflict | live Y-Sweet hash comparison and `CONTENT_CONFLICT` page-store test | Automated | Inject edit during configured run and Retry |
| 32 — archive without hard delete; move/partial removal update | archive/restore source-history/version tests; normal listing filters archived metadata | Automated | Inspect archive/restore in configured run |
| 33 — quality modes, same agent, read-only validators | prompt/palette/role tests and execution dispatch contracts | Automated | Complete Standard; optionally inspect Thorough role sequence |
| 34 — Ask AI freshness policy | freshness and Ask-AI context/prompt tests; successful run cursor and observed base head both `044cd79e9` resolve to `CURRENT` | Automated + current runtime | Stale configured Ask AI smoke after a later branch commit |
| 35 — durable truthful recovery | checkpoint/CAS/cancel/duplicate/lost-callback/transient-fetch/partial-side-effect tests plus configured lost-callback Retry completion | Automated + partial runtime | Injected mid-chunk and private fault sequence |

Public-read audit: proven public repositories now use anonymous Git clone and anonymous GitHub branch/path
verification without installing credential material. Private clone and every write operation remain bound to the
encrypted workspace credential path. Unit coverage proves the anonymous bootstrap decision, missing Authorization
header, source verification, and structured Wiki start capability gate. Configured public smoke run
`cmsoqfc1h002zjmukg2f6eeuv` proved authenticated manual start and cancellation while exposing the non-settling
sandbox command. Replacement run `cmsoqqx1j0036jmukzb6pgfyy` proved the former strict PREPARE palette and credentialed
sandbox recreation, then exposed two recovery gaps now covered in code/tests: credential bootstrap accepts a
session-bound PENDING handoff, and transient Claw status-fetch failures no longer terminally fail a run. The full
T27.10.3 sequence remains in progress.

Read-only local DB audit after the deterministic-preparation/one-page-write fixes found no active Wiki execution.
Latest run `cmsossi73000th8vritzj8wss` is durably `FAILURE/PARTIALLY_FAILED` at 0/23 with
`AGENT_RUN_FAILED` (provider stall); prior run `cmsorqd860011byqjye27teh1` is durably failed at 0/23 because the
old agent completed without a checkpoint. Neither contains pending revisions. They are preserved for explicit
admin Retry; no run was automatically restarted.

Configured read-only planner smoke against attached public repository `pets-workshop` used the production
`SdlcVcsService`/GitHub adapter and resolved 111 first-parent commits: root `f97570aed`, target/final `044cd79e9`,
with every returned parent link matching the immediately previous commit. Its 20% selection is 23 commits, which
matches the durable run plan above. This verifies the new no-Agent preparation path through real Git/DB access;
it does not replace the still-required generated Canvas/fault-injection smoke.

Lost-callback recovery audit on run `cmsoz166v000x3ann04f69luo` found a completed Claw bootstrap and four durable
Wiki revisions, but finalization had already cleared `assignedChunk`; the reconciler could not reconstruct the
role and failed before queueing the first commit chunk. Recovery now falls back to the still-session-bound durable
run phase and accepts a cleared assignment as proof that finalization completed. Regression tests cover both the
observed bootstrap boundary and the same condition after a normal commit chunk. Read-only replay against the
preserved run resolves the terminal role as `BOOTSTRAP` and Retry’s next role as `GENERATOR`, retaining all four
bootstrap revisions.

Configured public Retry smoke then completed that same run successfully in Quick mode: 23/23 selected commits,
9 updated and 14 no-op, cursor/target `044cd79e9`, 24 durable outcomes including bootstrap, 19 Wiki Revision
records, and no pending revision or error. Six active Wiki Canvases remain; every active page has non-empty source
paths, every page has a content hash and Canvas-version identity, and 21 CanvasVersion rows exist. This proves
bootstrap preservation plus real commit-by-commit continuation through completion. Standard validation, injected
mid-chunk failure, human-edit conflict, and Refresh remain for the rest of T27.10.3.

Post-run source audit revalidated all 58 current source mappings across the six active pages against target head
`044cd79e9`; no deleted/stale path remained. Persisted Canvas structure contains 151 non-empty blocks across the
six pages with coherent conceptual headings for overview, backend/data/API, frontend/runtime/failure handling,
development/deployment, GitHub Actions, and repository governance. A direct live-Markdown audit command was not
used as release evidence because standalone `tsx` hit the repository's BlockNote CJS loader incompatibility; the
successful write-time live hash checks and persisted content/version evidence remain authoritative.

Production read-only Refresh planning observed cursor=head=`044cd79e9` and returned `NO_CHANGES`, proving the
current no-change path does not require an Agent run. A later manual Refresh after a new base-branch commit is
still required to prove creation and processing of an incremental refresh Workflow Execution.

Ask AI freshness runtime audit resolved the latest successful Wiki run `cmsoz166v000x3ann04f69luo` at
`044cd79e9` and independently observed the attached repository base-branch head at the same ref. Production
freshness derivation returned `CURRENT` with the durable run in `COMPLETED` at 23/23. A future branch-head advance
is still required for the configured `STALE` path; no repository mutation was made for this audit.

Latest deterministic-planning verification: backend Wiki/VCS/recovery coverage passes, and the complete
Claw shared suite passes 136 tests. PREPARE is no longer an Agent role or tool operation; prompt/UI refs are
shortest-unique with a nine-character minimum while trusted tool context and persistence retain full SHAs. Direct
tool-output coverage proves canonical SHAs are replaced by their assigned display refs before reaching the agent.
The obsolete `sdlc:wiki:import` command, importer-only TypeScript config, Research Agent fetch script, and direct
Wiki sync API were removed without deleting or rewriting existing Wiki Canvases; metadata/path-based listing and
generated-pipeline adoption remain.
Shared, backend, Dashboard, Claw Auth, Claw, and Claw-shared typechecks/builds pass where each package defines the
corresponding script. Dashboard production build passes with an 8 GB Node heap (the repository-wide bundle exceeds
the default 4 GB heap on this machine). Targeted changed-source lint, enum guard, no-Prisma-diff audit, importer
retirement search, and `git diff --check` pass.

Large-repository configured smoke started on attached public repository `hyperswitch` with execution
`cmsp364m40014b3weyx6c9i7e`: Latest 20% selected 1,525 first-parent commits, chunk size 25 implies 61 generator
chunks, and Standard quality entered `BOOTSTRAPPING` at `b32016c06`. During bootstrap, two broad Git searches hit
the independent 120-second sandbox-command deadline and evicted their sandboxes. The same Claw run recreated each
sandbox and continued with focused file reads without a workflow failure or manual Retry, providing live evidence
for automatic missing-sandbox recovery. Completion, Canvas/version/source inspection, and Standard validation are
still pending; this entry does not claim the overnight smoke succeeded.

The first 25-commit generator exposed a live prompt/runtime conflict. Although the Wiki role says to process
oldest-to-newest and wait for durable finalization, the general Claw parallel-tool preamble plus all 25 visible
assigned refs led the model to emit page writes for several future commits in one turn. Server checkpoint guards
correctly rejected five such calls with `COMMIT_OUT_OF_ORDER`; no future page or revision was persisted. The agent
then retried those writes as each commit became current and continued successfully. The accepted replacement is
T27.10.7's history-window model: one mandatory endpoint update plus optional meaningful intermediate checkpoints,
all begun and advanced monotonically through server-owned state. It preserves useful evolution without asking the
model to run an implicit per-commit state machine. The stopped version-1 smoke remains evidence only and must not be
reinterpreted or restarted automatically.

### T27.11 — Overnight History Window audit and remediation tracker

Read-only audit source (2026-08-12): attached `hyperswitch` repository
`9fca4750-01b7-4e48-a8f8-6a2c03292da3`, version-2 execution
`cmsp6t8f0001aibd8za8vhhvy`. Do not retry, cancel, alter, or clean up this preserved execution or its Canvases while
implementing this section unless a human explicitly requests that mutation.

Observed durable result:

- The run selected 1,525 first-parent commits, completed 20/61 History Windows, covered 502 commits, and stopped at
  32.9%. Nineteen windows updated the Wiki and one endpoint window was a legitimate no-op. The remaining 1,023
  commits were not processed, and Standard validation/correction never ran.
- The 24 Claw sessions all returned `completed`, but 198/1,738 tool calls failed. The largest classified groups were
  61 sandbox command timeouts, 31 unassigned-commit requests, 22 invalid/missing source-path 404s, 22 post-restart
  `fetch failed` calls, 13 missing-sandbox follow-ons, and six same-checkpoint content conflicts. Smaller groups
  included unsupported generic tools, invalid paths/ranges, binding mismatches, network timeouts, and four
  `CanvasVersion.upsert` 500s.
- Before the Docker/service interruption, recoverable tool failures usually still ended at a durable endpoint.
  After restart, three short sessions accumulated 22 `fetch failed` calls. The last session finalized two optional
  intermediate no-ops (`4fa9a2188`, `6effa784e`) inside a 25-commit window, then returned natural-language
  completion without its mandatory endpoint `dcdaff128`. Callback handling terminalized the entire execution as
  `AGENT_RUN_FAILED` instead of resuming from durable `nextIndex = 2`.
- The run recorded 84 Wiki revisions: 19 creates, 62 whole-page updates, and three moves. New coherent topics first
  appeared at endpoint windows 4, 5, 7, 8, 10, 11, 13, 14, and 15. Window 20 produced the only endpoint no-op.
  Bootstrap also left two active scratch pages (`scratch/test-page.md`, `scratch/router-duplicate.md`). No page was
  archived; two obsolete-looking topics were moved under `archive/` but remain active because path naming is not
  archive state.
- All 19 active Canvases have page-level source paths, but the run did not complete target-head source validation.
  The audit cannot claim semantic completeness: 1,023 commits and final validators are missing. Current evidence is
  also too coarse for claim-level navigation because it stores paths but not trusted symbols/line ranges.
- Normal updates currently submit complete Markdown, convert the whole document to BlockNote, synchronize the whole
  Canvas, and preserve a complete CanvasVersion. Whole snapshots are correct for history/restore, but using whole
  replacement as the mutation primitive increases model tokens, human-edit conflict surface, and accidental
  omission risk.

- [x] T27.11.1 Make incomplete History Window completion recoverable. If a generator callback says `completed` but
      the mandatory endpoint is absent, inspect the server-owned window, completed checkpoint prefix, pending page
      evidence, and `nextIndex`; requeue only the remaining suffix with a fresh bound Claw session. Fail only after
      a bounded repeated no-progress policy, cancellation, or a proven non-retryable invariant violation. A Docker/
      backend/Claw restart must not discard or reinterpret endpoint identity. Cover the observed two-intermediate-
      checkpoints-then-complete trace and restart between every durable transition.
- [x] T27.11.2 Separate infrastructure/tool recovery from semantic agent failure. Classify sandbox timeout/death,
      missing sandbox, backend `fetch failed`, proxy disconnect, and Spaces timeout as retryable transport states;
      recreate/setup once from trusted execution context and suppress predictable follow-on calls while unhealthy.
      Expose retry counts and the last infrastructure cause in progress/debugger data. Never accept prose completion
      as proof that a required endpoint exists.
- [x] T27.11.3 Make source verification precise and cheap. Return `INVALID_SOURCE_PATH` with the exact missing path
      and assigned ref instead of mapping a GitHub contents 404 to “repository or branch not found”. Add a bounded
      batch/preflight source verifier so the agent can remove invalid paths before a page mutation without one
      remote request/failure loop per path. Keep server verification authoritative for public/private repositories,
      renamed/deleted files, and intermediate refs.
- [x] T27.11.4 Repair same-checkpoint mutation semantics without allowing parallel or out-of-order writes. Before
      endpoint finalization, permit a serialized corrective replacement/archive/move of a page already written by
      the same bound session and checkpoint, using its latest expected hash and replacing the pending evidence
      atomically. Preserve idempotency and Canvas identity/version history. This must let the agent remove an
      accidental page in the same checkpoint while still rejecting stale, foreign-session, and concurrent writes.
- [x] T27.11.5 Add a narrow section/block mutation mode for existing Wiki pages. Keep full Markdown for page create,
      restore, archive, and an explicit whole-page rewrite fallback. For normal updates, accept one serialized
      operation per call (`replace_section`, `insert_section`, or `remove_section`) against a unique heading/stable
      block anchor plus the expected live page hash. Apply it server-side to current content, reject ambiguous/stale
      anchors, preserve untouched blocks and human edits, revalidate complete active sources, then store/sync/index
      the resulting **full** Canvas and full CanvasVersion snapshot. Do not store deltas as the only recovery state.
      Compare token use, conflicts, and omission behavior against the audited whole-page path.
- [x] T27.11.6 Add trusted repository-source citations as a rendering feature, not agent-authored external URLs.
      Define a small inline source-reference contract carrying repository-relative path, checkpoint/commit ref,
      optional symbol, and optional validated start/end lines. The backend resolves the attached provider/repository,
      validates the ref/path/range, and persists the structured reference with Wiki content/revision evidence. The
      Canvas client renders a distinct GitHub-style citation chip/icon and builds the canonical GitHub blob URL
      (`#Lx-Ly` when lines exist); keep the provider adapter/render seam ready for Bitbucket/GitLab without asking
      the model to construct URLs. File-only citations open the file at the trusted commit. Invalid/unresolvable
      references render safely as non-clickable evidence, never as arbitrary links.
- [x] T27.11.7 Render fenced `mermaid` blocks inside Wiki Canvases. Preserve the code-block language through
      Markdown↔BlockNote conversion, reuse the existing sanitized Mermaid renderer and source/preview controls,
      retain an editable source fallback, and show a bounded parse error without breaking the page. Do not execute
      Mermaid links/scripts or trust diagram URLs. Add conversion, Canvas read/edit, version restore, theme, and
      invalid-diagram coverage. Keep the prompt rule that diagrams are optional, focused, and evidence-backed.
- [~] T27.11.8 Add a deterministic post-run content audit before Standard/Thorough completion: active scratch pages,
      duplicate topic/content hashes, active pages under `archive/`, missing index links, empty or stale sources,
      unsupported source citations, broken Mermaid, suspiciously broad rewrites, and pages untouched despite source
      overlap. Validator findings remain read-only until the normal correction role confirms them against code.
      Report “not validated” rather than implying missing data is complete.
- [x] T27.11.9 Add an authorized, human-triggered repair plan for the preserved Wiki. Preview proposed archive/move/
      merge operations for the two scratch pages and active `archive/` topics, including Canvas/version/source
      identity effects. Apply nothing automatically; a human approves each repair or starts a fresh Retry/Refresh.
- [x] T27.11.10 Verification and stop gate: add focused recovery replay, source-error, same-checkpoint correction,
      section mutation, citation URL/security, Mermaid Canvas, Wiki Map, page-planning/editorial quality, and audit
      tests; run relevant typechecks/builds and a focused synthetic sample only. Then stop and hand configured and
      large-run testing back to the human. Do not resume or stress the preserved 1,525-commit execution autonomously.
- [x] T27.11.11 Add a server-generated **Wiki Map** as compact routing memory. Derive it from authoritative active
      Canvas metadata rather than asking the agent to maintain another free-form page. For every Wiki page expose
      its relative path, one-line purpose, concepts/topics owned, source areas, last checkpoint, and archive state.
      Return this compact map through the Wiki list/read context before generation so the agent updates an existing
      owner page when a concept fits, creates a new page only when no current page owns it, and proposes an explicit
      merge/move/archive when ownership overlaps or becomes obsolete. Keep the conceptual folder families flexible
      (`concepts/`, `subsystems/`, `flows/`, `interfaces/`, `operations/`, `decisions/`) rather than treating them as
      a mandatory template. Optionally render the same derived map as `wiki-map.md`/Wiki navigation for humans, but
      never make that rendered page the source of truth. Rebuild it deterministically after create, section edit,
      move, archive, restore, or title/purpose changes; cover stale-map prevention, duplicate-topic detection,
      compaction recovery, and large-Wiki bounded-context behavior.
- [x] T27.11.12 Add evidence-backed diagram planning and lifecycle validation. Do not impose a diagram-per-page
      quota. During bootstrap and when a History Window changes relationships, identify high-value diagram slots:
      system/component topology (`flowchart`), ordered synchronous/asynchronous interaction (`sequenceDiagram`),
      entity lifecycle (`stateDiagram-v2`), and durable entity relationships (`erDiagram`). A candidate normally
      needs at least three meaningful nodes and relationships that are materially clearer visually than in prose.
      Require a short diagram purpose/title, focused scope, labelled important edges, logical subgraphs/participants,
      and source evidence for every non-obvious node/edge; keep diagrams roughly 5–20 nodes and split larger ones.
      Do **not** add a diagram-specific agent tool. The agent writes ordinary fenced `mermaid` Markdown through the
      existing page-create or section/block mutation interface; the server parses it during normal page validation
      and persists the complete resulting Canvas/version. Give diagram sections stable headings/anchors so later
      windows can update or remove them with the generic section operations. The Wiki Map should inventory diagram
      purpose/type/page so later windows update an existing diagram when its architecture changes instead of
      duplicating or silently leaving it stale. Standard/Thorough validators must flag missing high-value diagrams,
      unsupported relationships, stale diagrams, unreadable density, decorative diagrams, and prose/diagram
      contradictions; Quick keeps diagrams optional. Cover the observability-style application → collection →
      storage → visualization flow, sequence, state, ER, rename/removal, invalid syntax, stale-source, and
      no-diagram-is-correct cases.
- [~] T27.11.13 Add a staged information-architecture and editorial-quality pipeline rather than relying on one
      larger generator prompt. Keep the configured **SDLC agent** and existing Wiki tools; use bounded role-specific
      runs/instructions, not a new agent type. Bootstrap first builds a structured repository survey and proposed
      Wiki plan before writing pages. The plan must contain conceptual page/folder path, one-line purpose, concepts
      owned, priority, page archetype (`overview`, `subsystem`, `flow`, `data-model`, `interface`, `operations`, or
      `decision`), likely source areas, related pages, and useful table/diagram candidates. Validate and de-duplicate
      it against the server Wiki Map, then generate or update one page/section at a time from a bounded evidence
      packet; do not pass an unbounded repository dump or ask one run to invent the taxonomy, investigate every
      subsystem, write many pages, and validate itself simultaneously.
      Use archetype-specific briefs rather than forcing one universal template. Every substantial page should answer
      the applicable WHAT, HOW, WHY, failure/constraint, and WHERE-in-code questions; use consistent headings,
      compact responsibility/configuration/contract tables where useful, cross-links to owning concepts, and source
      evidence adjacent to important claims. Split an oversized mixed-topic page instead of growing it indefinitely.
      After each new page or major restructuring, run a bounded editorial role that checks conceptual coverage,
      information order, density, unsupported rationale, repetition, stale paths, cross-links, table/diagram value,
      and agreement between prose and evidence. It may request corrections only through the normal serialized Wiki
      mutations. Quick performs structural checks; Standard adds the page editorial pass and end-of-run coverage
      review; Thorough adds a second architecture/operations gap review. Add deterministic rubric fixtures covering
      a polished observability page, a no-diagram page, a deliberately shallow file inventory, an oversized page
      needing a split, and an incremental update that must preserve existing context. The target is stable,
      source-grounded technical memory—not a copied DeepWiki layout, diagram quota, marketing prose, or symbol dump.

Implementation evidence (2026-08-12): version-2 generator callbacks now requeue a durable unfinished window suffix
with a fresh session, retain `nextIndex`/checkpoint history, expose recovery cause/counts, retry classified transport
failures, and stop after three no-progress recoveries. Wiki writes support serialized same-session corrections and
generic unique-heading section replacement/insertion/removal while persisting full CanvasVersion snapshots. Source
preflight reports the exact invalid path, structured `[[source:N]]` references are resolved server-side to trusted
GitHub blob/line URLs, the list tool returns a derived Wiki Map, and Canvas code blocks with language `mermaid` use
the existing sanitized Mermaid renderer with an editable source fallback. Standard/Thorough validation now appends
a deterministic structural audit, and the authenticated repair-preview endpoint is read-only.

Bootstrap is now a durable same-agent sequence: bounded repository survey and page plan, exactly one planned page
write per run, a separate read-only editorial run for Standard/Thorough, at most one serialized correction and a
second review, then a final checkpoint-only run. Each role receives only its required tools, and every transition
reloads the server-owned execution context, so compaction or a fresh Claw session cannot replace trusted IDs,
commit order, plan position, pending revisions, or source evidence with model memory.

Focused verification: backend, Claw Auth, Dashboard, shared-contract, and Claw TypeScript checks pass; Dashboard
production build passes with `NODE_OPTIONS=--max-old-space-size=8192`; 67 focused Jest tests pass across execution
recovery/staged bootstrap/page persistence (30), section/source/Mermaid mutation and security (16), and Wiki Map/
content-audit/prompt/GitHub validation (21). Jest emits expected local database-cleanup warnings because no test
database is configured. No configured or large live Wiki run was started; the human owns that stress test.
T27.11.8 remains partial only because deterministic changed-source overlap evidence is not yet supplied to the audit.
T27.11.13 remains partial because the durable editorial pass currently covers bootstrap-created pages; later
History Window page creations/major restructures still rely on end-of-run review rather than a separate per-page
editorial run.

### T27.11.14 — Recovery/debugger and bootstrap write repair

- [x] Restore the existing native Claw debugger trace as authoritative. Remove the temporary active-AgentRun merge
      that replaced native LLM/thinking/assistant events with a DB-only tool list. The SDLC execution debugger may
      show both native attempts after recovery and opens the newest trace; do not redesign the generic debugger.
- [x] Preserve logical execution identity across Claw recovery. A continuation keeps its fresh physical AgentRun ID
      for diagnostics, but its external SDLC callback uses the original recovery-root session ID so the durable Wiki
      execution accepts completion, advances the bootstrap page, and queues the next role exactly once.
- [x] Harden bootstrap page mutations: normalize planned paths to `.md`, preserve nested paths, drop unsafe or
      duplicate normalized plan entries, advertise action-specific required fields in the MCP schema, report request
      validation as HTTP 400, return precise zero-based citation bounds, and stop an initial bootstrap writer after
      its first successful page mutation. Corrections remain separate scheduled roles.
- [x] Add focused regression tests and typechecks for these seams. Do not restart the cancelled run or start a large
      sample/stress run; after automated verification, the human starts and owns the next configured Wiki run.

Verification (2026-08-12): backend Wiki execution/page-store/source-reference suites pass 37/37 sequentially;
Claw Auth Wiki tool-schema tests pass 4/4; backend, Claw Auth, and Dashboard typechecks pass; `git diff --check`
passes. No replacement Wiki run or stress test was started.

### T27.11.15 — Bootstrap page-run isolation regression

- [x] Scope the one-write bootstrap invariant to the current physical page-writer session and its normalized planned
      path. Pending bootstrap evidence intentionally accumulates until finalization; evidence written by an earlier
      page agent must neither block the next planned page nor satisfy its callback.
- [x] Persist the writer session with pending page evidence, retain backward parsing for in-flight legacy evidence,
      make identical same-run retries idempotent, reject cross-page writes and second mutations, and keep separately
      scheduled correction roles functional.
- [x] Cover page 1 → page 2 accumulation, assigned-path enforcement, same-run duplicate rejection, and callback
      rejection of another session's evidence. Backend page-store/execution suites pass 34/34 sequentially and the
      backend typecheck passes. Do not automatically restart the failed configured run; the human owns Retry.

### T27.11.16 — Canvas code and Mermaid presentation

- [x] Restore syntax highlighting for ordinary editable Canvas code blocks using a non-interactive highlighted
      mirror beneath BlockNote's authoritative editable content; preserve selection, caret, copying, language, and
      horizontal scrolling.
- [x] Make Mermaid rendering observe the live application theme, re-render and cache light/dark SVGs separately,
      use themed diagram/preview surfaces, and show the Diagram/Code/download controls only on Canvas hover or
      keyboard focus. Keep the shared Chat Mermaid toolbar behavior unchanged.
- [x] Dashboard typecheck, targeted lint (no errors), and `git diff --check` pass.

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

## V2 backlog — SDLC queue retention

- [x] V2Q.1 Start with one `sdlc` queue, worker env isolation, nine global active permits, three per repository,
      and repository round-robin admission.
- [x] V2Q.2 Start with count-based Redis history: newest 100 completed and 500 failed Bull jobs.
- [ ] V2Q.3 Replace or supplement count-only history with explicit completed/failed time windows before sustained
      production queue volume; document Redis sizing and diagnostic-history requirements first.

## V2 backlog — conversation and Ask AI convergence

- [ ] V2C.1 Define how SDLC-owned human conversations appear in common/global Ask AI chat without weakening
      repository membership or linked-source ACLs.
- [ ] V2C.2 Decide whether AI history is pipeline-owned, entity-owned, user-owned, or a selectable mix before
      changing current Assistant session behavior.
- [ ] V2C.3 Decide global Wiki/Pull Request entry points, cross-surface deep links, and mobile behavior only after
      desktop SDLC conversation usage is validated.

### Known delivery limitations

- Local PostgreSQL/Redis and configured Claw/Kata/GitHub/S2S smoke completed against
  `ameernoufil/pets-workshop`: five approved baselines, PRD, Tech Doc, Ticket, selected safe branch,
  draft PR #1, merge reconciliation, and Ticket Done.
- The repository's historical clean-database migration chain currently fails before this feature at `20250311192600_add_ticket_to_external_entity_type` because `ExternalEntityType` does not yet exist. The current Prisma schema pushes successfully, and the new SDLC migration applies successfully against a reconstructed pre-SDLC schema.
- Backend full-repository lint is red on 252 pre-existing errors; all changed SDLC backend files pass targeted lint.
- Dashboard full lint passes with its existing warning baseline.
- Bitbucket Server represents draft state with a `[Draft]` title prefix because its current provider adapter has no native draft flag.
- Focused policy/domain tests cover the SDLC Chat state and ownership seams; authenticated browser acceptance
  remains tracked separately in T23.9.
- Dashboard production build requires an 8 GB Node heap in this worktree; it completes with
  `NODE_OPTIONS=--max-old-space-size=8192` and reports only existing bundle/chunk warnings.
- Claw Auth typecheck passes. Its full suite currently has four unrelated mention-transform mock failures while
  304 tests pass.
