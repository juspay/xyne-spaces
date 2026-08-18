---
name: responsive-accessibility
description: Make Design Studio artifacts responsive, keyboard operable, semantically correct, and readable across common viewport and input conditions.
---

# Responsive and accessible UI

Treat mobile and accessibility as design inputs, not cleanup.

- Start from content behavior: allow wrapping, use fluid widths, set sensible
  max-widths, and avoid fixed heights around text.
- Add breakpoints only where the composition actually fails. Convert multi-
  column layouts into an intentional stacked order on narrow screens.
- Use semantic headings in order, associated labels, button elements for
  actions, links for navigation, and helpful alternative text.
- Ensure every interactive element is reachable and usable by keyboard.
- Include visible `:focus-visible`, hover, active, disabled, and error states.
- Respect `prefers-reduced-motion` and do not rely on hover for essential info.
- Maintain WCAG AA-style contrast for normal text and important controls.

Validate at approximately 1440px, 1024px, 768px, and 390px widths. Check for
horizontal overflow, clipped text, inaccessible menus, and reflow problems.
