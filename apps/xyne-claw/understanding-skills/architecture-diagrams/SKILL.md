---
name: architecture-diagrams
description: Author architecture, ER, and flow diagrams as hand-written inline SVG inside a self-contained HTML page — no mermaid, no scripts, no CDN.
---

# Architecture diagrams

Diagrams are hand-authored **inline SVG** in the page itself. Do not reach for
mermaid or any diagram library: the artifact is a single file that must render
with no network and no JavaScript, and script-based renderers are stripped or
silently blank.

Diagram the FLOWS, not just the system. One overview diagram is not enough for
anything real: each end-to-end path in the document's flows section earns its
own figure — "a message becomes a desktop notification", "…a mobile push",
"…a Slack fallback" are three flows and three diagrams, not one box-and-line
sketch that tries to hold all of them. A document explaining a multi-path system
with a single diagram under-drew it. Put each flow's diagram immediately beside
the numbered walk it illustrates, so a reader sees the path and its picture
together.

Pick the diagram by the relationship, and draw at most one idea per figure:

- Components and who talks to whom: boxes + arrows, direction shown by an
  arrowhead `<marker>` in `<defs>`, reused by every path.
- Tables and keys: ER style — a `<rect>` per table with its key columns as
  `<text>` lines, edges labelled with the FK column.
- A request or lifecycle: left-to-right stages with the actor above the line and
  the artifact it produces below.
- Anything with more than ~12 nodes: split it, or drop to a table. A diagram
  nobody can follow is worse than the paragraph it replaced.

Build every figure as `<figure>` + `<figcaption>` stating the takeaway, and give
the `<svg>` a `viewBox` with `width="100%"` and `height="auto"` so it scales.
Set `role="img"` and a `<title>` so it is not invisible to a screen reader.
Colour encodes system or ownership, never severity alone; put the mapping in a
small key beside the figure, and keep labels in a monospace stack so identifiers
read as identifiers.

Style with a `<style>` block and CSS custom properties in `<head>`. Use a system
font stack — a CDN font link makes the file dependent on the network it was
supposed to survive without.
