# Chat v3 — Code Review #2

**Reviewed:** branch `fix/chat-v3` at `d6f2632` + working tree · **Date:** 2026-08-25
**Against:** [`chat-v3-design.md`](./chat-v3-design.md) · [`chat-v3-implementation-plan.md`](./chat-v3-implementation-plan.md) · [`chat-v3-visual-parity.md`](./chat-v3-visual-parity.md)
**Supersedes:** Review #1 (2026-08-23). Its findings F1–F8 are re-verified in §1.
**Question asked:** is this the cleanest, most scalable, bug-free chat we can ship — and what is stopping it?

**Verdict.** The architecture is right and the prior review's structural wins still hold (one reducer with
`assertNever`, pure policy layers, 421 logic tests, no message data in component state, no v2 imports,
flag used only at the route edge). But the branch is **red on every mechanical gate** (types, lint,
tests), and the deep read found **three real user-facing bugs** — one of which makes Forward / Remind me /
Edit unreachable from the actions sheet — plus a set of spec/implementation divergences where the code
quietly walked away from the design doc without the doc being updated. Fix §2 first; everything in §3 is
what separates "works" from "best".

Every claim below was verified by reading the cited lines or by execution. One candidate blocker
("all thread rows share one LegendList key") was **refuted** during verification — see §6.

---

## Status update — 2026-08-25, after `b2361ba`

Sections 0–4 below are the review as written against `d6f2632`. They are kept as the record; this
section is the current truth.

**Gates:** `tsc --noEmit` (v3) clean · `eslint src/features/chat/v3` clean · `test:chat-v3` 478 / 478.

**Closed in code (verified at HEAD + working tree):** B1, B2, B3, B4; M1, M2, M4, M5, M7, M8, M9,
M10, M11, M13, M16, M17; minor items: identical `MessageRow` ternary, `live-error` failure reason,
`jumpedToTail` scroll-mode event, `useHeightViolation` reset on `dataKey`, `awaitKeyboardHidden`
dismiss `.catch`, `onAction` async `.catch`, `ReminderOptionsHost` keyed per target,
`useRememberLastOpenChannel` shared by both screens, `ConversationList` seven-prop contract asserted
by test.

**Closed in this pass (uncommitted):**
- `machine/revealPolicy.ts` — the nine v2 characterisation helpers (`classifyWarmCase`,
  `shouldBlockReveal`, `isTargetCached`, `shouldKeepSeededTailWindow`, `isAwaitingPlacementConfirm`,
  `shouldShowMissingAnchor`, `selectOpeningWindow`, `canReveal`, local `isAuthoritativeFor`) are
  deleted. Their 43 test cases were re-expressed against the reducer/selectors per design §7: 6 were
  duplicates of existing reducer tests and were dropped, 19 were rewritten with their v2 names kept,
  the rest already targeted v3. No v2 case was inexpressible against the union.
- `ListMetrics.didUserScroll` removed (only producer hard-coded `false`; ownership is the
  `userTookOwnership` action). `EMPTY_METRICS` moved out of production into the test.
- `scheduling/deferral.ts` — `releaseDeferralOnTeardown` (always-true wrapper) deleted; the teardown
  cleanup calls `token.release()`.
- `composer/chatKeyboardConfig.ts` — the `embedded` inset mode, `getChatComposerBottomPadding`,
  `includesChatComposerBottomSafeArea` and three padding constants with no v3 consumer deleted;
  `getChatKeyboardGeometry(bottomInset)` is now single-argument.

**Still open — decisions, not defects:**
- **M3 `resolving` stage.** `intent/resolveSurface.ts` and the `fail` action have no production
  caller, so `not-found` / `no-access` / `offline-cold` are unreachable and a bad channel id ends in
  a 6 s `timeout` instead of an immediate error. Wire it (better UX) or delete it and amend §5.3 to
  say surface resolution is router-level. Recommendation: wire — it is the only path to a fast,
  honest "not found".
- **M6** height computed vs measured — amend §6.3 to the estimate + measure + `useHeightViolation`
  model the code actually implements, or make `getFixedItemSize` real for message rows.
- **M12** `anchoredEndSpace` — amend §6.2 / B8 to record why it was dropped.
- **M14** deferral token's `defer()` has no callers; Phase 8 decides which named work uses it.
- **§12.1 / C14 contradiction** (from the book audit below): the offline matrix
  (`machine/offlineMatrix.ts`) can never run because C14 forbids reading connectivity and no stage
  timeout resolves to `offline-cold`. Either narrow C14 to sends (its B4 origin) and let one owner
  publish an offline fact for the read path, or retire §12.1 and delete `offlineMatrix.ts`.

### Book audit — *Building Mobile Apps at Scale*, read cover to cover against v3

Design §12 already maps 14 chapters correctly and the code honours them (single owner state, id-first
idempotent sends, `key={intentKey}` reset on deep link, push = deep link, intentKey guard on late
callbacks, schema-guarded cache, flag owner/expiry). What the book adds that §12 does **not** cover,
with the code verdict:

| Rule (chapter, page) | Verdict | Where |
|---|---|---|
| Ch. 3/29 — server-supplied content renders a degraded fallback, never throws; `assertNever` only on locally built unions | ✅ but untested | `FlowJsonMessageBody.tsx:281` falls through to markdown; all 8 `assertNever` sites are local. Add one test with an invented `component.type`. |
| Ch. 8 — every interactive element has role + label | ❌ | `rows/MessageRow.tsx:99` (the long-press target) and `SystemMessageRow.tsx:21` have neither. 43 other sites are labelled. |
| Ch. 8/15 — row-height estimate is a function of `fontScale` and script width | ❌ | `measureRowHeight.ts:14-34` is pixel constants + `AVG_CHAR_WIDTH = 8.8`; no `fontScale`/`PixelRatio` anywhere in v3. At 200 % text or CJK content every estimate lands short → G4 height violations. |
| Ch. 15 — locale-correct time | ❌ | `buildRows.ts:16-22` hard-codes 12-hour `AM/PM`; `ForwardedBanner.tsx:14` pins `'en-US'`. `reminder.ts` / `ReminderOptionsHost` already do it right (`undefined` locale). |
| Ch. 6/14/32/33 — "measured" must mean wired | ❌ | `openTrace.recordInbound`, `summarizeOpenTrace`, and all of `warmTelemetry.ts` have zero production callers; `useChatOpen.ts` hard-codes `isBetaUser: false` so the beta sampling cohort can never exist. `chatScreens.test.ts:132-135` only asserts the modules contain their own function names — Pinterest's "metrics wrong for months" failure mode, verbatim. Define the four chat business events (open ok / send ok / send fail / jump landed), wire them, and make the test assert the *call site*. |
| Ch. 36 — no PII in bug-report payloads | ⚠ | `OpenTrace.raw` copies every route param verbatim (`searchParams.ts:3-12`) and `summarizeOpenTrace` JSON-stringifies it. Nothing sensitive flows today; add an allowlist before the trace is ever exported. |
| Ch. 2 — server-side revert | ◐ | `flag.ts:10-13` already states the Phase-10 gate; carry that sentence into §3.2, which still reads as if local-only is the end state. |

Recommended §12 additions: (1) forward-compatible rendering rule + test; (2) accessibility as a
release gate (labels automatable per p. 29; retrofitting is the expensive path per p. 28);
(3) locale time + script-aware height; (4) a named chat business-event set with call-site tests;
(5) PII allowlist on the trace; (6) "an observability module with zero production call sites fails
the build".

---

## 0. Gates — measured now

| Gate | Result | Detail |
|---|---|---|
| `npx tsc --noEmit` | ❌ | 2 production errors in v3 (`rows/parts/useFlowMessageAction.ts:42`, `screens/ChatConversation.tsx:145`, both `exactOptionalPropertyTypes`); `__tests__/openPathLanding.test.ts` ×7 (`target` not narrowed); `tests/unit/features/chat/v3/landing-render.test.tsx` + `list-chrome.test.tsx` — `onReactionsPress` is now required on `ConversationListProps` and no render test was updated |
| `npx eslint src/features/chat/v3` | ❌ | `rows/parts/FlowJsonRenderer.tsx` 472 lines (hard cap 400, **no written exemption**); `model/text/htmlInlineToMarkdown.ts:134` `no-useless-escape` |
| `npm run test:chat-v3` | ❌ 418 / 421 | `buildRows flow-json` (fixture lacks `version: "2.0"` — `src/utils/flowJsonMarkdown.ts:93` requires it; buildRows is correct); `overlayHosts mention/link` (asserts `onLinkPress` in `MessageRowBody.tsx`, moved to `BlockMarkdown.tsx:34` in `1e92b97` — stale test); one suite-level rollup |
| Flag discipline | ✅ | `isChatV3Enabled` only in the three route entries, Settings, `TicketDetailsScreen`, `flag.ts` |
| v2 imports inside `v3/` | ✅ | none (production) |
| C16 purity | ✅ | `intent/`, `machine/`, `model/` import no React / RN |
| File budget | ⚠ | only `FlowJsonRenderer.tsx` over; `openReducer.ts` now 313 raw lines |

The same pattern as Review #1: **green-looking tests, red types**. `tsc --noEmit` and `eslint` must be in
the definition of done for every v3 commit. Suggest a `test:chat-v3` pre-step:
`tsc --noEmit -p . && eslint src/features/chat/v3`.

---

## 1. Status of Review #1 findings

| # | Finding | Status |
|---|---|---|
| F1 | `isValidElement` not imported | ✅ fixed |
| F1a | child-introspection pattern should go | ❌ **not fixed** — moved to `list/conversationListHelpers.tsx:44-49` as `cloneElement` (see B3) |
| F2 | no component tests | ◐ partial — `tests/unit/features/chat/v3/*.tsx` exist but are stale (tsc red) |
| F3 | v2 freeze broken | ◐ v2 edits were committed as sanctioned token moves; no written rule in the plan yet |
| F4 | `markdownStyle.ts` RN import | ✅ rewritten without RN |
| F5 | `openReducer.ts` at budget | ⚠ 313 lines — still under ESLint's skip-blank/comments count, but growing |
| F6 | `useChatOpen` effects | ✅ down to 155 lines; effects audited below (M1, M2) |
| F7 | server-side kill switch | ⏳ Phase 10 gate, unchanged |
| F8 | tests not in CI | ✅ `npm test` now runs `test:chat-v3` |

---

## 2. Blockers — user-facing bugs, fix before anything else

### B1 — Forward / Remind me / Edit-in-chat can never open from the actions sheet
`overlays/MessageActionsHost.tsx:277-295` · `screens/ChatOverlays.tsx:67-101`
`ActionRow.onPress` calls `onAction(id)` **and then** `close()`. For `forward-message`, `onAction` →
`onChange({ ...state, actions: null, forward: state.actions })`; then `close()` →
`onChange({ ...state, actions: null })`. Both spread the same render-time `state`, and `setOverlays` is a
plain value setter, so the second write wins and `forward` is `null` again. Identical for `remind-me` and
`edit-in-chat`. `onMoreReactions` only survives because `QuickReactionsRail` calls `close()` *before* the
handler (`:241-244`).
**Fix:** make overlay state a reducer (`transition(action)`) or a functional updater, and remove the
unconditional `close()` for ids whose handler already transitions. Then make the state a union
(`{ kind: 'actions' | 'forward' | 'remind' | 'reactions' | 'profile' | 'emoji'; target } | null`) with
`editing` split out — that makes B1 and M17 unrepresentable (C8).

### B2 — Grouping changes never repaint: `rowsAreEqual` ignores `showAvatar` / `showSenderName`
`model/rowEquals.ts:8-15` (used as the `ChatListRow` memo comparator `rows/ChatListRow.tsx:49-51` **and**
LegendList `itemsAreEqual` `list/legendListProps.ts:97`). `reuseUnchanged` (`model/buildRows.ts:192-195`)
correctly emits a new row when a grouping flag flips, then both equality layers say "unchanged".
**Scenario:** Ada sends A (trailing, avatar on). Ada sends B. A should lose its avatar; the cell never
re-renders → two avatars in one group. Same for the sender-name label when an older page loads above.
**Fix:** compare `showAvatar` and `showSenderName` in the message branch; share one predicate with
`reuseUnchanged` so the two cannot drift.

### B3 — `cloneElement` child-introspection is back, and it can drop a send
`list/conversationListHelpers.tsx:44-49` matches `child.type === ChatComposerDock` and clones it with
`{ composerRef, onComposerLayout, onSend: onMeasuredSend }`. `onMeasuredSend` calls `onDockSend?.()`.
- Dock wrapped in a memo/provider → falls to the `<View>` branch → send-scroll silently lost (B8).
- Caller passes `<ChatComposerDock onSend={x}>` without `onDockSend` → the clone overrides `onSend`,
  `onDockSend` is undefined → **tap send, nothing sent, list scrolls**.
`composerSendPath.test.ts:82` asserts `cloneElement` is present — the test locks the anti-pattern in.
**Fix:** `ConversationList` renders the dock itself from a `composer` config prop (or the dock gets
`scrollToEnd` from a tiny context). Delete `bindMeasuredChild`; make the send handler one explicit prop.

### B4 — Repo health (see §0)
Fix the two production tsc errors, update the render tests for `onReactionsPress`, narrow `state` in
`openPathLanding.test.ts`, add `version: "2.0"` to the flow-json fixture, repoint the `onLinkPress`
assertion at `BlockMarkdown.tsx`, fix the escape, and split `FlowJsonRenderer.tsx` (it has no exemption
and is 72 lines over the hard cap).

---

## 3. Major — correctness and spec divergence

### Open lifecycle (machine / `useChatOpen`)

**M1 — Retry is starved of facts; every retry becomes a 6 s `timeout` error.**
`screens/useChatOpen.ts:114-123`. `factsSeen.current` resets only on landing-key change (`:98`), never
when leaving `error`. `useDataFacts` returns the same reference for the same boolean vector
(`data/useDataFacts.ts:28-32`), so after `retry` → `loading` no `dataFactsChanged` is dispatched;
the machine waits for `tick` at +6000 ms → `error{timeout, loading}`. Fix: clear `factsSeen` on
`retry` (or on any transition out of `error`).

**M2 — Same-surface landing change while `loading`/`placing` is silently dropped.**
`useChatOpen.ts:95-113`. `reanchor` only fires when `status === 'ready'`; otherwise only
`surfaceResolved` is dispatched, `lockedTarget` (`openReducer.ts:33-36`) keeps the old target, and
`syncedLandingKey` is advanced so the change is never revisited. Notification A then B in the same
channel 300 ms apart → lands on A, no log. The reducer honours I11 correctly; the *carry* is missing.
Fix: keep the latest landing key in a ref and dispatch `reanchor` on the `→ ready` transition when
it differs (or add `pendingTarget` to the `loading`/`placing` states). Record the choice in §5.2.

**M3 — `fail` is never dispatched and `intent/resolveSurface.ts` has no production caller.**
`machine/openActions.ts:17`, `resolveSurface.ts:43,86,137`. `not-found` / `no-access` /
`offline-cold` are unreachable at runtime; `resolving` exits on the first facts regardless of surface
resolution (which actually happens router-side in `useThreadSurfaceGate` / `useResolveOpenCursor`,
with no budget). Either wire `surfaceNeedsResolution` to hold `resolving` and dispatch
`surfaceResolved`/`fail` from a keyed resolver effect, **or** delete `resolveSurface.ts`, `fail`, the
three reasons, and amend §5.3 to say resolution is router-level. Don't leave it half-wired.

**M4 — Re-anchor between two targets of the same kind can never be confirmed.**
`list/useLandingMetrics.ts:39-44` dedupes on `${dataKey}:${target.kind}:${placed}:${dividerPlaced}` —
no target identity. After `reanchor` (anchor → anchor), the first good placement has the same
signature as the previous landing and is suppressed → `placing` exits only via the 1 500 ms forced
reveal. Fix: include `messageId ?? conversationId:createdAt` (or reanchor `startedAt`) in the signature.

### Row model / paint

**M5 — `contentSignature` omits fields that paint, so live updates are swallowed by `reuseUnchanged`.**
`model/buildRows.ts:80-88` covers conversationId, body, reactions, isDeleted, attachment count,
parent id. Missing: `replyCount`/`latestReplierIds` (height-affecting), `isPinned`/`isBookmarked`/
`isEdited` (directly contradicts `useChatRows.ts:32-33`, which keeps `isEntityBookmarked` in deps
"so bookmark toggles still repaint" — the rebuild runs, then `reuseUnchanged` discards it),
`ticketPreview.*`, attachment `thumbUri`/dimensions, link title/description, sender name/avatar,
`showInChannel`. Fix: derive the signature from every `ConversationInput` field the model reads.

**M6 — §6.3 "height computed, not measured" is not implemented for message rows — decide and document.**
`list/legendListProps.ts:34-42` returns a fixed size only for `date` and `unread-divider`.
`measureRowHeight.ts:66-70` now calls itself a "first-pass estimate… not a hard clipping boundary".
That may be the right call (LegendList measures, `useHeightViolation` guards), but the design doc's
central promise still says the opposite. Either commit to estimate + measure and amend §6.3/B5, or make
the estimate exact enough to return from `getFixedItemSize`.

**M7 — `SystemMessageRow` is the one place the estimate *is* a hard boundary, and it clips.**
`rows/SystemMessageRow.tsx:22-24` sets `height: measureRowHeight(row)` + `overflow: hidden`; the
estimate assumes 300 px / 8.8 px-per-char, the row renders at device width in `px-8` with `text-xs`,
and the collapsible branch mounts `MessageRowBody` + Show more inside the clip. Drop the hard height.

**M8 — Plain `useState` in a recycled row (C11).**
`rows/parts/useFlowMessageAction.ts:35-36` (`overrideFlow`, `isSubmitting`). The reset effect at
`:67-70` runs after commit, so a recycled cell paints the previous flow card's edited values / spinner
for one frame on the new message. Use `useRecyclingState` keyed on `conversationId`.

**M9 — Day boundaries are UTC; timestamps and date pills are local.**
`model/buildRows.ts:13-16` and the duplicate `model/buildGrouping.ts:4-9` use `getUTC*`; `timeLabel`
and `formatDatePill` use local time. A UTC−5 user at 18:59 / 19:01 gets a group break, repeated
sender name, duplicated avatar, and two "Today" pills. One local `dayKey`, delete the duplicate.

**M10 — Hot path: every rebuild fully parses every row before `reuseUnchanged` throws the result away.**
`buildRows.ts:210-218` runs `htmlToMD` ×3, collapse, custom-emoji, inline-rich, preview strip ×2 per
row; no memo in `text/*`. One reaction on a 200-row window re-parses 200 messages on the JS thread
(§8.1 step 4). Fix: look up `previousRows` by id *before* parsing and reuse when signature inputs match.

### List / composer

**M11 — `ConversationList` has 13 props against a six-prop contract (§6.1).**
`list/ConversationList.tsx:53-69`. `onLandingMetrics` + `onUserTookOwnership` are both `dispatch`
wrappers → one `dispatch`; four `onRow*Press` → one `onRowEvent(kind, row)`; `onDockSend` + `children`
collapse with B3. Add a source-level test capping the prop count so drift fails CI.

**M12 — `anchoredEndSpace` was deliberately dropped; the design doc still mandates it.**
`composer/sendScroll.ts:3-8` explains why (offset on last index pins the row to the top — the
`keyboard.d.ts:87-98` semantics confirm it); `composerSendPath.test.ts:74` asserts its absence. §6.2
and B8 still say to use it. Amend the doc so the next implementer doesn't "fix" it back.

### Data / warm / overlays

**M13 — Warm window is evicted as soon as live has ≥1 row; `isAuthoritativeFor` is computed and ignored (B7).**
`data/conversationsForRows.ts:14-19` returns live whenever `length > 0`. `deriveDataFacts.ts:32`
computes `liveIsAuthoritative` but it only feeds the machine/telemetry, never row selection.
Notification open into a cached thread → live emits a partial first page without the target → rows swap
→ target disappears → landing jumps. Fix: `conversationsForRows(window, warm, liveIsAuthoritative)`.

**M14 — Scoped deferral defers nothing.** `scheduling/deferral.ts:63`; `token.defer` has zero callers.
Acquire/release is once per mount with no leak — good — but §5.6's named non-critical work is not
routed through it, and `releaseDeferralOnTeardown` (`useChatOpen.ts:74-81`) is a trivially-true
wrapper. Phase 8 item, or delete the unused surface now.

**M15 — Overlay hosts hold a frozen row snapshot.** `overlays/ReactionsHost.tsx:42-60` derives rows from
`target.reactionsMd` captured at press time; removing your reaction leaves it visible and a second tap
sends another `remove`. `MessageActionsHost.tsx:251-253` (`hasReacted`) and the `actionVisibility`
inputs (`:201-216`) are equally stale — a remotely deleted message still offers edit/copy/forward.
Hosts should key on `messageId` and read the live row.

**M16 — Long-press / pill / avatar tap silently cancels an in-progress edit.**
`screens/ChatConversation.tsx:83, 94, 104` reset with `{ ...EMPTY_OVERLAYS }`, which nulls `editing`
without `onCancelEdit`. `editing` is composer state, not a sheet — split it out (pairs with B1).

**M17 — `useThreadSurfaceGate` computes a gate nothing consumes.** `screens/useThreadSurfaceGate.ts:46-85`
(`shouldWaitForSurface`, two live subscriptions) vs `ChatThreadScreen.tsx:22`, which destructures only
`parsed, channelId, ticketId, isResolverHost`. v2 gates on it; v3 either missed the gate (thread opens
with no cached thread land on an empty surface) or is paying two queries for nothing. Decide; then wire
or delete. (Raised independently by two reviewers.)

---

## 4. Minor — cleanliness, dead code, small races

- **Dead pure-layer exports (characterised but unwired):** `revealPolicy.ts` `classifyWarmCase`,
  `shouldBlockReveal`, `isTargetCached`, `shouldKeepSeededTailWindow`, `isAwaitingPlacementConfirm`,
  `shouldShowMissingAnchor`, `selectOpeningWindow`, `canReveal`; `timeouts.ts` `timeoutDegrade`;
  `openActions.ts` `OPEN_ACTION_TYPES`; `openState.ts` `EMPTY_METRICS`; all of `resolveSurface.ts`
  (M3); `chatKeyboardConfig.ts` `getChatComposerBottomPadding` / `ChatComposerInsetMode`;
  `scheduling/adversarialNetwork.ts` (Phase 8). C17 is met but "no dead branches" is not — wire or
  delete, or move v2 characterisation ports into a named `characterisation/` module.
- `machine/openState.ts:48-52` `ListMetrics.didUserScroll` is never set true by any producer
  (`useLandingMetrics.ts:44` hard-codes `false`); user ownership is double-encoded with
  `userTookOwnership`. Keep one.
- `openReducer.ts:57-62` reports `liveLoadFailed` as `{reason:'timeout', stage:'loading'}` — add a
  `live-error` reason so telemetry and the error surface tell the truth (C8).
- `openReducer.ts:38-48` `source` can never reach `'live'` after `'warm+live'`; nothing reads it.
  Implement the third step or shrink the union.
- `useChatOpen.ts:133,144` `tick`/`teardown` bypass `tracedDispatch` → trace attributes timeout
  transitions to the previous action.
- I1/I2 in §5.2 no longer match `selectors.ts:12-25` (anchor targets now require `containsTarget` —
  the doc's own "conceal-with-skeleton" fallback). Update the text and extend the I1–I4 property test
  to `× target.kind × containsTarget`. Also §5.2's `isSurfaceVisible` formula would violate I4; the
  code is right, fix the doc.
- `screens/useResolveOpenCursor.ts:20-24`, `useThreadSurfaceGate.ts:33-34,60` read raw params with
  `String(params.x)` — bypasses the Zod boundary and disagrees with it on array params (`"a,b"` vs
  first element). Export a `firstParam` helper from the schema module.
- `useChatOpen.ts:40-43` mutates the query cache inside a `useState` initializer; confirm
  `hydratePersistedWindowWith` is idempotent (initializers can run twice) and say so in a comment.
- `useChatOpen.ts:139-146` teardown → `idle` with no `open` re-dispatch; safe only because the mount
  key is the intentKey and StrictMode is off. Dispatch `open` on setup when `idle` to be robust.
- `model/buildRows.ts:189-191` chrome rows return `prev` regardless of `count` → unread-divider count
  goes stale.
- `rows/MessageRow.tsx:153-157` identical ternary branches (`isFlowJson ? <Body/> : <Body/>`).
- Estimate drift (matters only under M6): jumbo lineHeight `+8` not in estimate; `ForwardedBanner`
  has no fixed-height container and counts `\n` not wrapped lines; `TicketCard` has no clamp to
  `MESSAGE_TICKET_HEIGHT`; `emojiRows` uses the constant width not the argument; expanded system rows
  don't add the "Show less" line.
- `list/ConversationList.tsx:220-221` passes `threadReplyCount` / `hideReplyChrome` that
  `ChatListRowProps` neither declares nor compares — thread reply chrome is functionally dropped
  (same root as the `ChatConversation.tsx:145` tsc error).
- `ConversationList.tsx:291` scroll-to-bottom pill sits on a constant (`80 + 12`), not the live
  composer reserve — occluded by a multi-line draft or the keyboard. Drive it from `composerReserve`.
- `ConversationList.tsx:180-183` jump-to-latest only shows in `user-owned`; an anchored landing far
  from the tail shows nothing until the user drags, and `returnedToBottom` is a no-op from `anchored`
  so MVCP keeps pulling the list back. `away = mode !== 'follow-tail'`, add a `jumpedToTail` event.
- `ConversationList.tsx:109-120` writes refs during render (idempotent, but not sanctioned).
- `composer/awaitKeyboardHidden.ts:40-45` — when the timeout wins, the `dismiss()` promise can reject
  unhandled; attach `.catch(() => {})` before racing.
- `list/useLandingMetrics.ts:47-49` reports from a `useEffect`, contradicting `landing.ts:53`'s own
  "never from an Effect"; it is already reported from `onScroll` / `onFirstVisibleItemChanged`.
- `useHeightViolation` `previousSizeByIdRef` never clears on `dataKey` change — unbounded growth.
- `overlays/onAction.ts:56-67,134-147,152-156` `try/catch` around `void zero.mutate(...)` never
  catches async rejections; `deps.fail` is dead. Use `.catch`.
- `overlays/ReminderOptionsHost.tsx:43` default time is captured at conversation mount (host is always
  mounted); key the host on the target message id.
- `ChatOverlays.tsx:35-46` never sets `MessageActionsTarget.threadId`; consumers fall back to
  `conversationId`. Set it from `intent.surface` or drop the field.
- `ChatOverlays.tsx:73-152` seven inline closures → all six sheets re-render on every conversation
  render (fold into the B1 reducer refactor).
- `screens/ChatChannelScreen.tsx:31-39` both orchestrates (`rememberLastOpenChannel` effect) and
  renders (C2); lift into a `useRememberLastOpenChannel` hook shared with the thread screen.
- `data/conversationsForRows.ts:19` casts `warm.records` (`unknown[] → Conversation[]`); §5.5 rule 5
  (age-bounded `source: 'warm'`) is not implemented — `readAt` is telemetry-only.
- `data/toThreadConversation.ts:21-32` synthetic fallback key `${threadId}:${createdAt}:${index}` is
  index-based → unstable under pagination (C10). Only hit when a reply has neither `messageId` nor
  `initialMessageId`; prefer failing loudly to an index key.
- C17 gaps: no direct tests for `applySenderNames`, `applyTrailingGroupAvatars`, `applyGrouping`,
  `rowKindFor`, `statusLabelsFor`, `estimateCharsPerLine`, `htmlInlineToMarkdown`'s own exports.
  `actionVisibility.test.ts` does not cover the deleted-message column for `forward`, `pin`,
  `remind-me`, `start-call`, `mark-as-unread`, `edit`/`delete` (logic verified correct; coverage gap).
- Naming/placement: `TEXT_CONTAINER_WIDTH_PX = 300` is a layout constant living in `model/buildBody.ts`;
  `chatRow.types.ts:1` couples the pure model to `@/src/utils/flowJsonMarkdown`.

---

## 5. What is genuinely excellent — keep it

- **Lazy `useReducer` initializer folds the warm read into initial state** (`useChatOpen.ts:44-54`):
  one synchronous MMKV read, no render-phase dispatch, no first frame in `resolving` when warm rows exist.
- **Per-status sub-reducers with `assertNever` on both axes** and a totality property test over the
  full status × action grid (`openReducer.test.ts:107`). I5, I6, I7, I9, I10, I11 all verified correct.
- **`useDataFacts` / `useConversationWindow`** — render-time derivation with reference-stable results;
  textbook C4. No `useState` holds message data anywhere; no second merge.
- **`anchoring.ts`** — a genuinely pure scroll-mode reducer + predicate with an exhaustive mode × status
  table test; exactly §6.5.
- **`legendListProps.ts`** — typed config builder (literal `true` for `alignItemsAtEnd`/`recycleItems`);
  every prop verified against the installed `@legendapp/list` `.d.ts`; banned-prop source tests make
  regressions loud. No `inverted`, no `extraData`, no padding fighting the inset, no imperative scroll
  in an effect. C14/B4 holds: `onSend` reads no connectivity.
- **`buildGrouping.ts`** implements all eight §9.0 rules; `grouping.test.ts` mirrors the table
  case-for-case, including the two easy-to-miss ones.
- **`actionVisibility.ts`** reproduces the §9 matrix literally; `MessageActionsHost` consumes it via
  `ACTION_ORDER.filter`, so order and visibility cannot drift apart.
- **`useRowPresentation.ts`** — presentation state on `dataKey` change derived for the current render
  and synced after commit; avoids both stale-flash and render-phase setState.
- **`jumboEmoji.ts`** documents *why* the hand-written grapheme regex exists (Hermes lacks
  `Intl.Segmenter`); `useHeightViolation` instruments the team's own P5 risk instead of assuming it.

---

## 6. Refuted during verification

**"Every thread reply shares one LegendList key."** A reviewer read
`data/toThreadConversation.ts:72` (`conversationId: threadId`) and concluded `keyExtractor` collapses all
replies to one key. Wrong: that line feeds the serialized fallback markdown only; the returned record sets
top-level `conversationId: messageId` (`:98`), which `toConversationInput.ts:180` reads first. Keys are
unique per reply. Recorded here so it isn't re-raised.

---

## 7. Do this next, in order

1. **B4** — make `tsc`, `eslint`, `test:chat-v3` green; split `FlowJsonRenderer.tsx`. *(½ day)*
2. **B1 + M16 + minor closures** — overlay state → reducer + discriminated union, `editing` split out.
3. **B2 + M5 + M10** — one `rowsAreEqual` / `reuseUnchanged` predicate; full `contentSignature`;
   reuse-before-parse.
4. **B3 + M11** — `ConversationList` renders the dock from config; prop contract back to ≤7 with a test.
5. **M1, M2, M4** — `useChatOpen` retry facts reset, pending re-anchor carry, target identity in the
   landing signature. Add a reducer test for each.
6. **M13** — `conversationsForRows` honours `liveIsAuthoritative`.
7. **M9, M7, M8** — local `dayKey`, drop the system-row hard height, `useRecyclingState` in flow rows.
8. **Decide and write down:** M3 (resolving: wire or delete), M6 (height: computed or measured),
   M12 (anchoredEndSpace), M14 (deferral), M17 (thread surface gate). Each is a one-paragraph
   amendment to the design doc plus either a wiring commit or a deletion commit.
9. **M15** — overlay hosts read live rows by id.
10. Sweep §4 dead code; update I1/I2/`isSurfaceVisible` text in §5.2.
11. Then the parity doc's open items: P3 pixel diff on device, P4 device confirmation of
    `landingConfirmed` < 1 500 ms.

---

## 8. Calibration

- **Verified by execution:** tsc, eslint, `test:chat-v3` (418/421), flow-json fixture root cause.
- **Verified by reading the cited lines:** every B/M finding and the §5 praise; the B1 double-write
  and the B2 comparator were re-read by the compiling reviewer after the layer reviewers reported them.
- **Not done:** the app was not launched; no performance number, frozen-frame count, or screenshot diff
  exists. G10 remains unmeasured. The `expansionExhausted` / newer-than-window anchor path
  (`deriveDataFacts.ts:38`, `useExpandTowardTarget.ts:26-32` only calls `loadOlder`) was noted but not
  traced end-to-end through the around-cursor query.
