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

## Known gaps — not covered by this pass

These need dedicated work and manual/assistive-tech testing; lint cannot see any
of them:

1. **Colour contrast (WCAG 1.4.3)** — the token palettes in `src/themes/` have
   never been contrast-audited across the `classic` / dark themes.
2. **Focus-visible coverage** — `focus:outline-none` appears ~760 times in
   `src/`. Most are paired with a `focus-visible:` ring (~700 occurrences), but
   the pairing has never been verified site-by-site. Any unpaired one is a WCAG
   2.4.7 failure.
3. **Dialog focus trap and focus restore** — behaviour is inherited from the
   underlying primitives and has not been tested for restoring focus to the
   trigger on close.
4. **Per-route document title and route-change announcements** — only `ChatView`
   and `NotFoundScreen` set `document.title`; there is no live region announcing
   navigation to screen-reader users (WCAG 2.4.2).
5. **No automated a11y regression gate** — `axe-core` is present transitively
   but is not run by any test. The intended home is a Playwright axe scan per
   top-level route in `tools/xyne-automation`.
