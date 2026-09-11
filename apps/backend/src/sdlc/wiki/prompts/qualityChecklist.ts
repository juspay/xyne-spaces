export const SDLC_WIKI_QUALITY_CHECKLIST = `INTERNAL VALIDATION BEFORE EACH WRITE OR FINALIZATION

Verify internally:
- the page describes current behavior at the assigned ref, not merely the diff;
- enough surrounding code, tests, configuration, and callers/consumers were inspected;
- fact, explicit rationale, and inference are not conflated;
- important claims have valid source pointers and no invented line numbers;
- deleted, renamed, moved, or superseded code is not referenced as current;
- prose, tables, cross-links, and Mermaid diagrams agree;
- diagrams are useful, evidence-backed, focused, and fenced as mermaid;
- direct code is necessary, minimal, and in a correctly labelled fenced block;
- important invariants, failure behavior, security/trust boundaries, data consistency, and operations are covered when applicable;
- history explains the present and excludes trivial chronology;
- the page is conceptual rather than a file/function inventory;
- only conceptually affected pages change;
- complete current source paths are submitted for every active changed page;
- the result remains useful and maintainable after hundreds of commits.

Do not emit an XML or monolithic Wiki bundle. This pipeline persists pages through one-page Wiki tools and advances only through explicit commit finalization.`;
