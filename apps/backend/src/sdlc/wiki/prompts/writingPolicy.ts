export const SDLC_WIKI_WRITING_POLICY = `INFORMATION ARCHITECTURE

Organize around concepts and systems, not directory names. Adapt to the repository; never create empty template sections. Reserve the Wiki root for a small stable index and true repository-wide pages. Prefer stable conceptual folders such as \`concepts/\`, \`subsystems/\`, \`flows/\`, \`interfaces/\`, \`operations/\`, and \`decisions/\`; deeper nesting is allowed only when it improves navigation. Nested page paths create their simulated Wiki folder hierarchy automatically. Read existing pages before choosing a path so you extend the established taxonomy instead of duplicating it. Useful page families may include Overview, Architecture, Core Concepts, coherent Subsystems, Data Model, Important Flows, Interfaces, Operations, Testing Strategy, Technical Decisions, and Known Constraints/Gotchas.

Keep one coherent topic per page. A subsystem page should include only applicable material: purpose and ownership boundaries; architecture and interactions; main flow; data/state; important components; invariants; failures/retries/fallbacks; decisions/tradeoffs; concise evolution; and best code entry points. The repository overview should identify responsibilities, capabilities, major technologies/dependencies, high-level architecture, main entry points, and stable navigation.

Explain important flows end-to-end: trigger, entry point, validation, business logic, state changes, external calls, emitted events, failure behavior, and result. Prioritize non-obvious behavior that would surprise a competent engineer. When applicable, explicitly document authentication/authorization, identities, credentials, tenant/trust boundaries, validation, authoritative versus derived data, cache semantics, transactions, idempotency, concurrency, locks, ordering, retries, deduplication, eventual consistency, and operational assumptions.

Use tests to establish invariants, expected edge cases, failures, public contracts, and integration boundaries, but document the resulting behavior or testing strategy rather than every test case. Document an external dependency only when it has an architectural role, and explain that role; never turn package-manager inventory into Wiki content. Verify comments and existing documentation against current implementation before preserving their claims.

DIAGRAMS

Use Mermaid only when relationships, ordering, state, topology, or entity structure are materially clearer than prose. Suitable forms are flowchart, sequenceDiagram, stateDiagram-v2, erDiagram, and classDiagram. Put Mermaid source in a fenced Markdown code block whose language is exactly \`mermaid\`:

\`\`\`mermaid
flowchart LR
    API --> Service
    Service --> Store
\`\`\`

Use sequence diagrams when ordering matters and state diagrams for meaningful lifecycles. Every node, participant, state, and edge must be supported by repository evidence. Never complete a visually pleasing diagram with invented architecture. Keep diagrams focused—normally about 5–20 meaningful nodes. Simplify or split an unreadable diagram. Update or remove a diagram when the implementation changes. Do not add decorative diagrams.

Plan diagram lifecycle explicitly. Use \`flowchart\` for system/component topology such as application → collection → storage → visualization; \`sequenceDiagram\` for ordered synchronous or asynchronous interaction; \`stateDiagram-v2\` for entity lifecycle; and \`erDiagram\` for durable entity relationships. A candidate normally needs at least three meaningful nodes and must be materially clearer than prose. Give its section a stable heading and concise purpose, label important edges, and use logical participants/subgraphs. A page with no useful diagram is correct. When relationships are renamed, removed, or superseded, update or remove the existing diagram in the same conceptual section instead of adding a duplicate. Standard validation must flag unsupported edges, stale or unreadably dense diagrams, invalid syntax, decorative diagrams, and contradictions with prose or source evidence.

TABLES, LINKS, AND CODE

Use compact tables for naturally relational information such as component→responsibility→source, endpoint→handler→purpose, event→producer→consumer, configuration→meaning→default, state→transition, dependency→role, or failure→behavior. Avoid long prose inside table cells.

Cross-link related conceptual pages with stable relative Markdown links when the relationship helps navigation. Do not link every sentence. Maintain a stable index when multiple pages exist.

Direct source code is rare. Explain behavior and point to its source instead of copying it. Include code only when exact syntax is necessary—for example a tiny protocol shape, concise configuration, DSL, unusual declaration, subtle algorithm fragment, or very small public API example. Put any included code in a fenced Markdown block with the correct language identifier, keep it minimal, and never paste complete functions merely because they are important.

WRITING QUALITY

Use direct engineering language without praise or marketing. Prefer dense specific explanations over filler. Spend high detail on core domain behavior, workflows, state, persistence, consistency, concurrency, security, distributed behavior, boundaries, unusual constraints, and important decisions; medium detail on supporting components and extension points; low detail on boilerplate, helpers, wrappers, and generated code.

Keep Wiki structure stable across commits. Do not rename or reorganize pages for minor implementation movement. Create a page only for a genuinely coherent new concept; merge concepts only when inseparable; archive only when the concept disappears. Current truth comes first, evolution stays concise, and repeated historical changes are compressed into the current architectural story.`;
