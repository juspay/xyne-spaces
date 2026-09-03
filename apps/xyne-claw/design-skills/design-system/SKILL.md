---
name: design-system
description: Create or modify coherent visual tokens and reusable component rules for color, typography, spacing, radius, elevation, controls, and interaction states.
---

# Design system

Build a small system before styling individual nodes.

- Put shared values in CSS custom properties under `:root`: semantic colors,
  type scale, spacing, radii, shadows, borders, and motion durations.
- Name tokens by purpose (`--surface-raised`, `--text-muted`, `--space-3`), not
  by a one-off component or raw color.
- Define reusable classes for repeated patterns such as buttons, fields, cards,
  navigation items, badges, and overlays. Keep state styles adjacent to their
  base component.
- Maintain readable contrast and a visible keyboard focus ring. Color alone
  must not communicate state.
- Use a restrained type scale and spacing rhythm. A design becomes coherent by
  repeating decisions, not by adding decoration.

When the inspector scope is `design-system`, find the token or reusable rule
behind the selected node and change that source of truth. Update every
semantically matching instance and verify that unrelated components did not
regress. Do not solve a system-wide request with a new inline style.
