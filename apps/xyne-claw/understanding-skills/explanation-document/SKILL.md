---
name: explanation-document
description: Structure a codebase/schema explanation as a self-contained HTML document ordered for a READER — mental model and flows first, deep per-component reference last — not in the order you explored it.
---

# Explanation document

The deliverable is ONE self-contained `.html` file written in the sandbox and
sent with `sandbox-deliver-files`. Not chat prose, not a ledger dump.

## One document, stable name, survives a sandbox recycle

Give the document a single stable filename and reuse it for the whole run —
`<topic>-explained.html`, never `epoch1.html`, `epoch2.html`, `…-final-v3.html`.
Every pass EXTENDS that one file. A pile of per-pass fragments cannot be merged
later: sandboxes are ephemeral and the earlier ones are gone.

Because the sandbox recycles, treat a missing file as "fresh machine, not blank
slate": if your canonical `.html` is not on local disk when you start, you were
moved to a new sandbox — recover the last version you delivered
(`spaces-thread-attachments` to locate it, `spaces-fetch-attachment` to pull it
back) and extend that, rather than starting over or shipping a stub. Re-deliver
the same filename each time so the newest upload is always the whole document.

## Order it for the reader, not for yourself

You will DISCOVER the system component by component, in whatever order the code
led you. Do NOT ship it in that order. A reader needs to build a mental model
before any detail lands, and the detail has to get progressively deeper — an
appended list of "here's the next file I opened" is an exploration log, not an
explanation. Before delivering, reorganise into this shape, top to bottom:

1. **TL;DR** — 3–5 sentences: what the system is, its one job, and the single
   most important thing to know. A reader who stops here is not lost.
2. **Mental model** — the handful of concepts and the vocabulary. Name the
   actors and the nouns before using them.
3. **End-to-end flows** — the 2–4 paths that actually matter (e.g. "a message
   becomes a desktop notification", "…a mobile push", "…a Slack fallback"),
   each as a numbered walk from trigger to outcome, WITH A DIAGRAM. This is the
   part a reader returns to most; make it the strongest part.
4. **Per-component detail** — grouped by role, not one section per file.
   Cluster (`gateway_*`, producers vs filters vs channels, config vs routing vs
   audit); a flat run of 20+ sections is the inventory this format exists to
   avoid. Each group explains what the flows glossed over.
5. **Deep reference / appendix** — the exhaustive material: per-table field
   notes, payload budgets, queue config, error-code maps, dead-code findings.
   A reader consults this; they do not read it linearly. It belongs at the END,
   never interleaved with the conceptual sections above.
6. **Lookup table** — every entity, one line each, so the document doubles as a
   reference after the first read.

Depth increases as you go down. If a detail is only needed to act on one
specific component, it lives in §5, not §3 or §4.

## Do a consolidation pass before you deliver

Building the document incrementally as paths close is correct — it protects a
capped run. But an incrementally-built document is in discovery order and will
have drifted: out-of-sequence section numbers, the same fact stated twice in
two sections, deep detail sitting above the overview. The LAST thing you do
before `sandbox-deliver-files` is a single pass that:

- reorders sections into the reading order above and renumbers them
   contiguously (a document that jumps 8 → 10 → 22 → 15 was never reorganised);
- merges duplicated explanations and moves stray deep detail down into §5;
- verifies every internal reference and the table of contents still resolve.

## What to record per component

What a reader cannot get from the name: who writes it, who reads it, the
key/uniqueness, the scoping (merchant vs tenant vs reseller), what breaks if it
is wrong, and one concrete example. A sentence that only restates the name
("`gateway_card_info` stores gateway card info") is padding — delete it.

State what you could not determine. An honest gap is information; a confident
guess is a defect a reader inherits.
