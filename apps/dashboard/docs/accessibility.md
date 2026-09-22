# Dashboard accessibility

Scope: `apps/dashboard` (web). The mobile app is tracked separately.

Target: **WCAG 2.1 Level AA**.

## Where we actually are

`eslint-plugin-jsx-a11y` is wired into `eslint.config.js` at its `recommended`
severity (all `error`). Measured against that rule set, `src/**/*.tsx` reports
**zero** violations — with one exception that was hidden rather than fixed:

| Rule                             | State before                                                                                                                                            | State now                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `jsx-a11y/no-autofocus`          | `"off"` repo-wide — ~110 `autoFocus` usages unreviewed, and the 10 `// eslint-disable-line jsx-a11y/no-autofocus` comments in the tree were dead no-ops | `"warn"` — new usages are visible in `pnpm lint`, existing ones do not block the build |
| everything else in `recommended` | clean                                                                                                                                                   | clean                                                                                  |

The remaining inline `jsx-a11y` disables (`no-static-element-interactions`,
`no-noninteractive-tabindex`, `no-noninteractive-element-interactions`,
`click-events-have-key-events`, `media-has-caption`) were reviewed one by one.
They are legitimate: each site already carries an appropriate `role`,
`aria-label` and, where interaction is real, a keyboard handler — for example
the drag handles in `NoteTakerOverlay` / `RecordingCameraBubble`, and the
scrollable `role="region"` / `role="log"` containers that must be focusable to
be keyboard-scrollable (WCAG 2.1.1). Leave them; do not "fix" them by removing
the role or the tabindex.

## The `autoFocus` policy

Allowed:

- a dialog, popover, combobox, command menu or inline editor that the user
  **just opened by an explicit action** — moving focus into it is the expected
  behaviour and is what keeps the interaction keyboard-reachable.

Not allowed:

- a field that takes focus because a **screen or route rendered**. That steals
  focus from wherever the user was, moves the screen-reader cursor without the
  user asking, and fails WCAG 3.2.1 (On Focus).
- autofocus on mobile viewports, which forces the on-screen keyboard open.
  `ChatInput` already guards this with `isMobile`.

When you add `autoFocus`, suppress the warning at the call site with a one-line
reason:

```tsx
// eslint-disable-next-line jsx-a11y/no-autofocus -- dialog the user just opened
```

## Bypass blocks

Every app screen renders `AppSidebar` before the route content. `AppRoot` now
renders `<SkipToMainContent />` as the first focusable element of both sidebar
layouts, targeting `<main id="main-content" tabIndex={-1}>` (WCAG 2.4.1).

`MAIN_CONTENT_ID` is exported from
`src/components/SkipToMainContent/SkipToMainContent.tsx` — use it rather than
hardcoding the string, and give any **new top-level app shell** the same `id` +
`tabIndex={-1}` + a `<SkipToMainContent />` so the bypass keeps working.

Note the skip control is a `<button>`, not an `<a href="#main-content">`:
`App.tsx` installs a document-level click handler that routes every same-origin
anchor through React Router, so a hash anchor would navigate instead of moving
focus.

## Zoom

`index.html` must not pin `maximum-scale` or set `user-scalable=no` — that
blocks pinch-zoom and fails WCAG 1.4.4 (Resize Text, AA).

## Keyboard focus is visible everywhere (WCAG 2.4.7, AA)

Measured before the fix: **619** class strings in `src/` contain `outline-none`
and only **142** of them paint a `focus-visible:` ring of their own. The other
**477** left a keyboard user with no indication of where they were.

Two changes fix this at the root rather than site by site:

1. `global.css` ends with an **unlayered** `:focus-visible` rule that paints a
   2px outline. Unlayered rules beat anything in `@layer utilities`, which is
   where Tailwind's `focus:outline-none` lives — so a utility class can no
   longer silently remove the focus indicator. `:focus-visible` (not `:focus`)
   means pointer users see nothing change.
2. A new `--focus-ring` token per theme. The existing `--ring` token measures
   **1.65:1** against `--background` in the light themes — it is a decorative
   hairline, not a focus indicator, and fails WCAG 1.4.11 (3:1). `--focus-ring`
   tracks `--foreground`, so it is guaranteed to pass in every theme.

If a component has a better indicator of its own, opt it out with
`data-focus-ring="custom"` — do not reach for `!important`, and only do it when
the replacement itself clears 3:1 against its background.

## Screen readers are told when the route changes (WCAG 4.1.3, AA)

The browser announces a page load; a SPA route swap is silent, so a blind user
activating a nav item got no confirmation anything happened. `RouteAnnouncer`
(rendered in `AppRoot` next to the skip link) is a visually hidden
`aria-live="polite"` region that announces the new `document.title` after each
navigation, two animation frames later so the route's own effects have set it
first.

This only works as well as the titles are. Today only `ChatView` and
`NotFoundScreen` set `document.title`; every other screen announces "Xyne
Spaces". **Giving each top-level screen a real title is the highest-value
follow-up in this document** — see the gaps below.

## Colour contrast (WCAG 1.4.3 / 1.4.11, AA)

`pnpm run a11y:contrast` audits the theme tokens in `global.css` with no
dependencies and no browser. It cannot see a hardcoded colour inside a
component, only the tokens — but the tokens are where the systemic failures are.
Run it after any token change; `--strict` makes it exit non-zero.

Measured today — **19 failures**, the same pattern in `classic` and
`summer_breeze`, fewer in `midnight`:

| Pair                                          | Ratio  | Needs | Impact                                                                                             |
| --------------------------------------------- | ------ | ----- | -------------------------------------------------------------------------------------------------- |
| `--primary-foreground` on `--primary`         | 2.77:1 | 4.5:1 | White text on the coral brand colour. Every primary button label in the product, all three themes. |
| `--destructive-foreground` on `--destructive` | 3.61:1 | 4.5:1 | Destructive/confirm buttons.                                                                       |
| `--warning-foreground` on `--warning`         | 3.16:1 | 4.5:1 | Warning labels (light themes).                                                                     |
| `--muted-foreground` on `--muted`             | 4.40:1 | 4.5:1 | Secondary text on muted fills — marginal.                                                          |
| `--border` / `--input` on `--background`      | 1.27:1 | 3:1   | Input outlines and component borders are effectively invisible to a low-vision user.               |
| `--ring` on `--background`                    | 1.65:1 | 3:1   | Superseded by `--focus-ring` above; `--ring` should stop being used as a focus colour.             |

These are **not fixed here**. Changing the brand coral or the destructive red is
a design decision, not an engineering one — the audit exists so the decision is
made with numbers. The usual resolution for a brand colour that fails with white
text is a darker shade reserved for filled controls.

## Known gaps — not covered by this pass

These need dedicated work and manual / assistive-tech testing. Ordered by how
much they affect a real user, most first.

1. **Per-screen `document.title` (WCAG 2.4.2, A).** Only two screens set one.
   Until every top-level screen does, the route announcer above says "Xyne
   Spaces" on every navigation. Small, mechanical, high payoff.
2. **Contrast token decisions (1.4.3 / 1.4.11, AA).** The 19 failures measured
   above need design sign-off, then `pnpm run a11y:contrast --strict` can be
   wired into pre-commit so they cannot come back.
3. **Dialog focus trap and focus restore (2.1.2, 2.4.3).** Behaviour is
   inherited from the underlying primitives and has never been tested: does Tab
   cycle inside an open dialog, and does closing it return focus to the trigger?
   Needs a real test per primitive in `src/components/ui/`.
4. **Keyboard reachability of hover-only affordances (2.1.1).** Message actions,
   ticket-card controls and similar reveal on `group-hover`. Several already
   pair it with `group-focus-within`, but this has never been audited across the
   product — any that do not are keyboard-unreachable.
5. **Automated axe gate.** `axe-core` is present transitively but no test runs
   it. The intended home is a Playwright axe scan per top-level route in
   `tools/xyne-automation`, which already has the auth bootstrap for driving
   real screens.
6. **Screen-reader passes.** NVDA/Windows and VoiceOver/macOS walkthroughs of
   the three or four core flows. No amount of static analysis substitutes for
   this, and nothing in this document should be read as a claim of conformance
   until it has been done.

## Conformance status

Not conformant. This is a foundation, not a certification. The automated layer
(`pnpm lint`, `pnpm run a11y:contrast`) covers a minority of the WCAG 2.1 AA
success criteria; the rest need the manual work listed above.
