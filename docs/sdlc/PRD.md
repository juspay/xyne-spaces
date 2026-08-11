# AI SDLC Hub v1 — Product Requirements Document

Status: implementation source of truth
Owner: Xyne Spaces
Scope: desktop web, v1
Last updated: 2026-08-04

## 1. Product summary

AI SDLC Hub is a repository-scoped workspace inside Xyne Spaces. It turns an attached code repository into durable engineering context, then connects PRDs, Tech Docs, Tickets, code changes, and pull requests in one traceable flow.

The v1 hub reuses Projects, Channels, Canvases, Canvas Folders, Tickets, Boards, Workflow Executions, Knowledge Documents, repository automation, Vespa search, and the existing AI sidebar. New persistence is limited to repository-to-hub fields, one generic entity-link table, and one encrypted workspace VCS credential record per provider.

## 2. Problem

Engineering intent is fragmented across chats, emails, calls, documents, tickets, and code. Coding agents repeatedly rediscover repository conventions and cannot reliably show why a change exists or which source supports an answer. Teams lack one view connecting a PRD to implementation and pull request.

## 3. Goals

1. Let a Project member attach a repository and enter its dedicated SDLC hub.
2. Generate an editable, reviewable baseline memory from repository source.
3. Let teams create PRDs, Tech Docs, and Tickets as linked canvases/tickets.
4. Link only real source context used by humans or AI.
5. Start coding work with approved repository memory and the current artifact chain.
6. Track work from Backlog through pull-request review and merge.
7. Reuse existing data models and infrastructure wherever practical.
8. Let workspace administrators configure one shared GitHub credential for public/private repository access without exposing it to repository members.
9. Verify repository capabilities before baseline generation and progressively unlock SDLC surfaces only when their prerequisites pass.

## 4. Non-goals

v1 does not include:

- mobile layouts;
- baseline drift detection or automatic regeneration after merges;
- agentic Wiki generation, refresh scheduling, drift detection, or source-link reconciliation;
- canvas version history or dirty-state tracking;
- code indexing in Vespa;
- GitHub App installation, OAuth, classic PAT, SSH/deploy-key credential UX, or GitHub Enterprise;
- Bitbucket/GitLab SDLC adapters, fork-based contribution, multiple VCS credentials per workspace, or multiple GitHub resource owners;
- transport-level enforcement of the allowed push branch or removal of the PAT from the agent-controlled sandbox;
- multi-repository artifacts or cross-repository links;
- multiple Tickets per PRD/Tech Doc or dependency scheduling;
- Tech Doc-level batch start and sequential orchestration across multiple Ticket tickets;
- automatic merge;
- suggested-diff review;
- Feedback, Quick Start, Automations, or test-management modules;
- repository detach/delete after setup;
- new automated test suites or unit tests.

Existing build, typecheck, lint, enum, and manual smoke checks remain release gates.

Deferred credential, provider, fork, enterprise, and enforcement choices are recorded in
[DECISIONS_NEEDED_FOR_V2.md](./DECISIONS_NEEDED_FOR_V2.md).

For v1, implementation runs are started from each Ticket ticket. A Tech Doc-level action that
discovers multiple tickets, executes them in dependency order, and stops the chain on failure is deferred
to v2.

## 5. Users and access

### 5.1 Roles

- **Workspace credential admin:** workspace owner/admin who can configure, validate, replace, or disconnect the shared VCS credential.
- **Project-authorized user:** user with the existing Project access needed to manage project boards; this user may attach repositories.
- **Repository admin:** user who attaches the repository, plus channel admins added later.
- **Repository member:** user who belongs to the hidden repository channel.
- **Non-member:** workspace user outside that channel.

### 5.2 Access matrix

| Capability                                | Admin                 | Member                | Non-member |
| ----------------------------------------- | --------------------- | --------------------- | ---------- |
| See repository in SDLC app                | Yes                   | Yes                   | No         |
| See credential identity/status            | Yes                   | Yes                   | No         |
| Configure/replace/disconnect credential   | Workspace admin only  | No                    | No         |
| Run/retry repository access check         | Yes                   | Yes                   | No         |
| Manage repository members                 | Yes                   | No                    | No         |
| Start/retry/cancel/restart baseline setup | Yes                   | No                    | No         |
| Edit/approve baseline canvases            | Yes                   | View only             | No         |
| Create/edit PRDs and Tech Docs            | Yes                   | Yes                   | No         |
| Create/link/start Tickets                 | Yes                   | Yes                   | No         |
| Use repository AI chat                    | Yes                   | Yes                   | No         |
| Read linked context                       | Subject to source ACL | Subject to source ACL | No         |

The hidden repository channel is an authorization boundary. It must not appear in normal Chat navigation, but its conversations store SDLC AI history. Source-level ACLs still apply when linked or retrieved content comes from elsewhere.

The token is never returned to any user after save. Project-authorized users may attach private repositories using the shared capability, but cannot read the credential.

## 6. Information architecture

### 6.1 Global SDLC app

`/sdlc` is a top-level desktop application. Its repository list contains only repositories whose hidden repository channel includes the current user.

Each repository opens one hub with:

- Overview;
- Wiki;
- Baseline;
- PRDs;
- Tech Docs;
- Tickets.

Layout:

- existing global navigation rail;
- repository/module rail;
- main content area;
- persistent AI sidebar in SDLC mode;
- contextual Related drawer, absent from Overview and opened explicitly from a specific canvas.

The visual signature is a truthful trace spine:

`PRD → Tech Doc → Ticket → Pull Request`

Missing optional entities appear as absent steps, never fabricated links.

### 6.2 Repository folders

Each hidden repository channel owns three flat Canvas Folders:

- `Baseline`
- `PRDs`
- `Tech Docs`

`SDLC` is the repository-level hub, not a global canvas folder. Tickets reuse Tickets and therefore do not require a canvas folder.

The temporary Wiki importer creates source-managed folders named `Wiki` or `Wiki/<source-directory>`.
Each Research Agent Markdown file maps to exactly one private repository-channel Canvas. Folder names and
Canvas metadata preserve the source path, while the Wiki screen reconstructs them as a directory tree.
Repeated imports upsert by source path and never delete missing pages. Wiki availability is independent of
baseline generation and approval gates.

### 6.3 Project repository navigation

Project Detail uses the tab order `Boards → Repos → Release`. The Repos tab owns repository listing,
attachment, access-check status, capability status, and **Open SDLC** actions. Repository attachment is
not a header-only action.

### 6.4 Progressive hub gate

The hub itself, rather than a separate onboarding product, presents this durable progression:

`Access check → Baseline generation → Five approvals → PRDs/Tech Docs/Tickets`

Baseline generation stays locked until repository read access passes. Artifact modules and creation
commands stay locked until all five baseline documents are approved. Start Work additionally requires
direct branch-push and pull-request creation capability.

## 7. Repository attachment

### 7.1 Entry point

Project Detail's Repos tab adds an **Add Repository** action. Any project-authorized user provides repository URL, display name when it cannot be inferred, and base branch. Branch naming comes from approved repository conventions, not attachment input.

### 7.2 Canonical identity

Repository URLs are normalized before persistence. Equivalent HTTPS/SSH forms, trailing `.git`, trailing slash, host casing, and repository-path casing rules must resolve to one canonical identity where the provider treats them equivalently.

`canonicalUrl` is unique within a workspace. One canonical repository has one SDLC hub. Existing legacy repository records remain readable.

### 7.3 Workspace VCS credential

Workspace Management lets a workspace owner/admin configure one GitHub.com fine-grained PAT. The token
has one GitHub resource owner and should be limited to selected repositories with Metadata read,
Contents read/write, Pull requests read/write, and Workflows read/write. Workflows write is required by
GitHub when a coding task changes `.github/workflows/*`. Read-only credentials remain valid for private clone
and baseline use but do not unlock Start Work.

Credential state is workspace-owned and encrypted with authenticated encryption. Only status,
authenticated GitHub identity, resource owner, fingerprint, validation timestamp, and error metadata are
readable. Replacement validates before atomic swap; disconnect invalidates repository capability checks.
Legacy deployment GitHub/Bitbucket credentials are not used as SDLC fallbacks. Existing SDLC credential rows are migrated once by the temporary authenticated migration script before the legacy table is dropped.

The provider interface and persistence are generic. GitHub.com is the only v1 adapter; future Bitbucket
and GitLab support must add adapters without changing hub routes, gates, or generic credential shape.

### 7.4 Cheap-shell transaction

Attachment creates, in one transaction:

1. Project-linked Repo;
2. hidden private repository Channel with metadata identifying the SDLC surface and Repo;
3. attacher as channel admin;
4. Baseline, PRDs, and Tech Docs folders;
5. one Project-level SDLC Board if the Project does not already have one;
6. Backlog, In Progress, In Review, and Done stages on that board.

After the transaction commits, attachment queues a non-mutating repository access check, not baseline
generation. Clone and AI work remain outside the attachment transaction, so dispatch failure cannot
corrupt the repository shell. Success shows **Take to SDLC** and access progress is visible in the hub.

### 7.5 Repository access check

The durable access check resolves GitHub identity, repository identity/visibility, configured base branch,
API read access, and authenticated Git read access. It reports normalized `READ_REPOSITORY`,
`PUSH_BRANCH`, and `CREATE_PULL_REQUEST` capabilities with truthful evidence/confidence.

The check never creates a branch, commit, pull request, issue, or other remote resource. GitHub does not
provide a non-mutating fine-grained-PAT introspection call that proves every later write; therefore read
access is proven, write/PR capability may be inferred from repository role and configured permission
requirements, and the real push/PR call is final proof.

Public repositories may pass read access anonymously when no valid credential exists. Private
repositories remain blocked without credentialed read access. A successful read check enables
**Next: Generate baseline** for repository admins. Results become stale after credential revision.

## 8. Baseline setup

### 8.1 Trigger

Repository attachment does not start baseline generation. After repository read access passes, a repository
admin selects **Next: Generate baseline**, which starts one ticketless durable Workflow Execution.
Admins can retry failed/cancelled executions and cancel or restart an active execution from the hub. Only one
setup execution may run at a time.

### 8.2 Execution model

- use the existing Claw `ask-ai` agent and one stable setup conversation;
- provision an isolated, read-only repository sandbox pinned to the selected base branch;
- support public GitHub HTTPS repositories anonymously and private GitHub.com repositories through the workspace credential, without the old static clone allowlist;
- generate documents sequentially so progress is understandable and resumable;
- persist each completed Canvas immediately;
- store durable execution state in PostgreSQL;
- use Redis only for live progress, locks, and resume cache;
- on retry, preserve completed documents and resume at the first missing/failed document;
- reject non-GitHub.com, credential-bearing, malformed, or unsafe repository URLs;
- retrieve private clone credentials only through a sandbox bootstrap endpoint that creates and redeems an
  `sdlc-agent`/execution/repository/session-bound one-use runtime grant internally; the agent sees one
  `sandbox-repo-setup` call while trusted Claw performs key/script Kata operations beneath that tool;
- fetch the PAT account identity only inside the sandbox after decryption and use its ID-based GitHub noreply
  address for both commit author and committer; do not persist or forward the derived commit name/email through backend/Claw;
- never persist the PAT in workflow context, queues, prompts, conversations, debug artifacts, Redis progress, logs, or Zero;
- never push, create branches, or modify source during setup.

Claw creates each baseline canvas directly through the narrow `spaces-sdlc-create-artifact` tool. The
backend derives its folder, visibility, membership, and metadata; the model cannot select arbitrary storage
or create a placeholder. A durable callback advances the next baseline step only after the expected canvas
exists. The worker periodically reconciles stale executions against Claw's authoritative run record, so a
lost callback still reaches a terminal state.

### 8.3 Required baseline canvases

1. **Core Code Map**
   - system architecture and boundaries;
   - application/service entry points;
   - major modules and ownership;
   - exported/public APIs;
   - critical internal function chains and data flow;
   - exact source paths and symbols;
   - omit trivial helpers, generated code, dependencies, and vendor code.
2. **Frontend Design System**
   - applicable frontend stacks;
   - tokens, typography, spacing, color, icons, and component patterns;
   - layout, accessibility, and responsive conventions;
   - identify when repository has no frontend.
3. **Code & Lint Standards**
   - formatter, linter, type-system, naming, imports, error handling, and repository conventions;
   - source config paths and runnable commands.
4. **Run Guide**
   - prerequisites, environment setup, dependencies, services, development commands, and common failure notes;
   - secrets named but never copied into canvas content.
5. **Test Guide**
   - existing test layers, locations, commands, fixtures, and CI expectations;
   - v1 implementation itself adds no new automated tests.

Generated canvases carry metadata containing Repo ID, artifact kind, baseline key, setup/workflow execution
ID, approval timestamp/user, and Knowledge Document ID. A generation commit is stored when the sandbox
provides one.

### 8.4 Progress states

Repository setup state is derived as:

- `NOT_STARTED`
- `QUEUED`
- `CLONING`
- `GENERATING`
- `PARTIALLY_FAILED`
- `CANCELLED`
- `READY_FOR_REVIEW`
- `APPROVED`

UI shows current document, completed count out of five, last durable update, and actionable error. Refresh/reconnect must recover from DB truth when Redis state is absent.
Admins can open the existing Ask AI debug panel for the setup conversation; repository-scoped backend
authorization permits the run owner and repository admins without exposing the trace to ordinary members.

## 9. Baseline review and memory

- Baseline canvases use the existing collaborative editor.
- Admins can edit; members are viewers.
- Each canvas has **Approve memory**.
- Approval creates or updates exactly one Knowledge Document for that baseline canvas, then writes approval metadata back to the canvas.
- Re-approval updates the same Knowledge Document with current canvas content; it does not create duplicates.
- Approval is manual and independently repeatable for all five canvases.
- PRD, Tech Doc, Ticket, and coding work is blocked until all five baseline canvases are approved.
- Approved snapshots become repository permanent memory for AI retrieval.

No v1 dirty indicator is promised after an approved canvas is edited.

## 10. Artifacts

Every artifact list/create/open command requires a successful repository read check and all five approved
baseline canvases. The UI disabled state is explanatory, but the backend remains authoritative.

### 10.1 PRDs

PRDs are canvases in the PRDs folder. A PRD contains overview, terminology as needed, requirements/user stories, and acceptance criteria. Humans or AI may create directly editable drafts.

### 10.2 Tech Docs

Tech Docs are canvases in the Tech Docs folder. A Tech Doc translates one PRD into architecture, affected modules, data/API changes, rollout notes, and verification approach.

### 10.3 Tickets

Tickets reuse existing Tickets on the Project SDLC Board. New Tickets start in Backlog and remain governed by existing ticket authorization and activity mechanisms.

### 10.4 v1 cardinality

One chain supports:

- one PRD;
- zero or one Tech Doc linked to that PRD;
- zero or one Ticket linked to the PRD or Tech Doc;
- zero or more pull-request updates associated through existing PR tracking, with one active implementation path expected.

Starting work from a PRD or Tech Doc reuses its linked Ticket. If none exists, the system creates and links one automatically.

## 11. Entity links and context

One generic `SdlcEntityLink` stores hierarchy and evidence links across:

- canvases;
- tickets;
- channels;
- conversations;
- messages/threads;
- emails;
- calls;
- recordings;
- attachments;
- pull requests where a stable local identifier exists.

Each link stores workspace, repository, source type/id, target type/id, relation type, creator, and timestamp. Duplicate links are rejected. v1 one-to-one PRD→Tech Doc and artifact→Ticket relations are enforced by service logic and database indexes where safe.

AI may link only inputs explicitly selected by a user or sources actually retrieved/cited during generation. It must not add speculative related items. Humans may open Related from a specific canvas and add/remove its links there. The repository Overview never shows a repository-wide Related drawer. Reading a link never bypasses the linked entity's ACL.

## 12. AI experience

The existing Xyne AI sidebar runs in SDLC mode. Repository channel conversations retain history.

Default context:

1. five approved baseline memories;
2. current PRD/Tech Doc/Ticket chain;
3. explicitly linked context the user can access;
4. repository channel conversation history.

For an interactive repository question, the SDLC Assistant searches the relevant live code, imported Wiki,
PRDs, Tech Docs, Tickets and their conversations, baseline memory, linked context, and repository-channel
history before converging on an answer. Workspace-backed claims retain normal inline citations. Code answers
show the smallest relevant excerpt before its explanation and include repository-relative path, symbol, and
line range. This retrieval guidance is interactive-only and does not change baseline or Start Work execution.

Wider workspace sources require explicit user selection or normal authorized retrieval. Existing search/retrieval infrastructure remains responsible for emails, chats, canvases, calls, recordings, and attachments.

Code questions use the live checked-out repository through read-only tools. Answers show exact relevant snippets with path, symbol, and line range inline. v1 does not create a Vespa code index.

AI artifact actions reuse `ask-ai` and create editable PRD or Tech Doc canvases directly through the
narrow SDLC artifact tool. They are asynchronous and do not pre-create placeholder canvases. Explicit user
requests made in the SDLC Ask AI window receive repository identity and tool instructions so PRDs or
Tech Docs land in the correct repository folders. Generated content is never treated as approved baseline
memory automatically.

Before all five baseline approvals, the SDLC Ask AI experience may explain setup/read status but must not
create PRDs, Tech Docs, or Tickets through tools.

## 13. Start Work

### 13.1 Preconditions

- caller is repository member;
- latest repository access check is ready for the current credential revision;
- all five baseline canvases are approved;
- PRD/Tech Doc/Ticket belongs to this repository chain;
- repository has `READ_REPOSITORY`, `PUSH_BRANCH`, and `CREATE_PULL_REQUEST` capability;
- no conflicting active implementation workflow exists for the Ticket.

### 13.2 Agent context

The existing Claw `ask-ai` agent receives one platform-verified SDLC context wrapper on every start,
resume, retry, handoff, and post-compaction continuation. It contains durable IDs, repository/base branch,
permissions, gates, and execution/artifact scope, but never secrets or runtime grants. It also receives:

- approved baseline memory;
- current linked artifact chain;
- actual linked citations/context authorized for caller;
- repository channel history;
- existing site/repository retrieval tools.

### 13.3 Behavior

For SDLC work only, Claw overlays the required sandbox and narrow SDLC VCS tools onto `ask-ai`; no new
agent is created. The agent:

1. clones or reuses a repository-pinned writable sandbox;
2. creates a safe non-default work branch following the approved Code & Lint Standards branch conventions;
3. edits code;
4. runs repository-specified checks where safe;
5. commits and pushes only that non-default feature branch directly to the attached repository;
6. opens a draft pull request;
7. links/tracks the pull request on the Ticket;
8. never pushes the base/default branch, force-pushes, or merges.

The sandbox generates an ephemeral X25519 keypair after a Node.js crypto preflight. The workspace PAT is
delivered only as an authenticated encrypted envelope bound to the grant, execution, session, sandbox,
operation, credential revision, and expiry; it is decrypted inside the sandbox and installed in a restrictive
randomized helper. Key/envelope/bootstrap material is removed after setup; run-finally cleanup removes helper
material on success, failure, cancellation, or timeout, and cached reuse performs a fresh bootstrap. v1
accepts that agent-controlled sandbox code can potentially access/transform the long-lived PAT while it is
present; output redaction is defense in depth, not a complete control. Tokens must be fine-grained,
repository-limited, expiring, and lack merge/default-branch-bypass/administration permissions. A broker or
trusted backend push flow and transport-level allowed-ref enforcement are v2 decisions.

The completion callback accepts only a real GitHub pull-request URL belonging to the attached repository.
A compare URL or foreign PR fails the execution. The callback records the branch, commit, PR link, and moves
the Ticket to In Review.

Stage movement:

- work started → In Progress;
- pull request created or updated → In Review;
- pull request merged → Done.

Tracked open SDLC pull requests are reconciled through the provider adapter. Merge moves the linked Work
Order to Done without requiring each attached repository to install a webhook.

## 14. Data changes

### 14.1 Repo extensions

- `projectId` — owning Project;
- `channelId` — hidden SDLC Channel; v1 creates one per repository, while persistence permits multiple repositories per Channel for v2;
- `canonicalUrl` — workspace canonical identity;
- `sdlcSetupExecutionId` — current/latest setup Workflow Execution.
- access-check status, normalized capabilities/evidence (including cached visibility), credential revision,
  checked time, and actionable error metadata.

### 14.2 Project extension

- `sdlcBoardId` — shared SDLC Board for all repository Tickets in the Project.

### 14.3 SdlcEntityLink

- `id`
- `workspaceId`
- `repoId`
- `sourceType`
- `sourceId`
- `targetType`
- `targetId`
- `relationType`
- `createdBy`
- `createdAt`

Types are strings validated by shared Zod unions. No new PostgreSQL/Prisma enum is introduced.

### 14.4 Workspace VCS credential source

One active, deterministically named `ExternalSource` per workspace/provider uses source type
`sdlc_vcs_credential`. Its authenticated AES-256-GCM credentials envelope stores the token plus revision,
validation, identity/resource-owner/fingerprint, actor, and timestamp metadata. Ciphertext is never mirrored
into Zero. The temporary legacy credential table is migrated and removed.

## 15. Deep module interface

Business invariants live behind one backend `SdlcHub` module:

```ts
interface SdlcHub {
  attachRepository(input: AttachRepositoryInput): Promise<RepositoryHub>;
  setupRepository(input: SetupRepositoryInput): Promise<SetupExecution>;
  retrySetup(input: RetrySetupInput): Promise<SetupExecution>;
  cancelSetup(input: CancelSetupInput): Promise<SetupExecution>;
  restartSetup(input: RestartSetupInput): Promise<SetupExecution>;
  createArtifact(input: CreateArtifactInput): Promise<SdlcArtifact>;
  createArtifactFromClaw(
    input: CreateSdlcClawArtifactInput,
  ): Promise<SdlcArtifact>;
  getExecutionDebug(
    input: GetExecutionDebugInput,
  ): Promise<DebugArtifactBundle>;
  linkContext(input: LinkContextInput): Promise<SdlcLink>;
  unlinkContext(input: UnlinkContextInput): Promise<void>;
  approveBaseline(input: ApproveBaselineInput): Promise<ApprovedBaseline>;
  startWork(input: StartWorkInput): Promise<WorkExecution>;
}
```

Routes, Zero mutators, jobs, and AI tools are thin adapters. Canonicalization, ACL checks, setup idempotency, cardinality, approval gates, and board-stage rules remain inside the module.

Credential/provider complexity lives behind a separate deep `SdlcVcs` module. `SdlcHub` calls its small
interface for credential configuration, access checks, capability gates, runtime grants, draft PR creation,
and PR validation. `GitHubVcsAdapter` is the v1 provider adapter. See
[VCS_CREDENTIALS_PLAN.md](./VCS_CREDENTIALS_PLAN.md).

## 16. HTTP commands

- `POST /api/sdlc/repositories`
- `GET /api/sdlc/vcs/credentials`
- `PUT /api/sdlc/vcs/credentials/:provider`
- `POST /api/sdlc/vcs/credentials/:provider/validate`
- `DELETE /api/sdlc/vcs/credentials/:provider`
- `POST /api/sdlc/repositories/:repoId/access-check`
- `POST /api/sdlc/repositories/:repoId/setup`
- `POST /api/sdlc/repositories/:repoId/setup/retry`
- `POST /api/sdlc/repositories/:repoId/setup/cancel`
- `POST /api/sdlc/repositories/:repoId/setup/restart`
- `POST /api/sdlc/repositories/:repoId/artifacts`
- `GET /api/sdlc/repositories/:repoId/executions/:executionId/debug`
- `POST /api/sdlc/repositories/:repoId/links`
- `DELETE /api/sdlc/repositories/:repoId/links/:linkId`
- `POST /api/sdlc/repositories/:repoId/start-work`
- baseline approval may extend the existing knowledge approval command while preserving legacy behavior.
- `POST /api/sdlc/claw/artifacts` is the authenticated narrow Claw tool boundary.
- `POST /api/sdlc/claw/pull-requests` is the authenticated narrow draft-PR boundary.
- `POST /api/internal/sdlc/vcs/runtime-credentials/bootstrap` is S2S-authenticated, validates active durable
  execution/repository/session/operation scope, rejects reuse of one sandbox binding, and returns only ciphertext.
- `POST /api/internal/sdlc/claw-callback/:executionId/:step` is S2S-authenticated.

Request bodies are Zod-validated. Commands return stable IDs and current durable state. Expected conflicts return 409; authorization failures 403; absent resources 404; invalid input 400.

Read models and optimistic mutations must be mirrored across backend/dashboard Zero definitions, with shared schema in `packages/shared`.

## 17. Observability and failure behavior

- structured logs include workspace, project, repository, execution, artifact, and Ticket IDs;
- setup and coding workflows expose durable state and user-actionable error text;
- every SDLC Claw run stores its conversation/session IDs for debug inspection;
- no secret/token content enters logs or baseline canvases;
- no secret/token content enters Zero, workflow/queue context, Redis progress, prompts, conversations, or debug artifacts;
- credential create/replace/disconnect and repository access checks emit metadata-only audit events;
- attach is atomic;
- setup is idempotent/resumable;
- approval is an upsert;
- artifact/link creation is duplicate-safe;
- stale Redis state never overrides DB truth;
- coding workflow cannot merge and cannot start before approval gate.
- baseline cannot start before read access passes;
- artifact commands cannot start before read access and all-five approval gates;
- Start Work cannot start without current read/push/PR capability.

## 18. v1 acceptance criteria

1. Workspace owner/admin can validate/store/replace/disconnect one GitHub.com fine-grained PAT without any read path returning it.
2. The repository gets one hidden member-scoped channel, three folders, and the Project gets one four-stage SDLC board.
3. Project Detail uses `Boards → Repos → Release`; project-authorized users can attach repositories from Repos.
4. Attachment commits the cheap shell, then performs a durable non-mutating access check; it does not auto-start baseline.
5. Public repos can pass read-only without a PAT; credential-accessible private repos can pass read; missing read blocks baseline.
6. Only channel members see the repository in `/sdlc`; normal Chat omits the hidden channel.
7. Successful read enables **Next: Generate baseline**; setup uses `ask-ai` and ends with five editable canvases.
8. Failed/cancelled setup retry and active-run restart preserve completed canvases and resume remaining work.
9. Members view baseline; admins edit and repeatedly approve each document into one Knowledge Document.
10. PRD, Tech Doc, Ticket, and AI artifact creation remain disabled until all five approvals; backend rejects bypasses.
11. Start Work additionally remains disabled without direct branch push and draft-PR capability.
12. Trace spine accurately displays linked PRD, optional Tech Doc, Ticket, and PR state.
13. Related drawer adds/removes authorized real context without inventing links or bypassing ACL.
14. SDLC Ask AI creates artifacts only after gates and uses approved memory/current chain/linked context/channel history.
15. Start Work reuses `ask-ai`, pushes only a safe branch following approved baseline conventions, opens a draft PR, and never force-pushes/merges.
16. PR create/update moves Ticket to In Review; merge moves it to Done.
17. Repository admins can inspect baseline generation through the existing Ask AI debug panel without token disclosure.
18. Legacy Bitbucket/deployment GitHub behavior remains unchanged; shared/backend/dashboard/Claw builds and typechecks pass.
