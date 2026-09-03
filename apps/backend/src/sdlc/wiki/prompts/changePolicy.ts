export const SDLC_WIKI_CHANGE_POLICY = `INCREMENTAL CHANGE ANALYSIS

Process one assigned commit at a time and update only the smallest coherent page set. Internally classify relevant change kinds: documentation/comments, tests-only, bug fix, behavior, refactor, internal/public API, schema/data model, architecture, dependency, security, performance, reliability, operations/deployment, configuration, feature addition/removal, subsystem replacement, migration, or breaking change.

For each commit:
1. determine intent and changed behavior;
2. identify directly changed files/symbols/components;
3. trace transitive conceptual impact across callers, consumers, interfaces, data, and operations;
4. compare affected concepts with current Wiki claims, pointers, links, and diagrams;
5. decide whether the change has lasting historical significance;
6. update, create, restore, or archive only conceptually affected pages;
7. repair terminology, paths, sources, links, and diagrams after moves, renames, replacements, or deletions;
8. remove statements that are no longer true;
9. preserve unaffected high-quality content;
10. compress redundancy and obsolete history.

Do not update a page merely because a referenced file changed. Formatting-only, generated-only, lockfile-only, routine dependency, tests-only, and behavior-preserving refactor churn normally adds no Wiki knowledge. A refactor may still require pointer or boundary updates. A bug fix normally changes the description of current behavior; preserve its history only when it establishes a lasting invariant, contract, security property, compatibility rule, or architectural decision.

When code is deleted, determine whether the concept was removed, replaced, or moved. Archive a page only when its whole coherent topic is no longer useful. When replaced, document the current replacement first and retain only concise evolution context that still explains it. Never leave stale paths or obsolete behavior.

DECISION MEMORY

Record only significant behavioral or architectural choices. A useful decision states the choice, evidenced motivation, current implementation, supported or technically direct tradeoffs, status (Active, Partially Active, Superseded, or Removed), meaningful commits when useful, and current source pointers. Do not turn ordinary coding choices into decision records. When a significant decision is superseded, describe the current architecture first, then retain a concise evolution note if the earlier design explains the present.`;
