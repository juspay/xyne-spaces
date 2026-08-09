# SDLC VCS credentials — implementation plan

Status: v1 implemented; configured acceptance smoke pending
Owner: Xyne Spaces
Scope: GitHub.com fine-grained PAT, v1
Last updated: 2026-08-04

This document plans workspace-managed VCS credentials for AI SDLC Hub. It is subordinate to
[PRD.md](./PRD.md) for product behavior and is tracked by [TRACKER.md](./TRACKER.md). Deferred
security and provider decisions live in [DECISIONS_NEEDED_FOR_V2.md](./DECISIONS_NEEDED_FOR_V2.md).
Operational setup, rollout, rollback, and acceptance checks are in
[VCS_CREDENTIALS_RUNBOOK.md](./VCS_CREDENTIALS_RUNBOOK.md).

## 1. Outcome

Workspace administrators can configure one GitHub.com fine-grained personal access token for an
SDLC workspace. Project-authorized users can attach public or private repositories. Before baseline
generation begins, the SDLC hub performs a non-mutating repository access check and presents the
capabilities available for that repository.

The hub then advances through a strict progressive gate:

`Access check → Baseline generation → Five approvals → Artifact work`

Start Work has an additional repository capability gate: the credential must support direct branch
push and draft pull-request creation. Public repositories remain usable for read-only baseline work
without any credential.

## 2. Approved decisions

- v1 supports GitHub.com only.
- Authentication uses a fine-grained PAT, not a GitHub App, OAuth token, classic PAT, SSH key, or
  deploy key.
- One active GitHub credential exists per workspace.
- One fine-grained PAT therefore supports one GitHub resource owner in v1.
- Workspace owners/admins may create, replace, validate, or disconnect the credential.
- Project-authorized users who can create/manage project boards may also attach repositories.
- The credential is workspace-owned. Repository members can use capabilities through SDLC but can
  never read the token.
- Existing legacy Bitbucket environment configuration and services are unchanged.
- The new module is provider-neutral. GitHub is its first adapter; Bitbucket and GitLab are later
  adapters.
- Project Detail navigation becomes `Boards → Repos → Release`.
- Repository attachment no longer auto-starts baseline generation.
- The repository access check runs first. A repository admin explicitly selects **Next: Generate
  baseline** after read access passes.
- PRDs, Tech Docs, Tickets, and their creation actions stay locked until all five
  baseline documents are approved.
- Start Work additionally requires direct-repository branch push and pull-request creation
  capability.
- v1 supports direct-repository push only. Fork-based contribution is deferred.
- The agent is instructed to create a convention-conforming feature branch and push only that branch, never the base/default
  branch, never force-push, and never merge.
- v1 does not enforce the allowed push ref at the credential or Git transport layer. This known risk
  is recorded for v2.
- v1 uses sandbox-local decryption of a bound authenticated PAT envelope for Git operations. Brokered
  provider credentials and trusted backend finalization are deferred.

## 3. Existing implementation constraints

Current SDLC implementation has several GitHub-specific assumptions that must move behind the new
module:

- `toSdlcGithubCloneUrl` rejects every host except `github.com` and assumes public HTTPS clone.
- `SdlcClawExecutionService` constructs GitHub URLs and validates GitHub pull-request URLs directly.
- `getGitProvider` falls back to legacy Bitbucket for every URL it does not recognize as GitHub.
- the backend GitHub manager reads one deployment-wide `GITHUB_TOKEN` environment variable;
- the legacy Bitbucket manager reads deployment-wide Bitbucket environment variables;
- Claw has separate user/org MCP credential storage, but it is not workspace-scoped and is not the
  source of truth for SDLC repository authorization;
- Kata session creation has no dynamic secret field; v1 credential delivery therefore needs a
  narrow, run-bound S2S retrieval path plus explicit sandbox setup/cleanup;
- current SDLC attachment commits the repository shell and automatically queues baseline setup;
- current artifact creation is not gated on completed baseline approval.

This plan does not merge or migrate the legacy Git provider managers. New SDLC callers use the new
module. Existing Release, commit-analysis, and webhook paths keep their current behavior.

## 4. Terminology

### 4.1 VCS credential

One encrypted, workspace-owned provider credential. v1 stores a GitHub fine-grained PAT. Provider
payload is adapter-owned and is never exposed through Zero, logs, workflow context, debug artifacts,
or API responses.

### 4.2 Provider adapter

A provider-specific implementation at the internal VCS seam. It owns credential validation,
repository parsing, capability inspection, authenticated clone configuration, pull-request creation,
and returned-URL validation.

### 4.3 Access check

Latest non-mutating inspection of one attached repository using its public visibility and the current
workspace credential revision. It produces normalized capabilities and actionable failure details.

### 4.4 Capability

Provider-neutral ability used by SDLC gates:

- `READ_REPOSITORY`
- `PUSH_BRANCH`
- `CREATE_PULL_REQUEST`

`PUSH_DEFAULT_BRANCH` and `MERGE_PULL_REQUEST` are deliberately not capabilities exposed to SDLC.

### 4.5 Runtime grant

An opaque, short-lived, one-use reference authorizing encrypted delivery of the current workspace
credential for one repository and one SDLC execution. The sandbox generates an ephemeral X25519 keypair;
trusted Claw receives only its public-key stdout through Kata and carries that key to the backend. The backend
never reads the pod directly. It returns an authenticated envelope bound to the `sdlc-agent` slug, operation,
execution, session, sandbox, credential revision, and expiry. Only the sandbox holds the private key and
decrypts the original PAT.

## 5. Roles and access

| Action | Workspace owner/admin | Project-authorized user | Repository member |
| --- | ---: | ---: | ---: |
| View credential status/identity | Yes | Yes | Yes |
| Read token | No | No | No |
| Configure/replace/disconnect token | Yes | No | No |
| Attach public repository | Yes | Yes | Subject to project access |
| Attach private repository using shared token | Yes | Yes | Subject to project access |
| Run/retry repository access check | Yes | Yes | Repository member |
| Start baseline | Repository admin | Repository admin | No |
| Approve baseline | Repository admin | Repository admin | No |
| Use unlocked artifact surfaces | Yes | Yes | Repository member |
| Start Work | Repository member with normal ticket access | Same | Same |

The backend, not the dashboard, enforces every role and gate. Sharing a capability never shares the
credential value.

## 6. Product flows

### 6.1 Workspace credential settings

Add a **Repository credentials** section to Workspace Management, following its existing tab and card
patterns.

Disconnected state shows:

- provider: GitHub.com;
- fine-grained PAT guidance;
- minimum intended permissions: Metadata read, Contents read/write, Pull requests read/write, and Workflows
  read/write (required by GitHub when a task changes `.github/workflows/*`);
- warning that one fine-grained PAT has one resource owner;
- masked password input;
- **Validate and save** action.

Connected state shows only metadata:

- authenticated GitHub login;
- resource owner when it can be derived;
- validation status and timestamp;
- last four-character fingerprint, never a reversible token fragment;
- replace, revalidate, and disconnect actions;
- number of attached repositories and their latest access states.

Replacement validates the new token before atomically replacing the old ciphertext. The old token is
never returned. Disconnect requires confirmation, clears stored ciphertext, increments credential
revision, and marks repository access checks stale.

### 6.2 Project Repos tab

Project Detail navigation order becomes:

1. Boards
2. Repos
3. Release

The current header-level **Add Repository** action moves into the Repos tab. The tab contains:

- attached repository list;
- provider, visibility, base branch, setup state, and capabilities;
- **Add Repository**;
- **Check access** / **Retry check**;
- **Open SDLC**;
- actionable credential message with a Workspace Settings link for administrators;
- an **Ask a workspace admin** message for non-admins.

The attach form accepts URL, inferred/explicit name, and base branch. Work branch naming is learned from
approved repository conventions instead of attachment-time prefix configuration. v1
accepts canonical GitHub.com HTTPS/SSH inputs but stores a credential-free canonical URL.

### 6.3 SDLC hub progressive gate

This is normal hub state, not a separate onboarding framework or modal.

#### State 1 — access not checked/check running

- Overview leads with repository setup.
- Baseline generation and every artifact module are disabled.
- Access check starts after attachment and can be retried manually.
- Refresh reads durable state.

#### State 2 — access checked with read capability

- Show authenticated identity or public unauthenticated access.
- Show proven/inferred capabilities and missing capabilities.
- Enable **Next: Generate baseline** for repository admins.
- PRDs, Tech Docs, Tickets, and Start Work remain disabled.

#### State 3 — baseline generation/review

- Existing five-document progress, failure, retry, cancel, and debug behavior remains.
- Artifact modules remain disabled during generation and review.
- Approval checklist remains on the normal Baseline surface.

#### State 4 — all five baseline documents approved

- PRDs, Tech Docs, and Tickets unlock.
- Start Work unlocks only when `PUSH_BRANCH` and `CREATE_PULL_REQUEST` are available.
- Read-only repositories show an explicit Start Work blocker without disabling read/authoring flows.

## 7. Capability behavior

| Repository/token state | Read/baseline | Artifact authoring after approval | Start Work |
| --- | ---: | ---: | ---: |
| Public, no credential | Yes | Yes | No |
| Public, invalid credential | Public fallback only, with warning | Yes after approval | No |
| Private, no credential | No | No | No |
| Private, credential can read only | Yes | Yes after approval | No |
| Public/private, credential can push and create PRs | Yes | Yes after approval | Yes |

GitHub exposes endpoint permission requirements but does not provide a reliable, non-mutating
fine-grained-PAT introspection call proving every future write operation. The access check must label
results truthfully:

- **proven**: authenticated identity, repository visibility/identity, base branch, API read, and
  authenticated `git ls-remote`/clone access;
- **inferred**: repository role permits push and configured token is expected to include Contents
  write;
- **declared/required**: Pull requests write is required for creation but is finally proven only when
  the draft PR call succeeds;
- **runtime failure**: a 401/403/404 during clone, push, or PR creation updates the durable check and
  presents revalidation guidance.

Preflight never creates a branch, commit, pull request, issue, or other GitHub resource.

## 8. Deep module and seams

The external seam is one deep `SdlcVcs` module. Routes, `SdlcHub`, workers, Claw tools, and callbacks
use this interface rather than parsing providers or decrypting credentials themselves.

```ts
interface SdlcVcs {
  configureCredential(input: ConfigureVcsCredentialInput): Promise<VcsCredentialSummary>;
  disconnectCredential(input: DisconnectVcsCredentialInput): Promise<void>;
  checkRepository(input: CheckRepositoryAccessInput): Promise<RepositoryAccessResult>;
  requireCapabilities(input: RequireRepositoryCapabilitiesInput): Promise<RepositoryAccessResult>;
  issueRuntimeGrant(input: IssueVcsRuntimeGrantInput): Promise<VcsRuntimeGrant>;
  createDraftPullRequest(input: CreateDraftPullRequestInput): Promise<PullRequestResult>;
}
```

The provider seam is internal to the module:

```ts
interface VcsProviderAdapter {
  readonly provider: string;
  parseRepositoryUrl(value: string): ParsedVcsRepository;
  validateCredential(secret: unknown): Promise<ProviderCredentialIdentity>;
  inspectRepository(input: ProviderRepositoryInspectionInput): Promise<ProviderInspection>;
  buildGitAuthentication(input: ProviderGitAuthenticationInput): GitAuthentication;
  createDraftPullRequest(input: ProviderCreatePullRequestInput): Promise<ProviderPullRequest>;
  validatePullRequestUrl(input: ProviderPullRequestValidationInput): ParsedPullRequest;
}
```

`GitHubVcsAdapter` is the production adapter. A fake/in-memory adapter exercises the same seam in
module tests if automated testing is later permitted. Future Bitbucket/GitLab adapters implement this
interface without changing routes, gates, persistence shape, or hub orchestration.

Provider-specific fields must not leak into `Repo`, workflow context, or shared normalized result
types. `owner/repo`, Bitbucket project/slug, and GitLab namespace/project remain parsed adapter values.

## 9. Persistence

### 9.1 Workspace VCS credential source

Reuse `ExternalSource` with the dedicated `sdlc_vcs_credential` source type and a deterministic
workspace/provider name. Its authenticated AES-256-GCM `credentials` envelope contains provider,
revision, validation, identity/resource-owner, fingerprint, actor, and timestamp metadata together with
the token. `isActive` controls lifecycle. The legacy `SdlcVcsCredential` table is migrated and removed.
Neither ciphertext nor plaintext is part of Zero/shared dashboard schemas.

### 9.2 `Repo` extensions

- `vcsAccessStatus`: `NOT_CHECKED | CHECKING | READY | BLOCKED | STALE`
- `vcsCapabilities` (normalized JSON with confidence/reason per capability)
- `vcsIdentityLogin`
- `vcsCredentialRevision`
- `vcsCheckedAt`
- `vcsCheckErrorCode`
- `vcsCheckErrorMessage`

These fields store no secrets. Provider and owner/name come from `canonicalUrl`, the target branch is
existing `baseBranch`, and cached visibility stays inside the access-check result. Safe access state is
mirrored into shared/Zero read models for UI state.

### 9.3 Durable state rules

- only one check may be active per repository;
- a credential revision mismatch makes prior check results stale;
- credential replacement/disconnect marks every GitHub repository in the workspace stale;
- read capability is required before baseline setup can start;
- all-five approval remains independently durable;
- artifacts require read check ready plus all-five approval;
- Start Work requires read check ready, all-five approval, push capability, and PR capability;
- Redis may coordinate a running check but never becomes source of truth.

## 10. Credential security and lifecycle

- Accept only token-shaped input over authenticated HTTPS.
- Require workspace owner/admin authorization server-side.
- Encrypt immediately; do not place plaintext in database logs or structured log fields.
- Never return plaintext after save.
- Never serialize plaintext into `WorkflowExecution.context`, queue payloads, Claw conversations,
  agent prompts, debug bundles, Redis progress, or Zero.
- Apply secret redaction at every sandbox command/result boundary; keep GitHub fine-grained PAT
  patterns current.
- Use constant-time comparisons for internal grant secrets where applicable.
- Record metadata-only audit events: actor, workspace, provider, action, validation outcome, identity,
  and timestamp.
- Validate before credential replacement; failed replacement leaves the old credential active.
- Runtime grants bind execution ID, workspace ID, repository ID, provider, operation, and expiry.
- Runtime retrieval is S2S-only and rejected when execution state/session/repository does not match.
- Sandbox credential helper files use restrictive permissions and are scrubbed in run-finally cleanup on
  success, failure, cancellation, or timeout, and again when the sandbox is released. Reusing a cached sandbox
  requires a fresh ephemeral key and envelope before authenticated Git operations.
- Git remotes and callback results must be sanitized before persistence/logging.

### Accepted v1 risk

The raw long-lived PAT is present inside an agent-controlled sandbox during authenticated Git
operations. Output redaction and blocked secret paths are defense in depth, not a complete defense
against deliberate encoding/exfiltration. The token must be fine-grained, limited to selected
repositories, given no merge/default-branch-bypass/administration permissions, and assigned an expiry.
Eliminating this exposure is a v2 decision.

## 11. Access-check algorithm

1. Lock repository access check and persist `CHECKING`.
2. Resolve the provider adapter from canonical repository URL.
3. Load the current workspace credential metadata and decrypt only inside `SdlcVcs` when present.
4. Validate GitHub.com host and exact owner/repository shape.
5. Resolve authenticated identity when a token exists.
6. Call GitHub repository metadata and branch endpoints with the token; for public repositories,
   retry unauthenticated only when authentication is absent/invalid and clearly label fallback.
7. Confirm configured base branch exists.
8. Run a credential-safe `git ls-remote` probe through the same HTTPS authentication path that clone
   uses. Never embed credentials in persisted URLs.
9. Derive normalized capability evidence without performing writes.
10. Persist `READY` with capability evidence or `BLOCKED` with stable error code/message.
11. Publish progress; unlock **Next: Generate baseline** only when read is proven.

Stable error examples:

- `CREDENTIAL_MISSING`
- `CREDENTIAL_INVALID`
- `CREDENTIAL_PENDING_ORG_APPROVAL`
- `RESOURCE_OWNER_MISMATCH`
- `REPOSITORY_NOT_FOUND_OR_NOT_AUTHORIZED`
- `BASE_BRANCH_NOT_FOUND`
- `CLONE_NOT_AUTHORIZED`
- `PUSH_NOT_AUTHORIZED`
- `PULL_REQUEST_NOT_AUTHORIZED`
- `GITHUB_RATE_LIMITED`
- `GITHUB_UNAVAILABLE`

## 12. Runtime flow

### 12.1 Baseline/private clone

1. `SdlcHub` verifies repository read access is `READY`.
2. Durable SDLC context records exact execution/repository/session scope; grant IDs remain backend-only.
3. The agent calls only `sandbox-repo-setup`. Inside that trusted implementation, Claw confirms Node.js 20+,
   asks the sandbox through Kata to generate an ephemeral X25519 keypair, captures only public-key stdout, and
   calls the narrow backend S2S bootstrap endpoint. Script upload/execution are internal Kata SDK operations,
   not separate model-controlled tools.
4. Backend validates active durable scope, creates a fresh one-use grant, redeems it once, and rejects replay
   of the same sandbox and ephemeral-public-key binding. The Claw profile, durable execution, bootstrap request,
   and encrypted AAD must all bind the literal `sdlc-agent` slug.
5. The sandbox decrypts the AES-256-GCM envelope locally, writes a restrictive randomized Git credential
   helper, calls GitHub `/user` with the in-memory PAT, and installs a sandbox-local hook that makes the PAT
   account both commit author and committer using its ID-based noreply address. No commit name/email is
   stored or transported by this bootstrap; existing credential-validation login metadata is unchanged. It then
   clones/fetches the exact canonical repository/base branch and removes key/envelope/bootstrap files.
   Run-finally cleanup removes the helper; cached sandbox reuse performs a fresh bootstrap before Git access.
6. The agent receives repository path and capability metadata, never token text.

Public repositories without a credential skip the grant and clone anonymously.

### 12.2 Start Work

1. `SdlcHub.startWork` requires read, approvals, push, and PR gates.
2. Agent reads approved Code & Lint Standards and creates a safe non-default feature branch following those conventions.
3. Durable SDLC context contains exact repository/base/execution/session scope; grant IDs stay backend-only.
4. Prompt instructs clone/edit/check/commit/push only the returned work branch; never merge, force-push, or
   push the base/default branch.
5. Sandbox bootstrap obtains a fresh bound envelope and performs direct GitHub HTTPS push.
6. Agent calls a narrow SDLC pull-request tool; the main backend adapter creates a draft PR using the
   workspace credential.
7. Callback validation verifies provider, repository owner/name, base branch, head branch, and real PR
   URL before linking and moving the Ticket to In Review.
8. A runtime 401/403 marks capability stale/blocked and gives an administrator revalidation action.

The narrow PR tool avoids syncing the workspace token into Claw's unrelated global/user MCP
credential stores.

## 13. HTTP and tool interfaces

Dashboard/backend commands:

- `GET /api/sdlc/vcs/credentials`
- `PUT /api/sdlc/vcs/credentials/:provider`
- `POST /api/sdlc/vcs/credentials/:provider/validate`
- `DELETE /api/sdlc/vcs/credentials/:provider`
- `POST /api/sdlc/repositories/:repoId/access-check`
- existing setup/artifact/start-work routes gain module-owned gates.

Internal/Claw commands:

- `POST /api/internal/sdlc/vcs/runtime-credentials/bootstrap`
- `POST /api/sdlc/claw/pull-requests`

Rules:

- request bodies use Zod validation;
- credential commands are REST-only and never optimistic Zero mutations;
- metadata/read models may use Zero;
- expected conflicts return 409, authorization failures 403, absent resources 404, validation errors
  400, and unavailable GitHub dependencies 502/503;
- secret-bearing bodies and headers are explicitly excluded from request logging.

## 14. Change map

### Main backend

- Prisma schema/migration for credential and repository access fields;
- authenticated encryption module dedicated to credential envelopes;
- deep `SdlcVcs` module and GitHub adapter;
- credential/access-check routes and workspace/project ACL checks;
- `SdlcHub` progressive gates;
- `SdlcClawExecutionService` provider-neutral authoritative context and backend-only PR grant;
- narrow Claw PR route/tool implementation;
- setup/work queue integration and stale capability handling;
- provider-neutral callback PR validation;
- shared/Zero metadata queries.

### Dashboard

- Workspace Management repository credential settings;
- Project Detail Repos tab between Boards and Release;
- attached repository list and add/check/open actions;
- SDLC Overview progressive setup state;
- disabled modules/actions with accessible reasons;
- credential/capability status and admin remediation links.

### Claw auth/runtime/shared sandbox

- S2S-only sandbox bootstrap using durable binding; no runtime grant ID forwarding;
- runtime grants and secret-bearing fields stripped from durable context, prompts, debug, and logs;
- dynamic authenticated private clone/fetch/push path;
- Node crypto preflight, sandbox ephemeral keys, encrypted envelope bootstrap, and randomized helper lifecycle;
- provider-neutral SDLC repository metadata;
- narrow SDLC draft-PR tool exposure;
- authoritative durable SDLC context and convention-derived branch safety.

### Documentation

- PRD behavior/gates;
- tracker slices/evidence;
- operational PAT creation/rotation runbook;
- v2 decision register.

## 15. Backward compatibility and rollout

- No legacy Bitbucket environment variable, manager, release, webhook, or commit-analysis behavior is
  changed.
- Deployment-wide `GITHUB_TOKEN` remains for legacy callers but is never an SDLC fallback.
- Existing public attached repositories remain readable.
- Existing repositories beyond baseline setup are not deleted or rolled back. Their next mutable SDLC
  action requires a fresh access check; already-created artifacts remain readable.
- Existing approved baseline state remains approved.
- Existing active executions are allowed to finish under their original behavior during rollout;
  new executions use the new gate after deployment cutover.
- Credential migration does not copy any legacy environment secret into workspace storage.
- Rollout should be feature-flagged by workspace until one configured live smoke succeeds.

## 16. Verification plan

Follow the repository's existing v1 verification constraint: do not create a new broad automated test
suite. Use existing build/type/lint gates plus focused manual evidence. Security-critical pure policies
may reuse existing test infrastructure only if implementation review determines that doing so does not
expand the agreed test scope.

Required checks:

1. shared package build;
2. backend typecheck and targeted lint;
3. dashboard typecheck and lint;
4. Claw auth/runtime/shared package typechecks;
5. Prisma migration inspection and current-schema application;
6. enum validator;
7. static audit proving token fields never enter Zero/workflow/debug/log payloads;
8. configured live smoke against disposable repositories.

Manual matrix:

| Scenario | Expected result |
| --- | --- |
| Public repo, no credential | Read check passes anonymously; baseline available; Start Work blocked |
| Invalid PAT | Metadata shows invalid credential; public fallback labeled; private repo blocked |
| Fine-grained PAT pending org approval | Actionable blocked status |
| Private repo with read-only PAT | Baseline succeeds; Start Work blocked |
| Full permitted private repo | Baseline, approvals, feature push, draft PR succeed |
| Wrong resource owner | Repository-specific access blocked |
| Missing base branch | Baseline remains locked with branch error |
| Rotate credential | Existing checks become stale; recheck uses new identity/revision |
| Disconnect credential | Private repositories block; public repositories fall back to read only |
| Member views settings | Metadata visible; secret/config actions denied |
| Member attaches private repo | Uses shared capability without receiving token |
| Attempt artifacts before approvals | UI disabled and backend rejects |
| Attempt Start Work without push/PR | UI disabled and backend rejects |
| Agent completes work | Only convention-derived safe feature branch pushed; draft PR linked; never merged |

## 17. Delivery slices

Suggested small, reviewable sequence:

1. contracts, schema, migration, authenticated encryption;
2. deep `SdlcVcs` module plus GitHub adapter;
3. workspace credential commands and settings UI;
4. repository access-check state/worker/read model;
5. Project Repos tab and attachment integration;
6. SDLC progressive gates and manual baseline Next action;
7. runtime grant/private clone integration;
8. feature-branch push and narrow draft-PR tool;
9. legacy rollout handling, audit, redaction, and live smoke;
10. documentation evidence and final acceptance audit.

Each slice must preserve buildability. Secret persistence/injection must not ship ahead of its ACL,
redaction, and logging exclusions.

## 18. Acceptance criteria

1. Workspace owner/admin can validate and store one GitHub.com fine-grained PAT without any API/read
   path returning it.
2. Non-admin users see credential status but cannot mutate or reveal the credential.
3. Project-authorized users can attach public or credential-accessible private GitHub repositories.
4. Project Detail presents `Boards → Repos → Release`; repository actions live in Repos.
5. Attachment starts a durable, non-mutating access check and does not auto-start baseline.
6. Public repository without PAT passes read-only access; private repository without read access is
   blocked.
7. Hub enables **Next: Generate baseline** only after proven read access.
8. PRDs, Tech Docs, Tickets, and their creation actions stay locked until all five
   baseline documents are approved; backend commands enforce the same gate.
9. Start Work additionally requires direct branch push and draft-PR capability.
10. Private baseline clone uses the workspace credential without serializing it into durable run/debug
    state.
11. Start Work pushes the computed non-default feature branch directly and opens a draft GitHub PR.
12. Agent prompt forbids default-branch push, force-push, and merge; v1 limitation clearly records lack
    of transport-level enforcement.
13. Credential replacement/disconnect invalidates prior access checks and produces actionable UI.
14. Existing legacy Bitbucket and deployment GitHub integrations remain behaviorally unchanged.
15. Adding a future provider requires a new adapter and provider metadata, not changes to SDLC routes,
    gates, or generic persistence shape.

## 19. Primary documentation references

- [Managing GitHub personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Fine-grained PAT endpoint permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
- [Create a pull request](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request)
- [Creating a pull request from a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/creating-a-pull-request-from-a-fork)
- [Authenticating Git operations over HTTPS](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git)
