---
name: Review Changes
description: Review or explain the code changes in a working tree or branch, grouped by severity, with file and line references and an architecture diagram of what the change does.
---

# Reviewing a change set

Use this skill when the user asks for a review of code changes, or asks to be walked through what changed and why.

## Two intents, one gathering step

Read the intent from the user's own words.

- **Critique** — "review this", "what's wrong", "is this safe". Judge the change.
- **Teach** — "explain this", "walk me through", "teach me". Describe the change so someone new can follow it.

The gathering work below is identical for both. Only the write-up differs. When the intent is genuinely unclear, critique, and offer the walkthrough at the end in one line.

## Cover every file, provably

Before reading anything, list the changed files with git. That list, not your memory of the diff, is the scope.

Walk it in order. Every file ends in one of two states, and both are recorded in `coverage`:

- **reviewed** — you read that file's diff.
- **skipped** — you chose not to, with a one-line reason. Legitimate reasons: generated output, a lockfile, a binary, a pure formatting pass, a vendored directory. "Large" is not a reason. "Looked unrelated" is not a reason.

The viewer compares your coverage against the real file list and shows the user precisely which files you left out, so silence is not an option and an omission is not deniable. A large change means working through it in batches, not stopping early.

## Gather before you judge

1. Establish the scope. Uncommitted work, a branch against its base, or a named set of files. Ask only if the answer changes what you read.
2. Read the diff in full. Never review a summary of a diff.
3. Open the surrounding code for anything you intend to criticise. A hunk alone rarely proves a defect.
4. Follow the data. When a value is produced in one file and consumed in another, read both ends. Fields dropped between layers are invisible in a single-file view and are among the most common real defects.
5. Note what is missing: tests for new behaviour, error paths, and callers that were not updated.

## Judging

Rank by what breaks, not by what is easy to spot.

- **Correctness** — wrong output, crash, data loss, a value that silently never arrives.
- **Security and privacy** — credentials, tokens, user data crossing a boundary it should not.
- **Contract** — a caller, schema, or persisted shape that no longer agrees with its other end.
- **Clarity** — naming and structure that will mislead the next reader.
- **Style** — last, and only when it genuinely costs a reader.

Every finding names a file and a line, states the defect in one sentence, and gives a concrete failure: the input or state, and the wrong result. A finding you cannot make concrete is a question, so ask it as a question instead of dressing it as a defect.

Say plainly when the change looks correct. An empty findings list is a real outcome, not a failure to try hard enough.

## Explaining

When teaching, order the walkthrough the way a newcomer should read it, not the order the diff happens to be in. Start with the entry point, follow one path end to end, then cover what branches off it. Say why each piece exists, and name the problem it solves before naming the mechanism. Leave fixes out unless asked.

## Tell the reader how to review

Both the room and the chat reply open by orienting the reader, before any finding:

- What this change is, in one or two sentences, as a change of intent rather than a list of files.
- The reading order: which file to open first and why, then the next. Order by the spine of the change, the entry point first, then what it calls, then the tests. Never alphabetical, never the order git happens to print.
- Where the risk is concentrated, so the reader knows where to slow down.

## Machine-readable comments

Alongside the room, deliver `review-comments.json`:

```json
{
  "summary": "one or two sentences on what the change does",
  "verdict": "merge | do not merge yet | needs a second pair of eyes",
  "order": [{ "file": "path/from/repo/root.ts", "why": "start here, it is the entry point" }],
  "coverage": [
    { "file": "path/from/repo/root.ts", "status": "reviewed" },
    { "file": "pnpm-lock.yaml", "status": "skipped", "note": "lockfile" }
  ],
  "comments": [
    {
      "id": "C1",
      "file": "path/from/repo/root.ts",
      "line": 128,
      "severity": "high",
      "title": "one-line defect",
      "body": "the concrete failure: inputs or state, then the wrong result"
    }
  ]
}
```

Rules that keep it useful:

- `line` is the NEW-side line number, the one on the right of the diff. For a deletion, anchor to the line that replaced it.
- Number comments `C1`, `C2`, `C3` in reading order, and use the same ids in the room so the two line up.
- Every finding in the room has a comment here. Nothing appears here that is not in the room.
- Paths are relative to the repository root, exactly as they appear in the diff.
- `coverage` has exactly one row per changed file, no more and no fewer.

The diff viewer pins these to their lines and gives the user a jump bar, so a bad line number sends the reader to the wrong place. Take the number from the hunk header rather than guessing.

## The review room

The deliverable is one self-contained HTML page named `review-room.html`. Write it to the workspace and deliver it. The chat reply carries the verdict and the two or three findings that matter most; the room carries everything.

Never put the page, or any fenced `html` block, in the chat reply. The chat surface reads a fenced html block as a design revision: it hides your answer and replaces it with "Design updated in preview." Your review is then lost. Write the file, deliver it, and describe it in prose.

The page must hold, in this order:

1. **Header** — what was reviewed, the scope, the file and line counts, and the verdict in one sentence.
2. **Findings** — one card each, ordered most severe first. Severity, one-sentence defect, file and line, the concrete failure, and the relevant diff hunk in a `<pre>`. A finding without a hunk is a finding you have not proved.
3. **Diagrams** — one of the architecture the change touches, plus one per non-trivial finding showing how the failure happens.
4. **What was not covered** — scope you did not read, and why.

Build it as a real page, not a wall of text: dark background, readable measure, severity colour only on the severity chip, a sticky table of contents when there are more than five findings. No frameworks.

Diagrams go in `<pre class="mermaid">` blocks with mermaid loaded from a CDN and initialised with a dark theme. Escape `<`, `>` and `&` inside every code block and hunk, or the page breaks.

Every diagram must be openable at full size, because a sequence diagram inside a side panel is unreadable. After mermaid renders, make each diagram clickable: clicking opens it in a fixed overlay covering the whole viewport, with the SVG scaled to fit and the page behind it dimmed. Escape, a close button, or a click on the backdrop closes it. Inside the overlay, the scroll wheel zooms and dragging pans. Show a small expand affordance on the diagram so it is discoverable.

Use a fixed-position overlay, never the fullscreen API: the page is served inside a sandboxed frame where fullscreen is blocked, so the API silently fails. Render diagrams with `useMaxWidth: false` so they use the width they need rather than being squeezed.

## The diagram

Every diagram, in the room and in chat, follows these rules. In chat, emit a fenced mermaid block and load no library; in the room, use `<pre class="mermaid">` with the CDN script.

- A flowchart when the change moves data across components.
- A sequence diagram when the change alters an ordering, a handshake, or a lifecycle.

Draw only what the change touches, with the surrounding pieces it connects to for orientation. A diagram of the whole system teaches nothing. Label the edges with what actually travels along them.

## Finishing

Lead with the verdict or the one-line summary. Then the findings, most severe first, or the walkthrough. Then the diagram. Do not restate the diff as prose, and do not pad a short review to look thorough.
