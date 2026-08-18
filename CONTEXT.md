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
**Wiki**:
Editable repository technical memory describing current concepts, flows, decisions, operations, and source evidence.
_Avoid_: Code dump, changelog, imported documentation

**Wiki Run**:
A manually started generation or refresh that advances one repository Wiki through a selected base-branch history.
_Avoid_: Import, sync, scheduled refresh

**History Window**:
A bounded oldest-first commit range compared as one conceptual Wiki update, with immutable before and endpoint refs.
_Avoid_: Agent Chunk, batch

**Commit Checkpoint**:
The durable outcome at a chosen ref inside a History Window. The endpoint is mandatory; meaningful intermediate checkpoints are optional.
_Avoid_: Save point, ledger entry

**Wiki Revision**:
One attributable Wiki Canvas state linked to its checkpoint, History Window, Canvas content hash, Canvas version, and source paths.
_Avoid_: Snapshot
