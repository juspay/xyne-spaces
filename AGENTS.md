# SDLC Branch Workflow

These rules apply to SDLC work in this repository:

- Use `sdlc-dev` as the operating and development branch.
- Use `sdlc` as the production-only branch for pull requests into `main`.
- Keep documentation, tests, test fixtures, and test-only configuration on `sdlc-dev`.
- Keep production changes in commits separate from documentation and test changes.
- Promote only production commits from `sdlc-dev` to `sdlc`.
- Never merge `sdlc-dev` wholesale into `sdlc` or `main`.
- Validate the complete feature on `sdlc-dev` before promoting production commits.
