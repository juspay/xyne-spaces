# AI SDLC Hub v1 — Product Requirements Document

Status: implementation source of truth
Owner: Xyne Spaces
Scope: desktop web, v1
Last updated: 2026-08-11

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
10. Keep human discussion attached to the SDLC item it explains while reusing normal Channel conversations and message behavior.
11. Generate and manually refresh a source-grounded repository Wiki by replaying selected base-branch history.

## 4. Non-goals

v1 does not include:

- mobile layouts;
- baseline drift detection or automatic regeneration after merges;
- scheduled, webhook-triggered, or automatic Wiki refresh;
- general Canvas dirty-state tracking outside the Wiki pipeline's optimistic content-hash check;
- code indexing in Vespa;
- GitHub App installation, OAuth, classic PAT, SSH/deploy-key credential UX, or GitHub Enterprise;
- Bitbucket/GitLab SDLC adapters, fork-based contribution, multiple VCS credentials per workspace, or multiple GitHub resource owners;
- transport-level enforcement of the allowed push branch or removal of the PAT from the agent-controlled sandbox;
- multi-repository artifacts or cross-repository links;
- dependency scheduling or automatic batch execution across multiple Tickets;
- automatic merge;
- suggested-diff review;
- Feedback, Quick Start, Automations, or test-management modules;
- repository detach/delete after setup;
- changing Ask AI session/history behavior or exposing SDLC conversations in global Ask AI, Chat, Wiki, or pull-request surfaces.

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

| Capability                                 | Admin                 | Member                | Non-member |
| ------------------------------------------ | --------------------- | --------------------- | ---------- |
| See repository in SDLC app                 | Yes                   | Yes                   | No         |
| See credential identity/status             | Yes                   | Yes                   | No         |
| Configure/replace/disconnect credential    | Workspace admin only  | No                    | No         |
| Run/retry repository access check          | Yes                   | Yes                   | No         |
| Manage repository members                  | Yes                   | No                    | No         |
| Generate/refresh/retry/cancel baseline     | Yes                   | No                    | No         |
| Generate/refresh/retry/cancel Wiki         | Yes                   | No                    | No         |
| Edit/approve baseline canvases             | Yes                   | View only             | No         |
| Create PRDs and Tech Docs; edit own        | Yes                   | Yes                   | No         |
| Create/link/start Tickets                  | Yes                   | Yes                   | No         |
| Use repository AI chat                     | Yes                   | Yes                   | No         |
| Read/create/reply to SDLC conversations    | Yes                   | Yes                   | No         |
| View repository-filtered personal Activity | Yes                   | Yes                   | No         |
| Read linked context                        | Subject to source ACL | Subject to source ACL | No         |

The hidden repository channel is an authorization boundary. It must not appear in normal Chat navigation, but its conversations store SDLC AI history. Source-level ACLs still apply when linked or retrieved content comes from elsewhere.

Every newly created SDLC canvas grants the hidden repository Channel `VIEWER` access. The creator retains edit
access through canvas ownership; other repository members receive view-only access unless separately granted a
stronger direct role. This default applies to baseline, PRD, Tech Doc, and generated Wiki canvases. Existing canvas
participant rows are not backfilled.

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
- contextual human-conversation panel opened from a selected SDLC owner;
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

The Wiki pipeline creates source-managed folders named `Wiki` or `Wiki/<concept-directory>`. Each conceptual
Markdown page maps to exactly one private repository-channel Canvas. Folder names and Canvas metadata preserve
the Wiki path, current source paths, processed Git commit, content hash, and Canvas version identity; the Wiki
screen reconstructs them as a directory tree. Updates reuse the same Canvas, create a Canvas version, and never
hard-delete obsolete pages. Wiki availability is independent of baseline generation and approval gates.

The temporary Research Agent importer is superseded by this pipeline. If source-managed Wiki Canvases already
exist, bootstrap reads and reconciles them rather than creating duplicates.

### 6.3 Project repository navigation

Project Detail uses the tab order `Boards → Repos → Release`. The Repos tab owns repository listing,
attachment, access-check status, capability status, and **Open SDLC** actions. Repository attachment is
not a header-only action.

### 6.4 Progressive hub gate

The hub itself, rather than a separate onboarding product, presents this durable progression:

`Access check → Wiki generation → Baseline reconciliation → Seven approvals → PRDs/Tech Docs/Tickets`

Wiki and baseline generation stay locked until repository read access passes. Artifact modules and creation
commands stay locked until all seven baseline documents are currently approved. Starting implementation is an
interactive AI action; repository write checks happen when the agent attempts repository work.

## 7. Repository attachment

### 7.1 Entry point

Project Detail's Repos tab adds an **Add Repository** action. Any project-authorized user provides repository URL, display name when it cannot be inferred, and base branch. Branch naming comes from approved repository conventions, not attachment input.

### 7.2 Canonical identity

Repository URLs are normalized before persistence. Equivalent HTTPS/SSH forms, trailing `.git`, trailing slash, host casing, and repository-path casing rules must resolve to one canonical identity where the provider treats them equivalently.

Every supported attached GitHub.com repository uses the same SDLC flow. SDLC repository access must not depend
on Xyne Spaces-specific static clone configuration, pre-baked repository images, or template allowlists.

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
**Generate Wiki** for repository admins. Credential replacement or disconnect atomically
clears stored capabilities before a new check runs.

## 8. Wiki and baseline setup

### 8.1 Trigger

Repository attachment does not start generation. After repository read access passes, a repository
admin may start **Generate Wiki** and **Generate Repo Knowledge** independently. Repo Knowledge can start
with no Wiki, while Wiki is generating, or after Wiki completes. A completed Wiki is optional orientation;
an incomplete Wiki is ignored and generation continues from repository evidence. Successful Wiki completion
still starts one linked ticketless baseline reconciliation Workflow Execution. Admins can retry failed/cancelled
executions and cancel or restart an active Repo Knowledge execution. Only one Repo Knowledge setup execution may run at a time.

### 8.2 Execution model

- use the dedicated Claw `sdlc-agent` and one stable setup conversation;
- provision an isolated `kata-workspace-template` repository sandbox pinned to the selected base branch;
- support public GitHub HTTPS repositories anonymously and private GitHub.com repositories through the workspace credential, without the old static clone allowlist;
- generate documents sequentially so progress is understandable and resumable;
- persist each completed Canvas immediately;
- store durable execution state in PostgreSQL;
- use Redis only for live progress, locks, and resume cache;
- on retry, preserve completed documents and resume at the first missing/failed document;
- reject non-GitHub.com, credential-bearing, malformed, or unsafe repository URLs;
- retrieve private clone credentials only through a sandbox bootstrap endpoint that validates current
  dispatched execution binding or signed interactive repository grant and encrypts directly to the sandbox public key; the agent sees one
  `sandbox-repo-setup` call while trusted Claw performs key/script Kata operations beneath that tool;
- fetch the PAT account identity only inside the sandbox after decryption and use its ID-based GitHub noreply
  address for both commit author and committer; do not persist or forward the derived commit name/email through backend/Claw;
- never persist the PAT in workflow context, queues, prompts, conversations, debug artifacts, Redis progress, logs, or Zero;
- never push, create branches, or modify source during setup.

Claw creates and checkpoints each baseline canvas through `spaces-sdlc-mutate-artifact` with artifact type
`BASELINE`. The
backend derives its folder, visibility, membership, and metadata; the model cannot select arbitrary storage
or create a placeholder. A durable callback advances the next baseline step only after the expected canvas
exists. The worker periodically reconciles stale executions against Claw's authoritative run record, so a
lost callback still reaches a terminal state.

Every `sdlc-agent` trigger receives one canonical tool palette assembled from the live Xyne Spaces MCP export,
generic repository sandbox tools, todo/web search, and Spaces/GitHub/Bitbucket/Context7 subagents. Trigger-specific
workflow requirements remain distinct, while trusted repository/execution context authorizes mutations. Every agent
also receives path-scoped `read`, `write`, `grep`, `find`, and `ls` tools for runtime artifacts: reads may use its
ephemeral workspace and approved session `.context` roots, while writes remain confined to the ephemeral workspace.
These tools cannot access repository source or another session; repository access remains sandbox-only. Artifact CRUD
uses canonical list/read/mutate/history tools; Wiki checkpoint begin, source verification, commit finalization,
historical Git context, and pull-request creation stay focused workflow tools.

All access-check, setup, artifact, and work dispatches use one `sdlc` Bull queue. Consumption and reconciliation
run only when `ENABLE_SDLC_WORKER=true`. Redis admission permits cap actual in-flight operations at nine globally
and three per repository by default, with repository round-robin admission. Queue history initially uses
count-based retention (100 completed and 500 failed jobs); production-scale time-based retention remains a
follow-up.

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
3. **Backend Design System**
   - backend runtime and ownership boundaries;
   - API, service, persistence, transaction, authorization, security, and error patterns;
   - background jobs, retries, logging, metrics, and tracing;
   - identify when repository has no backend.
4. **Code & Lint Standards**
   - formatter, linter, type-system, naming, imports, error handling, and repository conventions;
   - branch naming and repository conventions;
   - source config paths and runnable commands.
5. **Commit Standards**
   - policy sources, accepted format, types/scopes, subject/body/footer rules, and examples;
   - commitlint or equivalent configuration, local hooks, CI enforcement, and validation commands;
   - explicitly state when no commit-message policy exists instead of inventing one.
6. **Run Guide**
   - prerequisites, environment setup, dependencies, services, development commands, and common failure notes;
   - secrets named but never copied into canvas content.
7. **Test Guide**
   - existing test layers, locations, commands, fixtures, and CI expectations;
   - never imply test coverage that the repository does not contain.

Generated canvases carry metadata containing Repo ID, artifact kind, baseline key, setup/workflow execution
ID, approval timestamp/user, and Knowledge Document ID. A generation commit is stored when the sandbox
provides one. The seven baseline kinds come from the shared SDLC contract consumed by Spaces and Claw; tool
schemas must not maintain a second hard-coded kind list.

All generated Wiki, baseline, Repo Knowledge, PRD, and Tech Doc repository references use one structured
contract: Markdown contains `[[source:N]]`, the tool call supplies path/symbol/line metadata, and the backend
validates the path and line range at the server-pinned full commit SHA. The backend alone renders the immutable
GitHub Markdown link. Agent-authored repository URLs are rejected. Normal Generate/Refresh runs rewrite touched
documents through this contract, so older generated documents migrate when refreshed; no background migration
or approval-preserving silent rewrite occurs.

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

UI shows current document, completed count out of seven, last durable update, and actionable error. Refresh/reconnect must recover from DB truth when Redis state is absent.
Admins can open the existing Ask AI debug panel for the setup conversation; repository-scoped backend
authorization permits the run owner and repository admins without exposing the trace to ordinary members.
Overview and Repo Knowledge expose the same single lifecycle action: Generate before setup, Cancel while active,
Retry after failure/cancellation, and Refresh after completion. The Debugger is a secondary action whenever the
current execution has a conversation. Restart is not a separate action or API; users explicitly cancel, then retry.

## 8A. Incremental Wiki generation

### 8A.1 Trigger and range

Repository attachment and access checking do not generate the Wiki. After read access passes, a repository
admin manually selects **Generate Wiki**. Later runs use **Refresh Wiki**. There is no schedule, webhook, merge
hook, or automatic refresh.

Every successful Generate Wiki or Refresh Wiki run starts baseline reconciliation, even when no new commit was
found. All seven compact candidates are regenerated against current Wiki and repository evidence. Missing
baselines are created, changed baselines replace their canonical Canvas with version history, and unchanged
baselines retain content and approval. A baseline reconciliation failure does not roll back the completed Wiki
run and can be retried independently.

Admins may also generate or refresh Repo Knowledge directly at any time. That action never starts, waits for,
or blocks on Wiki. It uses completed Wiki pages when available and otherwise relies on the pinned live repository.

The first-run panel provides:

- history range: latest 20%, latest 50%, full first-parent history by default, or a custom starting SHA;
- commits per Wiki update: 1 by default, 10, 25, 50, or 100;
- review mode: Quick or Standard by default.

Each option explains its effect. More history improves evolution and rationale recall but costs more time and
model usage. Larger History Windows reduce run-launch overhead and documentation churn but may compress
intermediate rationale; size 1 preserves exact commit-level fidelity. Higher quality adds final review passes. The panel presents one common cost,
time, and quality warning before start.

Refresh begins after the latest successful Commit Checkpoint and targets the current head of the base branch
saved during repository attachment. One Wiki Run may be active per repository. Repository admins can start,
retry, cancel, and inspect runs; repository members can view Wiki pages and run progress.

### 8A.2 History and bootstrap semantics

The backend deterministically fetches the selected base branch, resolves its head, validates a custom SHA as an
ancestor when supplied, and uses first-parent history in oldest-to-newest order. No Agent session performs range
preparation. Merge changes are analyzed once where they enter the base branch. The run records its full target
head so later remote movement cannot change the active range. Agent prompts, tool inputs, and the dashboard use
shortest-unique commit references with a nine-character minimum; persistence and authorization retain full SHAs.

Before processing the selected starting commit `C`, bootstrap creates or reconciles the conceptual Wiki against
the complete repository tree at `parent(C)`. It does not summarize only that parent commit. Commit `C` is then
processed normally and receives its own attributable revisions. When `C` is the root commit, bootstrap starts
from an empty Wiki and the root tree/diff establishes the initial pages.

The sandbox fetches enough history for the selected range. Wiki-only Git tools expose the assigned commit's
metadata, bounded diff, tree, source files, searches, and bounded path history without giving the model arbitrary
Git or shell mutation. Large diffs remain in bounded sandbox files; small diffs may be returned inline.

### 8A.3 Supervision and History Windows

The backend owns ordering, the authoritative cursor, retries, cancellation, one-active-run enforcement, and
completion. The existing `sdlc-agent` handles one immutable History Window of sequential commits as a conceptual
before→after update. It normally writes at the mandatory endpoint. It may retain a meaningful intermediate state
only by explicitly beginning and finalizing that server-authorized checkpoint first. All mutations are serialized.

One stable Wiki conversation identity allows a live sandbox and fetched clone to be reused. Model session
history is cleared between History Windows. Run-finally cleanup removes credentials but does not intentionally
destroy the reusable sandbox. If the sandbox or Claw process is gone, the next History Window provisions a new
sandbox, fetches the remaining range, and resumes after the latest Commit Checkpoint. The system never trusts an
agent's claim that earlier commits completed without matching durable checkpoints.

### 8A.4 Generator contract

For every assigned commit, the generator:

1. reads commit metadata, changed paths, and diff;
2. loads current Wiki paths and only likely affected pages;
3. inspects the assigned historical tree and surrounding code when the diff is insufficient;
4. uses source-map overlap plus bounded Git path/rename history for relevant historical context;
5. creates, updates, or archives the smallest coherent set of concept-oriented pages; or records no-op;
6. submits the complete current source-path list for every changed active page.

The Wiki captures domain concepts, business flows and rules, interfaces, integrations, state, invariants,
failure modes, operational behavior, security/trust boundaries, important decisions, and useful evolution. It
does not become a file inventory, line-by-line explanation, commit log, or dependency list. Formatting-only,
generated-only, lockfile-only, and test-only commits may be deterministically classified as no-op when that fact
is provable. Refactors and bug fixes update the Wiki only when conceptual behavior, pointers, invariants, or
lasting rationale change.

Current executable code wins conflicts. Tests, schemas, configuration, current repository docs, commit
messages, selected history, and old Wiki text provide supporting evidence in that order, subject to explicit
rationale found in comments or design records. Inferences are never presented as documented motivation.

### 8A.5 Wiki write interface and concurrency

Wiki runs receive dedicated list/read/page-write/commit-finalize tools rather than generic Canvas or database
mutation. Each tool is bound to repository, Workflow Execution, Agent session, assigned commit, and initiating
user. A page-write accepts exactly one validated create, update, restore, or archive action. Finalize advances
the commit only after all page writes succeed, or records no-op when no page was written.

Every update includes the content hash read by the generator. If a human or another process changed the Canvas,
the backend rejects the stale write with a conflict; the same commit is retried against current content. Human
edits therefore remain part of the Wiki unless repository evidence contradicts them. The backend validates Wiki
paths, output size, assigned SHA, action shape, source-path existence in the assigned tree, duplicate paths, and
source completeness before mutation.

Changed pages create a `CanvasVersion`. A whole topic that is no longer useful is archived through Canvas
metadata and hidden from the normal Wiki tree; it is never hard-deleted. Section removal, source rename, or file
movement updates the existing Canvas instead. A later commit may restore an archived path and reuse its Canvas.

### 8A.6 Persistence without a new schema

The pipeline reuses existing persistence:

- `WorkflowExecution` context/output stores configuration, target head, cursor, counts, errors, History Window
  sessions, and historical Wiki Revision evidence;
- `SdlcEntityLink` associates the repository with each Wiki Workflow Execution;
- current Canvas metadata stores Wiki path, current source paths, last commit SHA, content hash, Canvas version
  ID, sync time, and optional archive fields;
- `CanvasVersion` stores the version content and content hash;
- Redis/Bull stores only dispatch, live progress, admission, and retry state.

Each historical Wiki Revision record links action, commit SHA, Canvas ID, Canvas version ID, Canvas content hash,
and the complete source-path list. Current source mappings remain directly available from Canvas metadata;
historical mappings may be removed later without changing current Wiki behavior. No `.doc_runs.json`,
`.doc_sources.json`, generated Markdown, or credential is written or pushed to the attached repository.

### 8A.7 Quality modes

All roles use the same configured `sdlc-agent`; only instructions and write permissions differ.

- Quick ends after bootstrap and commit processing.
- Standard runs one read-only final validator, then one correction run for confirmed findings.

Validators report missing topics, stale or conflicting claims, invalid sources, and suggestions. They cannot
write. Correction runs verify findings against the final target tree and create revisions labelled
`Wiki audit @ <target-head>`. Deterministic backend validation runs in every quality mode.

Full design and prompt contracts are in [WIKI_PIPELINE_DESIGN.md](./WIKI_PIPELINE_DESIGN.md).

## 9. Baseline review and memory

- Baseline canvases use the existing collaborative editor.
- Admins can edit; members are viewers.
- Each canvas has **Approve memory**.
- Approval creates or updates exactly one Knowledge Document for that baseline canvas, then writes approval metadata back to the canvas.
- Re-approval updates the same Knowledge Document with current canvas content; it does not create duplicates.
- Approval is manual and independently repeatable for all seven canvases.
- PRD, Tech Doc, Ticket, and coding work is blocked until all seven baseline canvases are currently approved.
- Approved snapshots become repository permanent memory for AI retrieval.

Editing or refresh-replacing an approved baseline marks it pending reapproval. Stale snapshots are excluded from
injected baseline memory and downstream gates until reapproval updates the existing Knowledge Document.

## 10. Artifacts

Every artifact list/create/open command requires a successful repository read check and all seven current
baseline canvases. The UI disabled state is explanatory, but the backend remains authoritative.

### 10.1 PRDs

PRDs are canvases in the PRDs folder. A PRD contains overview, terminology as needed, requirements/user stories, and acceptance criteria. Humans or AI may create directly editable drafts.

### 10.2 Tech Docs

Tech Docs are canvases in the Tech Docs folder. A Tech Doc translates one PRD into architecture, affected modules, data/API changes, rollout notes, and verification approach.

### 10.3 Tickets

The Tickets section embeds the normal Project ticket experience and exposes every Project Board. Ticket
creation, stages, permissions, filtering, and activity use the existing ticket system without an SDLC-owned
Board or lifecycle policy.

### 10.4 v1 cardinality

One chain supports:

- one PRD;
- zero or one Tech Doc linked to that PRD;
- zero or more Tickets linked directly to the PRD or Tech Doc;
- zero or more pull-request updates associated through existing PR tracking, with one active implementation path expected.

Starting work from a PRD or Tech Doc requires an existing related Ticket. A single Ticket starts immediately;
multiple Tickets open a picker. Related Tickets include direct links and links through the one-hop PRD/Tech
Doc chain, are deduplicated, and must belong to the same Project.

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

For an interactive repository question, the SDLC Assistant searches the relevant live code, generated Wiki,
PRDs, Tech Docs, Tickets and their conversations, baseline memory, linked context, and repository-channel
history before converging on an answer. Workspace-backed claims retain normal inline citations. Code answers
show the smallest relevant excerpt before its explanation and include repository-relative path, symbol, and
line range. This retrieval guidance is interactive-only and does not change baseline or Start Work execution.

Interactive context includes the latest successful Wiki commit SHA, current base-branch head SHA, and a derived
`CURRENT`, `STALE`, or `UNKNOWN` freshness state. When current and the Wiki fully establishes the answer, the
Assistant may answer from it. When stale or unknown, the Wiki is orientation only: the Assistant inspects current
code before making repository claims and discloses that stale Wiki informed the answer. Even a current Wiki does
not replace code inspection for exact implementation, security, configuration, or behavior it does not establish.
Current code wins any conflict.

Wider workspace sources require explicit user selection or normal authorized retrieval. Existing search/retrieval infrastructure remains responsible for emails, chats, canvases, calls, recordings, and attachments.

Code questions use the same live Kata checkout as implementation work. Read-only behavior is prompt policy:
questions, PRDs, Tech Docs, reviews, and other non-implementation actions must not edit, build, commit, push, or
create a pull request. Explicit implementation requests may modify the checkout and must finish through the
verified draft-PR tool. The Assistant reviews the diff once and attempts each relevant existing check once. Failed,
unavailable, or timed-out checks do not discard usable work or block a draft PR; the PR body and final response
must prominently report every non-passing check. Unsafe branches, unresolved conflicts, suspected secrets, and
commit, push, or PR verification failures remain blocking. Answers show exact relevant snippets with path, symbol,
and line range inline. v1 does not create a Vespa code index.

AI artifact actions reuse `ask-ai` and create editable PRD or Tech Doc canvases directly through the
narrow SDLC artifact tool. They are asynchronous and do not pre-create placeholder canvases. Explicit user
requests made in the SDLC Ask AI window receive repository identity and tool instructions so PRDs or
Tech Docs land in the correct repository folders. Generated content is never treated as approved baseline
memory automatically.

Before all seven current baseline approvals, the SDLC Ask AI experience may explain setup/read status but must not
create PRDs, Tech Docs, or Tickets through tools.

### 12.1 Human conversations

Human SDLC conversations reuse normal top-level conversations and messages in the hidden repository Channel.
They do not introduce a second chat model. One `SdlcEntityLink` with relation `DISCUSSION` assigns each
conversation to exactly one owner:

- a pipeline rooted at a PRD Canvas; or
- one selected Wiki or Repo Knowledge Canvas.

PRD, Tech Doc, Ticket, and linked Pull Request views resolve to the same PRD-rooted pipeline owner and therefore
show the same conversation list. A Ticket or Pull Request without a resolvable PRD-rooted SDLC chain has no
pipeline conversation action. Wiki and Repo Knowledge conversations remain scoped to their selected Canvas.

The SDLC header shows **Conversations** beside the existing **Assistant** action only when a concrete owner is
selected. Each action opens its own right panel and closes the other. The Assistant behavior, sessions, history,
and context remain unchanged in v1. The conversation panel reuses Chat ordering, pagination, unread state,
notifications, mentions, reactions, attachments, message controls, composer, and thread rendering. It contains a
single-column list; selecting a row opens the thread, Back returns to the list, and **New conversation** starts the
normal first-message composer. The selected conversation is encoded in the URL for refresh and browser-history
behavior.

No v1 flow attaches an existing conversation, moves it, assigns multiple owners, unlinks it, or backfills old
hidden-Channel conversations. The panel lists only conversations explicitly created for its resolved owner.
Deletion follows normal Chat behavior and removes any resulting orphan discussion link.

This feature exists only inside the desktop SDLC Hub. Normal Chat navigation continues to hide the repository
Channel. Global Wiki, Pull Request, Ask AI, and mobile surfaces remain unchanged. Detailed behavior and delivery
seams are recorded in [CONVERSATIONS_PLAN.md](./CONVERSATIONS_PLAN.md).

### 12.2 Repository Activity preview

Overview shows a view-only projection of the current user's existing Activity feed filtered to the hidden
repository Channel. It includes all matching activity types and preserves the global feed's current read/unread
display, but creates no SDLC-specific Activity rows, changes no read state, and provides no hidden-Channel Chat
navigation.

Global Activity navigation recognizes hidden SDLC Channel metadata. Message activity opens the linked SDLC
conversation and exact message; Canvas and Ticket activity opens the matching SDLC section and entity; other
matching activity opens repository Overview. Invalid or stale discussion links remain in SDLC Overview and never
fall back to normal Chat. Non-SDLC Activity navigation is unchanged.

## 13. Start Work

### 13.1 Preconditions

- caller can access the repository hub and artifact;
- the PRD or Tech Doc has at least one related same-Project Ticket.

### 13.2 Agent context

The existing SDLC `ask-ai` experience opens a fresh conversation with the repository research context, the
selected artifact, and the selected Ticket pre-attached. The UI automatically submits an explicit
"Start work" prompt naming both entities.

### 13.3 Behavior

Start Work does not create an SDLC workflow, mutate the Ticket stage, or call a dedicated backend start
endpoint. The AI conversation owns planning and implementation using the same capabilities available through
normal repository-scoped chat. Historical SDLC work callbacks remain readable for compatibility, but the UI
does not create new `SDLC_WORK` executions.

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
- normalized `accessCapabilities`; transient check status, timestamps, retries, errors, and evidence remain
  in Redis job metadata.

### 14.2 SdlcEntityLink

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

### 14.5 Wiki pipeline reuse

Incremental Wiki generation adds no database model, field, enum, or migration. It reuses Workflow Executions,
generic SDLC entity links, Canvas metadata, Canvas versions, the existing SDLC queue, and existing credential
bootstrap. Shared Zod contracts may add text unions and payload schemas without Prisma enums.

## 15. Deep module interface

Business invariants live behind one backend `SdlcHub` module:

```ts
interface SdlcHub {
  attachRepository(input: AttachRepositoryInput): Promise<RepositoryHub>;
  setupRepository(input: SetupRepositoryInput): Promise<SetupExecution>;
  refreshSetup(input: RefreshSetupInput): Promise<SetupExecution>;
  retrySetup(input: RetrySetupInput): Promise<SetupExecution>;
  cancelSetup(input: CancelSetupInput): Promise<SetupExecution>;
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
interface for credential configuration, access checks, capability gates, runtime credential delivery, draft PR creation,
and PR validation. `GitHubVcsAdapter` is the v1 provider adapter. See
[VCS_CREDENTIALS_PLAN.md](./VCS_CREDENTIALS_PLAN.md).

Wiki orchestration lives behind a separate deep `SdlcWikiPipeline` module:

```ts
interface SdlcWikiPipeline {
  start(actor: SdlcActor, input: StartWikiRunInput): Promise<WikiRun>;
  refresh(actor: SdlcActor, input: RefreshWikiRunInput): Promise<WikiRun>;
  retry(
    actor: SdlcActor,
    repoId: string,
    executionId: string,
  ): Promise<WikiRun>;
  cancel(
    actor: SdlcActor,
    repoId: string,
    executionId: string,
  ): Promise<WikiRun>;
  getStatus(actor: SdlcActor, repoId: string): Promise<WikiStatus>;
}
```

Its external interface hides Git range resolution, History Window dispatch, sandbox reuse, prompt roles,
checkpoints, optimistic Canvas writes, revision/source evidence, validation, and recovery. HTTP routes, Bull
jobs, callbacks, Claw tools, and the dashboard are adapters at this seam. Wiki source inspection and Canvas
storage may use private internal seams; callers do not coordinate them.

## 16. HTTP commands

- `POST /api/sdlc/repositories`
- `GET /api/sdlc/vcs/credentials`
- `PUT /api/sdlc/vcs/credentials/:provider`
- `POST /api/sdlc/vcs/credentials/:provider/validate`
- `DELETE /api/sdlc/vcs/credentials/:provider`
- `POST /api/sdlc/repositories/:repoId/access-check`
- `POST /api/sdlc/repositories/:repoId/setup`
- `POST /api/sdlc/repositories/:repoId/setup/refresh`
- `POST /api/sdlc/repositories/:repoId/setup/retry`
- `POST /api/sdlc/repositories/:repoId/setup/cancel`
- `POST /api/sdlc/repositories/:repoId/wiki/runs`
- `POST /api/sdlc/repositories/:repoId/wiki/runs/:executionId/retry`
- `POST /api/sdlc/repositories/:repoId/wiki/runs/:executionId/cancel`
- `GET /api/sdlc/repositories/:repoId/wiki/status`
- `POST /api/sdlc/repositories/:repoId/artifacts`
- `GET /api/sdlc/repositories/:repoId/executions/:executionId/debug`
- `POST /api/sdlc/repositories/:repoId/links`
- `DELETE /api/sdlc/repositories/:repoId/links/:linkId`
- baseline approval may extend the existing knowledge approval command while preserving legacy behavior.
- `POST /api/sdlc/claw/artifacts` is the authenticated narrow Claw tool boundary.
- Wiki-only Claw list/read/page-write/commit-finalize routes are authenticated and bound to the active Wiki execution, Agent session,
  repository, initiating user, and assigned commit.
- `POST /api/sdlc/claw/pull-requests` is the authenticated narrow draft-PR boundary.
- `POST /api/internal/sdlc/vcs/runtime-credentials/bootstrap` is S2S-authenticated, validates either an active
  durable execution binding or a short-lived signed interactive repository grant, and returns only ciphertext.
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
- artifact commands cannot start before read access and all-seven approval gates;
- Start Work cannot start without current read/push/PR capability.
- Wiki generation cannot start before read access passes and remains independent of baseline approval;
- one active Wiki Run exists per repository;
- every terminal commit advances one durable checkpoint; partial agent output never advances it;
- retries are idempotent across partially applied page updates, duplicate callbacks, and lost callbacks;
- stale Canvas hashes fail with conflict rather than overwriting human edits;
- failed runs retain diagnostic diff/context artifacts until retry or explicit cleanup;
- reusable sandboxes are opportunistic optimization, never the durable source of run truth.

## 18. v1 acceptance criteria

1. Workspace owner/admin can validate/store/replace/disconnect one GitHub.com fine-grained PAT without any read path returning it.
2. The repository gets one hidden member-scoped channel and three folders; existing Project Boards remain unchanged.
3. Project Detail uses `Boards → Repos → Release`; project-authorized users can attach repositories from Repos.
4. Attachment commits the cheap shell, then performs a durable non-mutating access check; it does not auto-start baseline.
5. Public repos can pass read-only without a PAT; credential-accessible private repos can pass read; missing read blocks baseline.
6. Only channel members see the repository in `/sdlc`; normal Chat omits the hidden channel.
7. Successful read enables **Generate Wiki**; Wiki completion runs `ask-ai` reconciliation and ends with seven editable baseline canvases.
8. Failed/cancelled setup retry and active-run restart preserve completed canvases and resume remaining work.
9. Members view baseline; admins edit and repeatedly approve each document into one Knowledge Document.
10. PRD, Tech Doc, and AI artifact creation remain disabled until all seven current approvals; backend rejects bypasses.
11. The Tickets section shows the normal Project ticket experience across all Project Boards.
12. Trace spine accurately displays linked PRD, optional Tech Doc, Ticket, and PR state.
13. Related drawer adds/removes authorized real context without inventing links or bypassing ACL.
14. SDLC Ask AI creates artifacts only after gates and uses approved memory/current chain/linked context/channel history.
15. Start Work opens a fresh `ask-ai` conversation, attaches the artifact and selected related Ticket, and automatically submits the implementation prompt.
16. Multiple related Tickets open a picker; ticket stages remain controlled by the normal ticket system.
17. Repository admins can inspect baseline generation through the existing Ask AI debug panel without token disclosure.
18. Legacy Bitbucket/deployment GitHub behavior remains unchanged; shared/backend/dashboard/Claw builds and typechecks pass.
19. A repository member can open **Conversations** from a selected PRD, Tech Doc, Ticket, or linked Pull Request and see one shared PRD-rooted pipeline conversation list.
20. A repository member can open an independent conversation list from a selected Wiki or Repo Knowledge document.
21. Creating a conversation writes a normal hidden-Channel conversation plus exactly one `DISCUSSION` link; the thread then behaves like Chat for all members.
22. Unlinked historical conversations do not appear, and v1 offers no attach, move, multi-owner, unlink, or backfill flow.
23. Conversation selection survives refresh and browser navigation; **Assistant** remains behaviorally unchanged and is mutually exclusive with the conversation panel.
24. Overview renders the current user's existing Activity rows filtered to the repository Channel without creating events or mutating read state.
25. Repository attachment does not generate a Wiki; an admin can manually Generate or Refresh only after read access passes.
26. First generation supports latest 20%, latest 50%, full first-parent history, or a valid custom ancestor SHA; it bootstraps the full tree at the selected starting commit's parent.
27. Commits are partitioned first-parent, oldest to newest, into History Windows of 1/10/25/50/100; every window has a mandatory endpoint checkpoint and backend-owned monotonic optional intermediate checkpoints.
28. A missing reusable sandbox is recreated and resumes after the latest Commit Checkpoint without repeating completed commits.
29. Product-relevant commits create, update, or archive the correct conceptual Canvas pages; provably irrelevant commits record no-op.
30. Every active changed page records existing source paths, commit SHA, Canvas content hash, and Canvas version; historical Wiki Revision evidence connects the same facts in the run output.
31. A human edit racing generation produces a stale-hash conflict and retry, never silent overwrite.
32. Whole obsolete topics are archived and hidden without hard-deleting Canvas history/comments; moves and partial removals update the existing Canvas.
33. Quick and Standard use the same `sdlc-agent`; validators remain read-only and correction runs write only verified fixes.
34. Ask AI receives Wiki and base-branch SHAs. When freshness is stale or unknown, it inspects current code before making repository claims and tells the user when stale Wiki informed the answer.
35. Interrupted, failed, cancelled, truncated, duplicated-callback, and transient-network runs leave durable, truthful, retryable state without corrupting Wiki Canvases or source evidence.
36. Wiki, baseline, Repo Knowledge, PRD, and Tech Doc generation render validated immutable source links through the same backend-owned structured-reference contract.
37. Claw accepts every kind in the canonical seven-kind shared baseline contract, including Backend Design System and Commit Standards; partial setup retry resumes after completed kinds.
