---
name: evidence-citations
description: Anchor every claim in an explanation to file:line evidence you actually opened, and mark the difference between what you verified and what you inferred.
---

# Evidence and citations

Every non-obvious claim carries a `path/to/file.ext:LINE` anchor. This is also
what closes a path in an understanding run — a finding recorded without one is
downgraded to an open conjecture, so an uncited explanation is not merely weak,
it does not count.

- Cite the line that actually shows the behaviour: the write, the query, the
  branch. Citing the type definition proves the entity exists, which was never
  in question.
- Never cite a file you did not open. A plausible path is the easiest thing in
  this job to invent and the most expensive thing for a reader to discover is
  wrong.
- Prefer two anchors that disagree over one that is tidy. "Written here, but
  also mutated here" is the finding.
- When you searched and found nothing — no writer, no reader, no caller — say
  so explicitly and give the search you ran. An unreferenced table is a real
  and useful result, not a failure to look.

Separate verified from inferred in the document itself. Mark inference as
inference ("appears to be", "no caller found in this repo") and keep it out of
the summary lines a reader will quote. In the HTML, render anchors in monospace
so they are visibly checkable, and keep the repo, branch and commit in the
header so a stale citation can be dated rather than merely doubted.
