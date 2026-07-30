<!--
Title format (commitlint enforces this on your commits):
  <type>: <TICKET-ID> <subject>        e.g.  fix: XYNE-1234 reset filters on space change
Types: feat, feature, fix, docs, style, refactor, perf, test, chore, build, ci, revert
-->

## What changed

<!-- One or two sentences. What does this do that the codebase did not do before? -->

## Why

<!-- The problem being solved. Link the ticket or issue: Fixes #123 -->

## How it was tested

<!--
Be specific — "tested locally" tells a reviewer nothing.
What did you run, and what did you observe?
-->

- [ ] `pnpm --filter xyne-spaces-backend run typecheck`
- [ ] `pnpm --filter xyne-spaces-dashboard run typecheck`
- [ ] Relevant tests (`pnpm --filter xyne-spaces-backend run test`)
- [ ] Verified by hand in the running app

## Checklist

- [ ] Branch is named `fix/…` or `feature/…` (the pre-push hook enforces this)
- [ ] Commits follow `<type>: <TICKET-ID> <subject>`
- [ ] New dependencies were added with `pnpm --filter <package> add …`, not a bare `pnpm add`
- [ ] Prisma client regenerated if a schema changed (`db:generate`, `db:common:generate`)
- [ ] Docs updated in this PR if setup, ports, env vars, or commands changed
- [ ] No secrets in the diff (gitleaks runs on pre-commit)

## Screenshots

<!-- For UI changes: before and after. Delete this section if not applicable. -->
