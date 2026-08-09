# SDLC decisions needed for v2

Status: decision register
Owner: Xyne Spaces
Last updated: 2026-08-04

This file records decisions intentionally deferred from the quick GitHub PAT v1 described in
[VCS_CREDENTIALS_PLAN.md](./VCS_CREDENTIALS_PLAN.md). Entries are not v2 commitments. Each entry names
the trigger that should force a decision before implementation proceeds.

## Decision template

Every decision should eventually record:

- context and threat/problem;
- options considered;
- chosen option and owner;
- migration from v1;
- rollout/rollback plan;
- evidence and decision date.

## D1 — remove long-lived PAT from agent-controlled sandbox

### v1 choice

Inject the workspace fine-grained PAT ephemerally for authenticated clone/fetch/push. Protect it with
S2S run binding, restrictive helper files, cleanup, egress policy, path blocking, and output redaction.

### Why deferred

Speed. Existing sandbox Git flow expects the agent to operate a normal worktree and push directly.

### Risk

Redaction is defense in depth. A malicious repository or prompt can deliberately transform/encode a
long-lived token while it is present inside the sandbox.

### Options

1. **Credentialed Git broker** — sandbox receives a short-lived internal grant and uses an internal
   Git smart-HTTP remote. Broker binds exact upstream repository, allowed operations, branch refs,
   expiry, and audit while adding the real credential upstream.
2. **Trusted backend finalization** — sandbox commits locally and exports a Git bundle/object pack.
   Trusted worker verifies base/diff/ref, imports the exact commit, pushes, and creates the PR.
3. **GitHub App** — replace PAT with one-hour installation tokens scoped to selected repositories and
   permissions. This reduces exposure but still needs safe sandbox delivery.

### Decision trigger

Before onboarding untrusted repositories at scale, supporting customer-controlled repositories, or
claiming the workspace credential cannot be accessed by agent code.

## D2 — enforce allowed push refs outside the LLM

### v1 choice

Backend computes a feature branch and the LLM is instructed never to push the base/default branch,
force-push, or merge. No transport-layer ref guard exists.

### Required v2 decision

Choose enforcement point:

- broker rejects pushes except the exact run-bound head ref;
- trusted worker alone pushes verified commits;
- provider-side branch protection/rulesets are required and verified;
- combine broker/worker enforcement with provider protection.

The check must reject default branch, tag creation, force updates, deletion, extra refs, and a branch
that does not equal the safe convention-derived run branch returned by the agent.

### Decision trigger

Before granting a token that can bypass branch protection, supporting repositories without enforced
rulesets, or advertising a hard guarantee that SDLC cannot update default branches.

## D3 — fork-based contribution for public repositories

### v1 choice

Start Work supports direct-repository push only. A public repository without upstream write remains
readable and can complete baseline/artifact work, but cannot Start Work.

### Options

- automatically create/reuse a user- or bot-owned fork;
- require administrator to select an existing fork;
- use GitHub App installation across upstream and fork;
- keep direct push only.

### Questions

- Who owns the fork?
- Can organization policy forbid forking?
- How are upstream default-branch changes synchronized?
- Who may delete stale branches/forks?
- Are organization-owned forks acceptable given maintainer-edit limitations?
- How are PR head owner/repo/ref validated?

### Decision trigger

When the product must contribute to public repositories where the workspace identity lacks upstream
write access.

## D4 — GitHub App versus PAT

### v1 choice

One workspace GitHub.com fine-grained PAT.

### GitHub App advantages to evaluate

- repository installation/selection UX;
- one-hour installation access tokens;
- explicit permission manifest;
- organization-controlled revoke/approval;
- app attribution and webhook identity;
- reduced dependence on one human account.

### Migration questions

- Can PAT and App coexist during migration?
- Does each repository select an installation?
- How are existing access checks invalidated?
- Which user installs/approves the app?
- How is GitHub Enterprise App registration handled?

### Decision trigger

Multiple GitHub organizations, customer self-service, stronger audit requirements, or unacceptable PAT
rotation/offboarding burden.

## D5 — multiple credentials and resource owners

### v1 choice

One fine-grained PAT and therefore one GitHub resource owner per workspace.

### Options

- multiple named credentials with explicit repository binding;
- one default credential plus per-repository override;
- GitHub App installation selected per repository;
- separate integration workspace per resource owner.

### Decision trigger

A workspace needs write access to repositories owned by multiple GitHub organizations/users, or needs
separate bot identities/permission tiers.

## D6 — GitHub Enterprise

### v1 choice

GitHub.com only.

### Required work/decisions

- configured web and API hosts;
- enterprise/cloud/server version support matrix;
- SSRF-safe allowlisting and DNS/IP validation;
- TLS/private CA behavior;
- fine-grained PAT availability by server version;
- callback/PR URL validation across hosts;
- rate-limit and API-version differences.

### Decision trigger

First customer/workspace requiring GitHub Enterprise Cloud dedicated subdomain or GitHub Enterprise
Server.

## D7 — Bitbucket adapter

### v1 choice

Leave existing Bitbucket environment/MCP/release behavior untouched. Do not route it through the new
SDLC module yet.

### Adapter questions

- Bitbucket Cloud versus Data Center are separate provider variants or one adapter family;
- token/app-password/HTTP access-token credential schemas;
- project/repository URL canonicalization;
- clone, branch push, and draft semantics;
- PR permission detection and URL validation;
- base URL/SSRF policy for self-hosted Data Center;
- migration, if any, from legacy environment credentials.

### Decision trigger

Before SDLC attachment accepts any Bitbucket URL.

## D8 — GitLab adapter

### v1 choice

No GitLab runtime support; generic module and normalized capabilities must leave a clean adapter seam.

### Adapter questions

- GitLab.com versus self-managed host support;
- personal/project/group access token choice;
- namespace/project canonicalization;
- protected branch and merge-request behavior;
- draft merge-request semantics;
- API and Git URL host validation;
- token scope and expiry inspection.

### Decision trigger

Before SDLC attachment accepts any GitLab URL.

## D9 — capability proof and continuous authorization

### v1 choice

Use non-mutating checks. Mark read as proven, infer role-based write capability where possible, state
required PAT permissions, and treat the real push/PR call as final proof.

### Options

- disposable permission-probe branch that is immediately deleted;
- provider installation/token introspection where supported;
- repository ruleset/branch-protection inspection;
- cached checks with runtime revalidation;
- always attempt operation and translate provider errors.

### Decision trigger

When UI must guarantee write/PR capability before Start Work, rather than present an evidence-based
prediction.

## D10 — credential scope below workspace

### v1 choice

Every project-authorized user may attach private repositories accessible to the shared workspace PAT.

### Risk

This lets those users probe repository names and import source that the PAT can access into the
workspace authorization domain.

### Options

- workspace-admin-only private attachment;
- admin approval for private attachments;
- per-project credential/repository allowlist;
- GitHub App repository selection as authoritative allowlist.

### Decision trigger

When project authorization and external repository authorization do not represent the same trusted
group, or a workspace credential spans sensitive repositories.

## D11 — credential encryption and key management

### v1 choice

Authenticated application-layer encryption with a versioned key envelope.

### Options

- cloud KMS envelope encryption per credential;
- secret manager reference instead of ciphertext in PostgreSQL;
- per-workspace data-encryption keys;
- automated rotation/re-encryption jobs;
- break-glass/audit controls.

### Decision trigger

Compliance requirements, multi-region deployment, key rotation, or separation-of-duty requirements.

## D12 — tests beyond current v1 constraint

### v1 choice

Follow existing SDLC v1 constraint: build/type/lint gates, migration inspection, security audit, and
configured manual smoke; no new broad automated suite.

### Recommended future coverage

- deep `SdlcVcs` interface contract tests;
- provider adapter conformance suite;
- fake GitHub HTTP adapter tests for permission/error mapping;
- credential ACL/secret non-disclosure integration tests;
- progressive gate state-machine tests;
- runtime grant replay/expiry/cross-repository rejection tests;
- malicious-output redaction/exfiltration regression tests;
- disposable-repository end-to-end CI.

### Decision trigger

Before adding a second provider adapter or changing the runtime credential delivery model.
