# SDLC Development and Pull Requests

SDLC development spans Xyne Spaces and Xyne Claw, and both now ship from `main`. Keep each delivery on one
main-based branch so integration changes are reviewed and tested together.

## Branch contract

| Purpose | Head branch | Pull request base |
| --- | --- | --- |
| SDLC development and delivery | `sdlc` | `main` |

Create or rebuild `sdlc` from the latest `origin/main`. Do not synchronize Claw folders from a separate deployment
branch: `main` is the canonical source for the entire repository.

## Change ownership

Keep subsystem boundaries clear even though the delivery branch is shared:

- `apps/backend/**`, `apps/dashboard/**`, and `packages/shared/**` own the Spaces-side SDLC experience.
- `apps/xyne-claw/**`, `apps/xyne-claw-auth/**`, and `packages/xyne-claw-shared/**` own the Claw runtime integration.
- Root manifests, lockfiles, migrations, and shared SDK changes must be attributable to an SDLC dependency or
  integration requirement.

Avoid whole-folder synchronization commits. Port only SDLC-specific changes onto the current `main` implementation
when upstream APIs have moved.

## Development workflow

1. Fetch the latest `origin/main`.
2. Create or update `sdlc` from that exact tip.
3. Apply SDLC changes in dependency order, resolving overlaps in favor of current `main` behavior plus the required
   SDLC integration.
4. Review `git diff origin/main...sdlc` for unrelated files, upstream reversions, and accidental generated artifacts.
5. Run backend, dashboard, Claw, shared-package, migration, and schema checks.
6. Push `sdlc` and open one pull request against `main`.

Commit headers follow the repository format:

```text
<type>: <TICKET-ID> <imperative subject>
```

Use `--force-with-lease`, never an unguarded force push, when an existing delivery branch must be reconstructed. If
a fetched remote tip changed unexpectedly, stop and inspect it before overwriting anything.

## Pull-request checklist

- The branch is based on the latest intended `main` tip.
- The diff contains SDLC-related changes only and does not revert newer `main` behavior.
- Spaces and Claw integration contracts are updated together.
- Typechecks, builds, lint, tests, migration checks, and generated-schema checks pass.
- Rollout order and compatibility constraints are documented when deployment cannot be atomic.
- Known base-branch test failures are reproduced on `main` before being labeled pre-existing.
