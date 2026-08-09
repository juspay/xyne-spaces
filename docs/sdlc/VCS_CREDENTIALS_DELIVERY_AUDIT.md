# SDLC VCS credentials — delivery audit

Status: implementation and configured basic sanity complete; extended user acceptance pending
Date: 2026-08-05

## Delivered evidence

| Area | Evidence |
| --- | --- |
| Credential envelope/lifecycle | Workspace/provider `ExternalSource`, authenticated AES-256-GCM envelope, validate-before-swap, revision invalidation, disconnect clearing, and migrated legacy rows/table cleanup |
| Authorization/non-disclosure | Owner/admin backend mutations, repository membership consumption, metadata-only responses/audits, credential/grant tables excluded from Zero |
| Provider seam | `SdlcVcs` and `VcsProviderAdapter`; GitHub.com parsing, validation, repository/PR inspection, Git auth, draft PR, remote commit and PR URL checks remain inside adapter/module |
| Workspace/project UI | Repository credentials settings; `Boards → Repos → Release`; list/empty/loading/error/check/retry/remediation states |
| Progressive gate | Durable access worker, anonymous public fallback, manual baseline Next, approval-gated artifacts, capability-gated Start Work, identical backend checks |
| Runtime | Backend-only one-use grants, strict `sdlc-agent` and sandbox/public-key-bound encrypted bootstrap nested under repository setup, sandbox-only PAT-account lookup and commit attribution, restrictive randomized helper with run-finally cleanup and cached-session refresh, public credential-free path, convention-derived branch, narrow backend-owned draft-PR tool |
| Failure/security | Provider error codes, stale capability on runtime auth failure, PAT/authenticated-URL redaction, secret-path guards, no PAT in durable context |
| Rollout | Available to all workspaces; role/repository authorization and operations/rollback runbook |

## Acceptance-criteria audit

| VCS plan criterion | Delivery result |
| --- | --- |
| 1. Admin stores one PAT; no user read path | Implemented and configured; static/API response audit exposes metadata only |
| 2. Member sees metadata, cannot mutate/reveal | Implemented; role smoke pending |
| 3. Authorized public/private attachment | Public configured smoke passed; private provider smoke remains user acceptance |
| 4. Boards → Repos → Release | Implemented and dashboard typechecked/linted |
| 5. Durable non-mutating check; no auto-baseline | Implemented with PostgreSQL state and Bull coordination |
| 6. Public anonymous read/private blocked | Anonymous public probe passed; private case remains user acceptance |
| 7. Manual Next only after proven read | Implemented in UI and backend |
| 8. Five-approval artifact gate | Implemented in UI, routes, hub, and tools |
| 9. Start Work needs read/push/PR | Implemented in UI and backend |
| 10. Private clone without durable PAT state | Opaque grant/helper path passed against a credentialed public fork; private visibility remains user acceptance |
| 11. Convention-derived feature branch and draft PR | Live configured smoke passed on `feature/test-0004` and draft PR #1 |
| 12. Prompt branch restrictions and disclosed soft enforcement | Implemented and documented as v1 limitation |
| 13. Rotation/disconnect invalidates checks | Implemented |
| 14. Legacy provider behavior unchanged | Confirmed by isolation audit/typechecks: no legacy provider is routed into `SdlcVcs`; existing callers retain default non-draft behavior; SDLC GitHub merge state uses provider-adapter polling without changing legacy webhooks |
| 15. Future provider is an adapter | Implemented provider-neutral contracts/routes/gates/persistence; enum metadata addition remains expected |

## Sanity evidence

- `pnpm --filter @xyne/shared build` — passed.
- Backend typecheck and targeted SDLC/VCS lint — passed.
- Dashboard typecheck, targeted changed-surface lint, and production build with an 8 GB Node heap — passed.
- Claw auth, Claw runtime, Claw shared, and Kata SDK typechecks — passed.
- `pnpm test:enum` — passed.
- Prisma schema validation and generated-client generation — passed; migration SQL inspected, not applied to a shared/live database.
- AES-256-GCM round-trip/tamper rejection and GitHub URL canonicalization sanity — passed with a fake key and no network.
- Progressive-gate policy sanity — passed: baseline/artifacts require read, Start Work requires read/push/PR,
  and duplicate/incomplete approvals remain locked. Backend call sites consume the same policy before mutation.
- Crafted baseline tool audit found and closed historical-execution reuse: baseline create/update now also require
  current read capability, a RUNNING setup execution owned by the initiating user, matching repository, and exact
  workflow/setup execution binding.
- Live non-mutating GitHub checks — public `github/gitignore` read proven anonymously with push/PR unavailable;
  a deliberately fake PAT mapped to `GITHUB_CREDENTIAL_INVALID`; a nonexistent branch mapped to
  `GITHUB_REPOSITORY_NOT_FOUND`.
- Live configured end-to-end smoke — attached `ameernoufil/pets-workshop`, generated and approved five baseline
  canvases, created PRD/Tech Doc/Ticket, pushed commit
  `399f5e9039891532af69c5fda46897eb90aae267` to selected branch `feature/test-0004`, created draft PR #1,
  recorded its ready-for-review transition, and merged it.
- Provider-adapter reconciliation marked the tracked PR `MERGED` and its Ticket `Done / COMPLETED`; the
  focused database assertion that originally failed now passes.
- SDLC recovery test — 6/6 passed with Watchman disabled and an 8 GB Node heap.
- `git diff --check` — passed.
- Static Zero audit found no credential/grant/envelope fields.
- Static SDLC audit found no legacy `getGitProvider`, deployment `GITHUB_TOKEN`, or GitHub URL construction outside the adapter in production callers.

## User acceptance still required

The configured basic smoke is complete. Per owner direction, broader validation remains user acceptance: private
read-only/full-write repositories, pending organization approval, wrong resource owner, disconnect, and
member/admin mutation attempts. Execute the remaining cases in sections 5 and 6 of
[VCS_CREDENTIALS_RUNBOOK.md](./VCS_CREDENTIALS_RUNBOOK.md) before broad rollout; they do not block the completed
implementation tracker.

The one-use S2S grant-redemption response carries only an authenticated encrypted envelope. Plaintext exists
only after sandbox-local decryption in the restrictive Git helper; arbitrary code in that sandbox can still
access it, which remains the accepted v1 risk.
