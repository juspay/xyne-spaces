# SDLC VCS credentials — operations and acceptance runbook

Status: implementation handoff
Scope: GitHub.com fine-grained PAT v1
Last updated: 2026-08-11

This runbook operates the design in [VCS_CREDENTIALS_PLAN.md](./VCS_CREDENTIALS_PLAN.md). It never asks
an operator to copy a token into logs, tickets, chat, or commands.

## 1. Preconditions

S1. Confirm the backend `ENCRYPTION_KEY` is a 32-byte hex key shared by API and worker instances.
Expected: both processes can encrypt/decrypt the same AES-256-GCM envelope.

S2. Create a GitHub.com fine-grained PAT for one resource owner and only the selected repositories.
Expected: token has Metadata read, Contents read/write, Pull requests read/write, and Workflows read/write;
no Administration, Rules, merge-bypass, or unrelated repository permissions. GitHub requires Workflows
write when a task creates or changes a file under `.github/workflows`.

S3. Give the token an expiry and record its owner/expiry in the team's secret-management system.
Expected: rotation has an accountable owner and date; the PAT value is not stored in this repository.

## 2. Availability

Repository credentials are available to every workspace without a metadata or environment feature key.
Workspace owner/admin authorization still controls configuration, replacement, revalidation, and disconnect;
repository membership and capability checks still control consumption.

S1. As a workspace owner/admin, open Workspace Management → Repository credentials.
Expected: the credential surface loads without workspace metadata configuration.

S2. Watch access-check/runtime error codes during rollout.
Expected: credential and provider failures remain isolated by workspace and repository.

### 2.1 SDLC worker deployment

The API always produces into the single Bull queue named `sdlc`. Only the dedicated worker deployment may
consume it. Configure that deployment with:

```env
ENABLE_SDLC_WORKER=true
SDLC_GLOBAL_ACTIVE_LIMIT=9
SDLC_REPO_ACTIVE_LIMIT=3
```

Keep `ENABLE_SDLC_WORKER=false` on every other worker deployment. Restart backend and worker processes after
changing these environment values. The Redis admission controller limits actual in-flight SDLC operations—not
only webhook dispatches—to nine globally and three per repository. Pending repositories receive permits in
round-robin order, so one repository backlog cannot starve another.

Bull currently retains the newest 100 completed queue jobs and 500 failed queue jobs. This is count-based, not
time-based. Admission permits are deleted at terminal completion/failure/cancellation; abandoned permits expire
after 15 minutes and are repaired by reconciliation. Time-based terminal-job cleanup is deferred and recorded in
the v2 decisions/backlog.

## 3. Configure or rotate

S1. As a workspace owner/admin, open Workspace Management → Repository credentials.
Expected: GitHub.com guidance, resource-owner field, masked PAT input, and Validate and save are visible.

S2. Enter the exact GitHub resource owner and PAT, then select Validate and save.
Expected: GitHub identity/resource owner are validated before ciphertext is committed; the response shows
metadata only.

S3. For rotation, choose Replace and validate a newly issued PAT.
Expected: failed validation leaves the old credential active; success atomically increments revision and marks
attached repository checks stale.

S4. Re-run Check access on attached repositories.
Expected: each repository stores evidence against the new credential revision before mutable actions resume.

S5. Revoke the old PAT at GitHub only after all required repositories pass.
Expected: no active execution depends on the retired token.

## 4. Disconnect

S1. Stop or let active SDLC work executions finish.
Expected: no in-flight execution expects a credential that is about to be revoked.

S2. Choose Disconnect and confirm.
Expected: encrypted payload/IV/tag are cleared, revision increments, and repository checks become stale.

S3. Revoke the PAT at GitHub.
Expected: no valid provider credential remains.

S4. Re-run public repository checks if read-only use should continue.
Expected: public repositories report anonymous proven read; private repositories remain blocked.

## 5. Acceptance smoke

Use a disposable private repository whose default branch is protected and whose PAT cannot bypass protection.

S1. Attach the repository from Project → Repos.
Expected: repository shell persists and one access check is queued; baseline does not auto-start.

S2. Refresh while the check runs.
Expected: queued/checking state survives refresh and resolves to repository/visibility/base/capability evidence.

S3. Select Next: Generate baseline.
Expected: this is enabled only with proven read and repository-admin membership.

S4. Approve all five baseline documents.
Expected: PRDs, Tech Docs, and Tickets unlock only after the fifth approval.

S5. Create a PRD, Tech Doc, and Ticket, then select Start Work.
Expected: backend rechecks read/push/PR evidence and approvals before dispatch.

S6. Inspect the remote result.
Expected: exactly the safe convention-conforming feature branch returned by the agent was pushed, default branch was untouched, and a draft PR
targets the configured base with the exact remote commit. Both commit author and committer resolve to the
authenticated PAT account through its ID-based GitHub noreply address; the Spaces triggering user is not used
for SDLC commit attribution.

S7. Inspect API/log/queue/workflow/debug/Zero surfaces using a unique canary PAT in a non-production smoke.
Expected: no plaintext PAT, ciphertext, authenticated URL, credential-helper contents, or reversible token
fragment appears.

## 6. Negative matrix

Run once before broad rollout: public/no token, invalid token, pending organization approval, private read-only,
private full write/PR, wrong resource owner, missing base branch, rotation, disconnect, member mutation attempts,
grant replay/expiry/wrong binding, crafted baseline/artifact/Start Work calls, and callback repo/head mismatch.

Expected outcomes are the capability matrix and strict gates in [VCS_CREDENTIALS_PLAN.md](./VCS_CREDENTIALS_PLAN.md).
Provider 401/403 authentication failures must stale the relevant repository capability and direct the user to
revalidate or replace the credential.

## 7. Rollback

S1. Stop/retry affected executions through existing SDLC controls.
Expected: no new credential-bearing sandbox run starts.

S2. Disconnect and revoke the PAT if compromise is suspected.
Expected: ciphertext is cleared, revision changes, repository checks stale, and GitHub rejects the old PAT.

S3. Roll back the application release if the credential feature itself must be disabled globally.
Expected: availability changes through deployment rollback, not mutable workspace metadata.

S4. Leave additive migration columns/tables in place during application rollback.
Expected: legacy Bitbucket, Release, commit analysis, webhook, deployment GitHub, approvals, and artifact data are
not destructively migrated.

## 8. Known v1 limitations

- Raw fine-grained PAT is briefly present in an agent-controlled sandbox credential helper.
- Branch safety is approved convention context plus backend safe-ref/default-branch validation, not a Git transport enforcement boundary.
- Push and PR capability are evidence-based predictions until the real operation proves them.
- Open tracked pull requests are reconciled by the backend worker every minute; a repository webhook is not
  required for the Ticket to reach Done after merge.
- One credential supports one GitHub resource owner per workspace.
- GitHub Enterprise, GitLab, Bitbucket SDLC adapter, forks, brokered Git, and trusted backend push are deferred in
  [DECISIONS_NEEDED_FOR_V2.md](./DECISIONS_NEEDED_FOR_V2.md).

## 9. Local SDLC cleanup

Preview SDLC state that would be removed:

```bash
pnpm sdlc:cleanup
```

Delete it after reviewing counts:

```bash
pnpm sdlc:cleanup -- --yes
```

Cleanup is hard-blocked unless both database hosts are loopback and the Spaces backend runs in development/test mode. It removes all local SDLC repository hubs, generated boards, Tickets, Canvases, conversations, workflow executions, Claw run history, and SDLC Redis queue/admission state. It preserves workspace registration, users, Projects, agent configuration, and workspace GitHub credentials.
