# Xyne Spaces

This glossary defines the canonical language for the repository-scoped SDLC Hub.

## SDLC Hub

**PRD**:
An editable product document describing intent, user needs, and acceptance criteria.
_Avoid_: Requirement, product requirement

**Tech Doc**:
An editable technical design linked to one PRD.
_Avoid_: Blueprint, technical blueprint, workflow

**Ticket**:
An implementation unit on the project's SDLC board, optionally linked to a PRD or Tech Doc.
_Avoid_: Work Order, coder ticket

**Baseline**:
The approved repository knowledge used to ground SDLC work.
_Avoid_: Repository artifact

## SDLC Claw baseline rule

Before changing or rebasing the SDLC/Claw integration, fetch and verify both source branches:

- use latest `origin/main` for the repository generally;
- use latest `origin/feature/deploy-xyneclaw` for `apps/xyne-claw`,
  `apps/xyne-claw-auth`, and `packages/xyne-claw-shared`;
- also sync `packages/kata-sdk/src/filesystem.ts`, the direct Claw streaming compatibility surface;
- never replace those three Claw folders with their `main` versions;
- layer SDLC-specific working changes over the verified Claw snapshot, then run Claw and integration tests.

Current verified Claw baseline: `4d9c2d90dd6b0ad95ed1ae293b0b80fbb62cada8` (2026-08-10).
