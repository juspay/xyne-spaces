## Type of Change

- [ ] Bugfix
- [ ] New feature
- [ ] Enhancement
- [ ] Refactoring
- [ ] Dependency updates
- [ ] Documentation
- [ ] CI/CD

## Description
<!-- What changed, and why. Link the ticket (XYNE-xxxx) or issue. -->


### Root Cause
<!-- Bugfix PRs only — delete this heading otherwise. CI requires at least 150 characters. -->

- **Introduced in:** <!-- the PR or commit that caused it, if known -->
- **What broke:** <!-- the actual defect and why it happened, not what the fix does -->
- **How it was fixed:** <!-- the change this PR makes, and why it holds -->


### Additional Changes
<!-- Tick what applies and say what changed, including rollout order if it matters. -->

- [ ] Zero mutator, schema, query or ACL
- [ ] Prisma schema, migration or backfill
- [ ] Env variable, base URL, CORS or OAuth redirect URI
- [ ] API contract — new endpoint, or breaking for dashboard / electron / bots


## How did you test it?
<!-- What you actually ran. Screenshots or a recording for UI changes. Note the surfaces
     and cases you covered: web vs. electron, one user vs. two, roles, offline/reconnect. -->


## Checklist

- [ ] Reviewed my own diff; scoped to one thing
- [ ] Build, typecheck and lint pass for the packages I touched
- [ ] Added or updated tests, or noted above why not
- [ ] Commits follow `<type>: <TICKET-ID> <subject>`; branch is `fix/*` or `feature/*`
- [ ] No debug logging, commented-out code or committed secrets
