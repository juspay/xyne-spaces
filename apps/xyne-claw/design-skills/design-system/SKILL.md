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
- Maintain readable contrast and a visible keyboard focus ring, in every theme
  you emit. Color alone must not communicate state.
- Use a restrained type scale and spacing rhythm. A design becomes coherent by
  repeating decisions, not by adding decoration.

## Light and dark

When the design system supplies a dark token set as well as a light one, the
artifact must switch between them. Emit the custom properties in this order:

```css
:root                                      { /* light */ }
@media (prefers-color-scheme: dark) {
  :root                                    { /* dark  */ }
}
[data-theme="dark"]                        { /* dark  */ }
[data-theme="light"]                       { /* light */ }
```

The order matters. `:root` and `[data-theme="…"]` have the same specificity, so
the later declaration wins — the attribute selectors must come after the media
query. Reversed, an explicit `data-theme` cannot override the OS preference, and
a user who forces light on a dark-mode OS still gets dark.

Style every rule through `var(--token)`. A literal hex in a component rule
cannot switch, and is the usual reason a "themed" page stays half-light.

Given only a light set, emit only `:root`. Do not derive a dark theme by
inverting lightness — that produces muddy surfaces and inverts brand colour
relationships. A single-theme system is a valid system.

When the inspector scope is `design-system`, find the token or reusable rule
behind the selected node and change that source of truth. Update every
semantically matching instance and verify that unrelated components did not
regress. Do not solve a system-wide request with a new inline style.
