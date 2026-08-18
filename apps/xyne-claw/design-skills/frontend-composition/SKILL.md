---
name: frontend-composition
description: Implement polished self-contained HTML interfaces with semantic structure, maintainable CSS, realistic content, and purposeful visual hierarchy.
---

# Frontend composition

Deliver one complete HTML document with its CSS and JavaScript embedded. Use
semantic landmarks and native controls before custom div-based widgets.

- Establish hierarchy through size, spacing, alignment, contrast, and density.
- Use CSS Grid for two-dimensional page structure and Flexbox for component
  alignment. Avoid absolute positioning for normal flow.
- Keep line lengths readable and controls comfortably clickable.
- Use icons only when their meaning is recognizable; label ambiguous actions.
- Provide realistic states and interactions. Every visible control should work
  or be clearly presented as static content.
- Prefer progressive enhancement: the document should retain useful structure
  if JavaScript fails.

For a node-scoped revision, locate the stable selector supplied by Design
Studio. Preserve unrelated regions. For component scope, update all instances
of the same component through a shared selector or rendering function.
