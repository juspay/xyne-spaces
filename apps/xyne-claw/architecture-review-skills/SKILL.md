---
name: hickey-lowy-architecture-review
description: Orchestrate a read-only binocular architecture review with independent Hickey and Löwy lenses over one immutable Git diff.
---

# Hickey–Löwy architecture review

Use this skill only for `/architecture-review`.

## User outcome

The user receives one architecture review of a requested commit range or branch comparison. Hickey and Löwy inspect the same frozen evidence independently. The final report preserves one-lens findings and disagreements instead of forcing consensus.

## Procedure

1. Parse the target from the command arguments. If the target is ambiguous, ask one concise clarification question and stop.
2. Call `sandbox-repo-setup` with `repoName: "xyne-spaces"` and `write: false`. Never request a writable workspace.
3. With bounded, read-only `sandbox-run` commands, resolve and record:
   - repository;
   - full 40-character base SHA;
   - full 40-character head SHA;
   - merge-base when the user named branches or a PR-like comparison;
   - `git diff --stat <base>..<head>`;
   - touched paths and the exact diff.
4. Freeze one review packet. It must include the user intent and the same base SHA, head SHA, exact diff (or an explicitly bounded identical diff with its limitation), touched paths, and context limits.
5. In one assistant turn, call both `hickey-review` and `lowy-review` with the packet copied verbatim. Do not let either reviewer see the other's output. Do not ask one to synthesize the other.
6. When both return, verify each cited path/range against the frozen head with read-only commands. Drop or mark unsupported claims; never repair evidence by inventing a citation.
7. Synthesize. Exact duplicate mechanisms supported by both lenses may become `binocular`. Keep distinct mechanisms separate even when titles sound similar. Preserve disagreements and all material one-lens findings.

## Read-only boundary

Allowed repository commands are inspection only: `git diff`, `git show`, `git log`, `git status`, `git merge-base`, `git rev-parse`, `sed`, `cat`, `grep`, `find`, and `ls`.

Do not edit files. Do not run package managers, repository scripts, builds, tests, generators, hooks, formatters, or any Git mutation. Do not use output redirection. If inspection needs execution beyond this allowlist, state the limitation in the report.

## Failure semantics

- If target resolution or the immutable packet fails, do not run reviewers. Return an incomplete review with the reason.
- If one reviewer fails, return the successful raw review under a prominent `PARTIAL — one lens failed` status. Do not call it binocular or complete.
- If synthesis fails, preserve both raw reviews and label synthesis incomplete.
- A timeout, malformed output, or unverifiable evidence is visible; it is never silently discarded.

## Final report

Use these sections:

1. `# Architecture review: <target>`
2. `Status` — COMPLETE or PARTIAL/INCOMPLETE, with reviewer completion states
3. `Immutable target` — repository, base SHA, head SHA, diff summary
4. `Recommendation` — concise decision and user/operator consequence
5. `Binocular findings`
6. `Hickey-only findings`
7. `Löwy-only findings`
8. `Disagreements and unresolved questions`
9. `Ordered actions`
10. `Evidence and limitations`

For each finding include severity, concrete consequence, evidence as `path:start-end`, recommendation, lens, and confidence. If a section is empty, say `None` rather than omitting it.
