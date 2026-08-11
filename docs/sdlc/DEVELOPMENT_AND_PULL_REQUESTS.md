# SDLC Development and Pull Requests

SDLC development crosses Xyne Spaces and Xyne Claw, but the two deployments have different target branches.
Every SDLC delivery round must therefore end with two independently reviewable pull requests.

## Branch contract

| Purpose | Head branch | Pull request base |
| --- | --- | --- |
| Local integration and end-to-end development | `feature/sdlc-mix` | No pull request |
| Xyne Spaces delivery | `feature/sdlc` | `main` |
| Xyne Claw delivery | `feature/sdlc-claw` | `feature/deploy-xyneclaw` |

`feature/sdlc-mix` may combine both deployments for local testing. It is a recovery and integration branch only;
never push it as a pull-request head.

Before starting or splitting a round, fetch both target branches. Build each delivery branch from its own current
target, not from the mixed branch's base.

## Ownership

Claw owns these paths:

- `apps/xyne-claw/**`
- `apps/xyne-claw-auth/**`
- `packages/xyne-claw-shared/**`
- `packages/kata-sdk/src/filesystem.ts`, the direct Claw streaming compatibility surface

Spaces owns backend, dashboard, shared application packages, SDLC documentation, and repository-level tooling.
Classify root manifests and lockfiles by the dependency or deployment that caused the change. If both targets truly
require the same root change, include it deliberately in both pull requests and explain why.

Never put a full Claw-folder synchronization commit into the Spaces pull request. Never use the `main` versions of
the Claw-owned paths as the source for a Claw pull request.

## Round workflow

1. Fetch `origin/main` and `origin/feature/deploy-xyneclaw`.
2. Update the mixed branch with the latest Claw-owned snapshot and complete local integration testing.
3. Checkpoint the round on `feature/sdlc-mix` with a ticketed commit.
4. Rebuild `feature/sdlc` from `origin/main` and apply only Spaces-owned changes.
5. Rebuild `feature/sdlc-claw` from `origin/feature/deploy-xyneclaw` and apply only Claw-owned changes.
6. Compare both pull-request branches with their own bases and confirm no ownership leakage.
7. Run target-specific typechecks, builds, lint, tests, and migration checks.
8. Open two pull requests, cross-link them, and state any merge or deployment order.

Commit headers follow the repository format:

```text
<type>: <TICKET-ID> <imperative subject>
```

Use `--force-with-lease`, never an unguarded force push, when an existing delivery branch must be reconstructed.
If a fetched remote tip changed unexpectedly, stop and inspect it before overwriting anything.

## Pull-request checklist

- Spaces diff contains no Claw-owned paths.
- Claw diff contains no Spaces-owned paths unless an explicitly documented cross-target root change requires it.
- Both pull requests use the repository template and link the same ticket.
- Both pull requests link each other.
- Rollout order and compatibility are documented.
- Known base-branch test failures are reproduced on the base before being labeled pre-existing.
- Mixed-branch changes are accounted for by one of the two delivery branches or explicitly documented as local-only.
