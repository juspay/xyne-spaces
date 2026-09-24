# Automation test watchdog — agent procedure

Runs every 2 hours from an Orca automation. `watchdog.mjs` does the mechanical half (run the
suite, keep the ledger, decide what is *consistently* failing). This file is the other half:
diagnose, fix, PR.

Read `tools/xyne-automation/AGENTS.md` before editing anything under `tools/xyne-automation`.

## 1. Sync

```bash
git checkout sumantop/automation-test-watchdog
git fetch origin && git rebase origin/main
```

Check the branch out first, unconditionally — a previous cycle may have left a fix branch
checked out, and the suite must measure main, not a fix. The watchdog branch is local-only and
carries just the watchdog files, so the rebase is a clean replay onto latest main; once the
watchdog itself lands on main it becomes a no-op. If the rebase conflicts, `git rebase --abort`,
report it and stop — never run against a half-rebased tree.

## 2. Run

```bash
node tools/xyne-automation/scripts/watchdog.mjs run
```

~40-60 min: it brings up the docker stack (`docker-compose.dev.yml` + `docker-compose.test.yml`)
and runs every non-`quarantine` scenario. Exit 2 means the stack never came up — that is an
infrastructure failure, not a test failure. Report it and stop; do not "fix" anything.

The verdict it prints has three buckets:

- **CONSISTENT** — failed 3 runs in a row. These, and only these, are yours to fix.
- **CONFIRMING** — failing but not yet 3 in a row. Leave alone; the next cycles decide.
- **FLAKY** — passes and fails across the window. Leave alone. Report it, never quarantine it
  on your own.

No CONSISTENT entries → print a one-line summary and stop. That is the normal outcome.

## 3. Per consistent failure

At most **3 per cycle**, longest streak first.

**Skip if already handled.** `gh pr list --state open --head watchdog/<slug>` — if a watchdog PR
for that scenario is open, move on. Only if the failure *signature* changed (different step,
different error) add a comment to that PR saying so.

**RCA before you touch a line.** The verdict prints the run's artifact directory:

- `json-report/result.json` — failing step and error message
- `html-report/` — screenshot at the moment of failure
- `docker-logs/` — backend/dashboard logs for the same window

Then find when it broke. The ledger at `~/.xyne-automation-watchdog/history.jsonl` records a
commit per run, so the last passing run's commit and the first failing run's commit bracket the
culprit:

```bash
git log --oneline <lastGood>..<firstBad> -- apps/dashboard apps/backend
```

Read the candidates against what the failing step actually depends on — a `data-testid`, a route,
an API shape, a default view. Name the culprit commit and PR in your writeup. If you cannot
bracket it (no passing run in the ledger), say so rather than guessing.

**Then decide which side is wrong.**

- *Test is wrong* (the default): the app changed legitimately and the test encoded an assumption
  it was never promised. Fix the spec, concept, step definition or fixture. Follow AGENTS.md —
  expected values come from fixtures, scenarios stay parallel-safe, step text stays stable.
  Prefer making the assertion agnostic over pinning it to the new behaviour.
- *App is wrong*: the RCA proves a real regression — a testid dropped by accident, a route that
  404s, an API that changed shape without a migration. You may fix `apps/*`. Smallest surgical
  change; never weaken validation, auth or error handling to make a test pass; never commit
  `apps/backend/prisma/generated/zero/schema.ts`. Say loudly in the PR title and body that this
  PR touches product code and why.

**Verify.**

```bash
node tools/xyne-automation/scripts/watchdog.mjs verify tests/<path>.spec
pnpm --filter xyne-automation exec biome check --assist-enabled=true <the files you changed>
pnpm --filter xyne-automation run validate:literals
```

`verify` deliberately does not write the ledger — a partial run would reset every other
scenario's streak.

Check your own files, not the package: `pnpm --filter xyne-automation run validate` is red on
main for reasons that predate the watchdog (a deprecated key in `biome.json`, formatting in
`fixtures/baseline.ts`, `scripts/run-gauge.ts` and `manifest.json`, `console` use in
`build-summary-report.mjs`). Do not chase those, and do not bundle that cleanup into a fix PR.

If you touched `apps/*`, also run the CI checks for what you changed (`xyne-ci-check` skill, or
the matching `pnpm --filter ... run typecheck|lint:errors-only`).

**Open the PR.**

```bash
git checkout -b watchdog/<slug> origin/main   # off main, never off the watchdog branch
git add <only the files you fixed>            # never `git add -A`
git commit -m "fix: <what the fix does>"      # one line, no trailer
git push -u origin watchdog/<slug>
gh pr create --base main
git checkout sumantop/automation-test-watchdog
```

Branching off `origin/main` and adding only your own files keeps the watchdog's own files out of
the fix PR while it is still unmerged. Body: what failed and since which commit, the RCA, what
you changed and why that is the right side to change, and the verify output before and after.

## 4. When you cannot fix it

Two failed fix attempts, or an RCA that does not land — open a quarantine PR instead. Add
`tags: quarantine` under the scenario heading (`run-gauge.ts` filters `!quarantine`), and put the
full RCA plus what un-quarantining needs in the PR body. That keeps the rest of the suite green
so `RUN_TEST_CASE` can go back on.

## 5. When the whole suite is broken, not one scenario

If the verdict prints a `GATE:` line, too much is consistently failing to fix in one cycle
(default: 5+ scenarios, or over 20% of what executed). Leaving the merge-queue gate on in that
state blocks everyone's merges behind a suite that cannot pass, so take it off:

```bash
node tools/xyne-automation/scripts/watchdog.mjs gate off --reason "<what is broken>"
gh issue create --title "Automation test gate disabled — N scenarios failing consistently" \
  --body "<the consistent list, the RCA so far, and what re-enabling needs>"
```

`gate off` writes `vars.RUN_TEST_CASE=false` (the gate on ci.yml's `test` job) and no-ops if it
is already off. Then carry on with the normal fix/quarantine flow for the top 3.

**Turning the gate back on is not yours to do.** A wrong re-enable blocks the whole team's merge
queue. When the suite has earned it — three consecutive fully green runs with nothing in
CONSISTENT or CONFIRMING — say so plainly at the top of your summary and leave the click to a
human. `gate on` deliberately refuses.

## 6. Rails

- Never merge, close, approve or force-push. Never push to `main`.
- Never edit `.github/workflows/**`. You may turn the `RUN_TEST_CASE` gate **off** through
  `watchdog.mjs gate off` when the verdict says so (§5); turning it back **on** is a human
  decision, never yours.
- If more than a third of the suite fails at once, that is the environment, not the tests. Report
  it and stop.
- Max 3 PRs per cycle.
