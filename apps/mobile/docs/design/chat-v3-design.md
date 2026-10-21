# Chat v3 — Design Document

**Status:** Proposed · not started **Author:** Vinit Khandal (with Claude)
**Date:** 2026-08-21 **Fact-checked against:** `mobile-dev` @ `3a18941`
(`fix: long press to schedule send message added (#171)`). One commit past the
original draft base `6d79408` (#177). **Companion:**
[`chat-v3-implementation-plan.md`](./chat-v3-implementation-plan.md) — the
resumable, checkbox-driven build order.

> **9d landed (2026-09-02).** Open path and read cursor follow this document as
> amended below. The hardening plan's §6 checklist is the build record; where
> that plan and this document still disagree, **this document wins**.

---

## 0. How to read this document

This document is the **contract**. It says what chat v3 _is_, what it _must not_
become, and why every structural decision was made. The implementation plan says
_in what order_ to build it.

Two rules govern everything below:

1. **v2 is frozen.** We do not patch, refactor, or "improve"
   `src/features/chat/v2/**`. It keeps shipping exactly as it does today until
   v3 replaces it behind a flag and v2 is deleted wholesale.
2. **v3 is written from scratch — but only the layers that are broken.** "From
   scratch" means the _view, open-lifecycle, paint and list layers_. It
   explicitly does **not** mean the data/send engine. See §2.2 — this boundary
   is the single most important non-goal in this document.

**Provenance:** code facts were read from `mobile-dev` this session; LegendList
behaviour was confirmed against the installed `@legendapp/list@3.3.5` type
definitions **and** the official v3 API reference and chat guide; React / Expo
Router / MMKV guidance was pulled from official docs this session. The _Building
Mobile Apps at Scale_ lessons are taken via the consolidated findings HTML
(which digests the relevant chapters), not from a fresh read of the 134-page
PDF.

Evidence key used throughout: **Verified** = read in source or in the installed
package's type definitions this session · **Doc** = confirmed against official
library documentation this session · **Inferred** = strong deduction, not
line-confirmed.

---

## 1. Why v3 exists

### 1.1 The measured state of v2

| File                                        |                  Lines | Notable                                                                                                                            |
| ------------------------------------------- | ---------------------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| `v2/components/chat/chat-list.tsx`          |                  2,669 | 27 props, 14 `useState`, 33 `useRef`, 26 effects (19 `useEffect` + 7 `useLayoutEffect`), 39 `useCallback`                          |
| `v2/components/chat/chat-thread.tsx`        |                  2,174 | a **second, parallel** list engine, hand-synced with the first                                                                     |
| `v2/paint/buildChatPaintRows.ts`            |                  1,309 | + `chatPaintSizing` (233), `chatPaintEmoji`, `chatPaintPreviewSegments`, `chatPaint.types` (221)                                   |
| `v2/screens/ChatChannelScreen.tsx`          |                  1,063 | 12 `useState` / 22 `useRef` / 15 effects (9 `useEffect` + 6 `useLayoutEffect`) / 25 `useCallback`                                  |
| `chat-paint-row-lite.tsx`                   |                    873 | the paint-preview renderer (**one of three**, see §1.1a)                                                                           |
| `message-row.tsx`                           |                    675 | the ticket/system renderer — **not** the "rich" row                                                                                |
| `conversation-composer/**` (`ChatComposer`) | ~2,600 across 30 files | the actual rich renderer                                                                                                           |
| `navigation/chatOpenIntent.ts`              |                    427 | + `resolveChatLink.ts` (257), `restorePersistedChatWindow.ts` (160) — these live at `features/chat/navigation/`, **outside** `v2/` |

**Feature totals:** 23,705 lines · 121 `useRef` · 79 `useState` · 104
`useEffect`/`useLayoutEffect` (75 + 29). (Verified — walk of `src/features/chat`
at `3a18941`.)

`ChatPaintRow` today additionally carries **nine `@deprecated` v13 back-compat
alias fields** (`plainPreviewText`, `collapsedPreviewText`, `inlineMarkdown`,
`previewSegments`, `replyCount`, `replyPreviewUserIds`, `reactionSummaryCount`,
`replyAvatarSlots`, `collapse`) that duplicate the v14 canonical `body` /
`replyPreview` / `reactionPreview` / `mediaPreview` sub-models. Every row
therefore ships two representations of the same content. (Verified —
`chatPaint.types.ts`.)

### 1.1a The render architecture, as actually implemented

**Correction to the original audit.** The findings doc described a two-component
"lite → rich" promotion (`chat-paint-row-lite` → `message-row`). Reading
`chat-message-list-row.tsx:195–300` shows something different, and the
difference matters for what v3 must replace.

There are **three renderers**, chosen per row by a four-way branch:

| Condition                                                      | Renderer                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `useSpecialSystemComposer && conversation`                     | `ChatComposer` (conversation-composer)                              |
| `useMessageRow` — a _stable_ ticket row or _stable_ system row | `MessageRow`, with `fidelity={showRichShell ? 'full' : 'reserved'}` |
| `showRichShell && conversation`                                | `ChatComposer` — **this is the rich path**                          |
| otherwise                                                      | `<Pressable>` wrapping `ChatPaintRowLite`                           |

`showRichShell` =
`conversation !== undefined && !shouldKeepChatPaintPreview && (isFlowJsonMessage || isForwardedMessage || (isRichRenderingEnabled && presentation.rich))`.

Three consequences the earlier description missed:

1. **The promotion swaps `ChatPaintRowLite` → `ChatComposer`, not →
   `MessageRow`.** `MessageRow` is the ticket/system renderer and is largely
   orthogonal to the reflow problem.
2. **`MessageRow` already encodes the right principle.** Its header states the
   _"P5 contract: fidelity changes content, never geometry. Row paint carries
   every geometry-affecting box. Hydration can sharpen content, but it must
   never add/remove vertical space."_ That is exactly v3's G4 — v2 got it right
   for one renderer and never generalised it. v3's single-pass rule is the P5
   contract applied to **every** row, enforced by computing height from the
   model (§6.3).
3. **Some rows never promote at all.** `shouldKeepChatPaintPreview` pins a row
   to Lite when it is collapsible, or has custom emoji without media
   (`chat-paint-preview-policy.ts`). So the surface can hold Lite rows and
   ChatComposer rows simultaneously, with two different geometry authorities.

Promotion is driven by a `rowPresentationStore` holding per-row
`{ rich, media, expanded }`, gated by `richHydrationEnabled` — which
`ChatChannelScreen` flips **420 ms after the transition**
(`RICH_HYDRATION_AFTER_TRANSITION_DELAY_MS`). That timer is why the reflow is
visible: rows change renderer a fifth of a second after the user is already
reading them.

**What this changes for v3:** nothing in the plan's shape, but the target is
bigger than stated — retiring the two-pass paint means replacing
`ChatPaintRowLite` **and** the `ChatComposer` row path **and** `MessageRow` with
one renderer, and deleting `rowPresentationStore`, `shouldKeepChatPaintPreview`,
and the 420 ms gate along with them. §6.3 is written against this corrected
picture.

### 1.2 The one-sentence diagnosis

> **The view owns and re-derives state that belongs to one external store, and
> expresses the open lifecycle implicitly across ~32 refs and ~73 effects
> instead of one typed state machine — so illegal states are representable, and
> rare-event combinations reach them.**

Every user-reported symptom is a _reachable illegal state_, not an isolated bug:

- "held **and** un-shimmered" → blank screen.
- "shimmering **and** already revealed" → shimmer that never ends.
- "sent **but** not painted" → the message the user just typed vanishes.
- "anchored **and** tail-following" → the list fights itself and jumps.

`Building Mobile Apps at Scale` Ch. 14 names the mechanism exactly: _"Bugs are
caused by a combination of events out of the ordinary… independent components
consuming rare inbound events → exotic bugs."_ A cold notification open **is**
that rare inbound event, which is why the notification path is the most reliably
broken one.

### 1.3 What is already good and must be preserved verbatim

These are Verified-correct and are **consumed by v3, never rewritten**:

- **`@xyne/shared/messages` send engine** — `send.ts` does pending-queue →
  optimistic paint → mutator → lifecycle subscribe → `removePending` on `ok`,
  `mutatorAppError` on failure (which is what renders the failed-send retry
  affordance). Offline sends stay queued and Zero replays them in order on
  reconnect. Client-side `messageId` (and, for "also send to channel",
  `childConversationId`) is generated _before_ the mutator fires — that id is
  the idempotency key.
- **`useMessages(ref)`** — the public hook. There is no `useChannelMessages` /
  `useThreadMessages` export. Overload: `ChannelRef` →
  `UseChannelMessagesResult` (`messages`, `loadOlder`/`loadNewer`,
  `hasReachedChannelStart`, `isInitialLoadComplete`, `retryInitialLoad`,
  cached-first promotion); `ThreadRef` → `ThreadConversation | null`
  (full-thread query, **no** pagination API). Pending rows are already merged
  inside this hook.
- **`channelMessageMerge.ts`** — server↔pending merge, dedupe/sort, window
  reconciliation (`mergeServerAndPendingConversations`,
  `reconcileConversationWindow`, …).
- **Zero** as the sync/query layer, and `mutators` for all writes.
- **Failed-send retry + delete** UI semantics.
- **Reactions, link previews, ticket cards, flow-JSON messages, attachments** —
  feature-complete today.

---

## 2. Goals and non-goals

### 2.1 Goals

| #   | Goal                                                                                                                                                                     | Acceptance signal                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | **Zero blank screens.** Every open terminates in `ready` or `error`.                                                                                                     | No code path can produce "no rows, no shimmer, no error". Enforced by the type system (§5.2).                                                                                                                                                                                                    |
| G2  | **Zero infinite shimmers.**                                                                                                                                              | Shimmer is a _function of state_, not a boolean anyone can forget to clear. Every non-terminal state has a bounded timeout that transitions to `error`.                                                                                                                                          |
| G3  | **Deterministic landing.** Tail opens land at the tail; unread opens land on the divider; anchored opens land on the target message. Never "land, then jump".            | Landing is decided **before** reveal; the surface is only revealed once the resolved position is confirmed.                                                                                                                                                                                      |
| G4  | **No visible reflow.** Rows do not resize after they appear.                                                                                                             | Single-pass paint. The lite→rich two-pass promotion is **deleted**, not tuned.                                                                                                                                                                                                                   |
| G5  | **Send feels instant.**                                                                                                                                                  | Optimistic row painted in the same frame as the tap; list anchored so the new row lands in a readable position above the composer.                                                                                                                                                               |
| G6  | **Notification continuity.** Tapping a push lands on that exact message with full surrounding history.                                                                   | Warm-cache containment check → cached-first paint → live reconcile, with the cached window never evicted by a partial live window.                                                                                                                                                               |
| G7  | **Readable code.**                                                                                                                                                       | File budget ≤ ~300 lines; no file over 400 without a written exemption. No component holds shadow-state refs.                                                                                                                                                                                    |
| G8  | **Testable policy.**                                                                                                                                                     | Every open/landing/reveal decision is a pure function with unit tests, callable without mounting a component.                                                                                                                                                                                    |
| G9  | **Full feature parity.**                                                                                                                                                 | The §9 checklist is the release gate. Nothing on it may be dropped.                                                                                                                                                                                                                              |
| G10 | **Pixel and gesture parity with v2.** v3 must be visually and behaviourally _indistinguishable_ — the only permitted differences are that it is faster and lacks B1–B13. | Side-by-side screenshots of the same conversation on the same device are indistinguishable. Any diff is a bug, not a design decision. See [`chat-v3-visual-parity.md`](./chat-v3-visual-parity.md). **§9 alone is insufficient** — it checks that a feature _exists_, not that it _looks right_. |

### 2.2 Non-goals — the reuse boundary (read this twice)

**v3 does NOT rewrite:**

- ❌ `@xyne/shared/messages/**` — send, pending queue, merge, draft, pagination,
  mutation lifecycle.
- ❌ Zero schema, queries, mutators, or the sync layer.
- ❌ The notification _delivery_ pipeline (`NotificationService`, FCM handlers,
  display, tap cache) — v3 changes only how a tap is turned into a validated
  open intent, and how the warm cache is read.
- ❌ Backend/API contracts. v3 ships no server change.
- ❌ Presence features that don't exist today (typing indicators, read receipts,
  online/last-seen). These need backend support and are tracked in §11 as
  **deferred**, not as parity.
- ❌ The emoji picker, attachments viewer, profile sheets, and other shared
  surfaces outside `features/chat` — v3 consumes them.

**Why this boundary:** the audit found the data/send engine is the one part that
is architecturally correct. "From scratch" applied to it would re-introduce risk
in the only layer that currently has none. If a change to `@xyne/shared` turns
out to be genuinely required, it must be raised as an explicit decision in the
plan, not made silently.

**v3 DOES rewrite from scratch:**

- ✅ The screen, list, row, and paint layers.
- ✅ The open lifecycle (intent → load → place → reveal).
- ✅ The reveal/landing policy (as pure functions, reusing v2's _test suites_ as
  the spec).
- ✅ The warm-cache read contract (MMKV) as consumed by chat.
- ✅ Composer docking/geometry integration with the list.
- ✅ Work deferral (replacing the global 10s critical window).

---

## 3. Coexistence: how v3 ships without touching v2

### 3.1 Directory

```
apps/mobile/src/features/chat/
  v2/                     ← FROZEN. No edits. Deleted in one commit at the end.
  v3/
    intent/               ← route-edge validation → typed OpenIntent
    machine/              ← open state machine (reducer + selectors, pure)
    data/                 ← subscribe-only adapters over @xyne/shared + Zero
    model/                ← row model + single-pass paint
    list/                 ← the ONE list engine (channel + thread)
    rows/                 ← row components
    composer/             ← composer dock + geometry
    overlays/             ← actions sheet, reactions, reminders hosts
    warm/                 ← MMKV warm-cache read contract
    scheduling/           ← scoped deferral
    screens/              ← ChannelScreen, ThreadScreen (thin)
    __tests__/
```

### 3.2 The only shared touchpoint

There are **three** chat-screen entry files, not four, and they are not the same
shape:

| File                                              | Today                                                                                                                  | v3 switch                                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `app/(protected)/chat/[channelId]/index.tsx`      | one-line re-export of `ChatChannelScreen` (Verified)                                                                   | flag → v2 or v3 screen                                                                                                              |
| `app/(protected)/chat/[channelId]/[threadId].tsx` | one-line re-export of `ChatThreadScreen` (Verified)                                                                    | flag → v2 or v3 screen                                                                                                              |
| `app/(protected)/chat-deeplink.tsx`               | **319-line resolver host** that imports both screens and runs `resolveChatLink*` + `commitResolvedChatOpen` (Verified) | keep as a param-passer **or** collapse into L1 `parseOpenIntent` + the flagged screen. Do **not** treat it as a one-line re-export. |

DMs share the `[channelId]` route. There is no fourth chat-screen re-export.

```ts
// app/(protected)/chat/[channelId]/index.tsx
import { isChatV3Enabled } from '@/src/features/chat/v3/flag';
import ChatChannelScreenV2 from '@/src/features/chat/v2/screens/ChatChannelScreen';
import ChatChannelScreenV3 from '@/src/features/chat/v3/screens/ChatChannelScreen';

export default function ChatChannelRoute(): ReactElement {
  return isChatV3Enabled() ? <ChatChannelScreenV3 /> : <ChatChannelScreenV2 />;
}
```

**Rules:**

- The flag is read **once per screen mount**, not per render — flipping it
  mid-session must not half-swap a mounted screen.
- Every phase in the implementation plan must be **shippable with the flag
  off**. Merging a half-built v3 is safe by construction because nothing outside
  `v3/` changes, **except** the named B4 composer patch (§4 B4, plan ground rule
  8).
- The v3 vs v2 switch is **local**, not Superposition CAC and not a build-time
  `EXPO_PUBLIC_*` flag. `isChatV3Enabled()` reads an MMKV value (default
  `true` for the test release) once per mount. Settings expose **Chat v3** to
  turn it off; leave the chat screen and reopen so the new mount picks it up.

**Feature-flag discipline (Ch. 31, "Feature Flag Hell").** The book is blunt:
_"stale feature flags are worse than dead code… With mobile, there is a very
real danger of deleting non-dead code behind a feature flag."_ So:

- The v3 flag has a **named owner and a written expiry date**, recorded in
  `v3/flag.ts`.
- It is used in **exactly one pattern**, in the three chat-screen entry files
  (and, when 9a lands, `TicketDetailsScreen`) — never sprinkled inside v3 code.
  Ch. 31: automated flag cleanup _"works better when feature flags follow a
  consistent coding pattern enforced by a linter"_. A single, greppable call
  site makes Phase 11's removal mechanical rather than archaeological.
- **No nested flags.** Ch. 31's dependent-flag trap (SubFeature at 50% inside
  MainFeature at 50% reaches 25%) is avoided by never gating a v3 sub-feature
  behind its own flag. v3 ships whole or not at all.
- **Check for conflicting flags before rollout.** Ch. 31: two teams each test
  with their own flag on, neither tests with both. Before ramping v3, enumerate
  the other flags live at that moment and test the intersection with any that
  touch chat, notifications, or navigation.
- Phase 11 deletes the flag **and** the v2 branch together, verified by the grep
  criteria in §3.4 — which is exactly the "danger of deleting non-dead code"
  guard the book warns about.

### 3.3 Third-party consumers of v2 — known blast radius

`v2/components/chat/chat-thread.tsx` is imported by **three** list surfaces
(Verified):

1. `v2/screens/ChatThreadScreen.tsx` (the chat thread route),
2. `src/screens/TicketDetailsScreen.tsx`,
3. `src/features/xyne-desks/detail/components/messages-tab/messages-tab.tsx`.

Those are the list-engine consumers. v2 **cannot be deleted** until they migrate
(plan Phase 9a/9b) **and** every other import of `features/chat/v2` is
retargeted. A `grep` on HEAD also finds:

| Consumer                                                                                  | What it takes from v2                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `app/(protected)/settings/chat-theme/chat-bubble-preview.tsx`                             | paint rows + lite/rich row                                          |
| `app/(protected)/chat/[channelId]/pinned-messages.tsx`                                    | `ConversationComposer` + user-profile sheet                         |
| `app/(protected)/(shortcuts)/bookmarks.tsx`                                               | message-actions sheet                                               |
| `src/features/bookmarks/components/bookmark-list-item.tsx`                                | message-actions + reminder utils                                    |
| `src/components/input-composer/conversation-input.tsx`                                    | `chatKeyboardConfig`                                                |
| `src/features/drafts-sent/edit-scheduled-message-composer.tsx`                            | `chatKeyboardConfig`                                                |
| `src/features/xyne-desks/detail/utils/email-html-to-markdown.ts`                          | `htmlToMD`                                                          |
| `src/features/xyne-desks/detail/components/email-tab/email-body.tsx`                      | `rich-inline-text`, `parseInlineRich`, `markdownStyle`              |
| `src/features/xyne-desks/detail/components/email-summary-sheet/email-summary-content.tsx` | `markdownStyle`                                                     |
| `src/theme/chatBubblePreviewTokens.ts`                                                    | `ChatRenderTokens` from `message-row`                               |
| `src/components/conversation-composer/**`                                                 | leftover `features/chat/paint/chatPaint.types.ts` (not under `v2/`) |

Phase 11's grep (`features/chat/v2` under `src` and `app`) is the deletion gate
— these rows are why it will not go green from the list migration alone. Utils
that survive (htmlToMD, keyboard config, mention schemes) must move to a
non-`v2` home **before** the delete commit, through the §8.1 gate.

Until 9b and the table above are done, v2 stays on disk even at 100% v3 chat
rollout.

### 3.4 Deletion criteria for v2

v2 is deleted in a single commit only when **all** hold:

- v3 flag has been at 100% for a full release cycle with no chat-related
  regression reports.
- §9 parity checklist is fully green.
- `TicketDetailsScreen` and `messages-tab` render the v3 list.
- No import of `features/chat/v2` remains (`grep -r "features/chat/v2" src app`
  returns nothing). That includes the §3.3 non-list consumers, not only the two
  list surfaces.

---

## 4. The bug ledger

Every symptom — reported by users or predicted by the scale book — with its v2
root cause, and the v3 mechanism that makes it **unrepresentable** — not merely
"fixed".

### B1 — Blank chat screen (worst on the notification path)

- **Symptom:** open a chat from a push; nothing paints. No rows, no shimmer, no
  error.
- **Root cause (Verified):** the open lifecycle is a web of refs. On the
  notification path a _hold_ concealed the list while the skeleton was
  simultaneously suppressed. The combination `held && !shimmering && !error` is
  representable because "held" and "shimmering" are independent booleans across
  `chat-list.tsx` (`revealedChatListIdentityKeyRef`,
  `shouldShowOpenPlaceholder`, `wasBlockingChatListRevealRef`,
  `didListInitialLoadComplete`, …). Patched reactively in PR #174.
- **v3 mechanism:** the open state is **one discriminated union** (§5.2). There
  is no `held` state at all — a surface is either
  `resolving | loading | placing | ready | error`, and _every_ non-`ready` state
  renders a defined visual (skeleton or error). `held && !shimmering` cannot be
  constructed.

### B2 — Infinite shimmer

- **Symptom:** skeleton never resolves; user must back out.
- **Root cause (Verified):** shimmer visibility is derived from
  `shouldShowOpenPlaceholder || !didListInitialLoadComplete` plus several
  ref-held conditions. If a data or placement callback never fires (query
  stalls, anchor never arrives, Zero disconnected), nothing ever clears it and
  there is no timeout that converts the stall into a user-visible failure.
- **v3 mechanism:** (a) shimmer is `state.status !== 'ready'` — a pure function
  of the union, and (b) **every non-terminal state carries a deadline**.
  `resolving`, `loading`, and `placing` each have a budget; exceeding it
  transitions to `error` with a retry affordance. A stuck surface becomes a
  _visible, actionable_ failure within a bounded time. This directly implements
  the book's "degrade gracefully" rule — blank is silent degradation, and we
  make it loud.

### B3 — Wrong landing position / "lands, then jumps"

- **Symptom:** opening from a notification or a jump-to-message lands somewhere
  near the target, then visibly scrolls again; or opens at the tail then jumps
  up.
- **Root cause (Verified):** rows above the target hold **estimated** heights in
  the virtualized list, so `scrollToIndex` computes an offset from estimates and
  then corrects once real heights measure. The surface is revealed _before_
  placement is confirmed, so the correction is visible.
- **v3 mechanism:** `placing` is an explicit state that sits **between**
  `loading` and `ready`. The list is mounted and measuring but the surface is
  not yet revealed. Reveal happens only after the landing confirmation predicate
  passes. Combined with G4 (single-pass paint, deterministic heights) the
  correction magnitude drops to ~zero. For anchored opens we use LegendList's
  `initialScrollIndex: { index, viewPosition }` rather than a post-mount
  imperative scroll — the docs explicitly recommend `initialScroll*` over
  "imperative scroll calls in `useEffect`". (Doc.)

### B4 — Sent message invisible

- **Symptom:** user sends; the message does not appear.
- **Root cause (Verified on HEAD `3a18941`):** `input-composer-root.tsx` still
  has an eager `if (isOfflineRef.current) { haptics.warning(); return; }` in
  `send()` (lines 351–355) **before** `onSend` / `sendMessage` is called.
  `a213031` removed that guard ("offline sends now visible"); a later composer
  change reintroduced it, and `#171` added two more offline early-returns for
  schedule. `useZeroOfflineState.isOffline` flips true on a transient Zero blip,
  so a tap can still be swallowed. The shared engine is fine; the composer never
  reaches it.
- **v3 mechanism:** **the composer never decides whether a send is possible.**
  Submit builds the payload and calls `sendMessage(zero, ref, payload)`.
  Connectivity, queueing, retry, and failure presentation are the engine's
  concern. Encoded as C14 and as a unit test asserting `sendMessage` is called
  while offline.
- **Ground-rule exception:** this guard lives in
  `src/components/input-composer/`, **outside** `v3/` and **outside** frozen
  `v2/`. Hosting the composer "unchanged" would keep B4. Closing B4 requires a
  targeted patch to `input-composer-root.tsx` (remove the send-path offline
  early-return; schedule may stay gated — scheduling is a server mutation, not
  the pending queue). That patch is the one allowed edit outside `v3/` before
  Phase 10. See plan ground rule 8.

### B5 — Random scroll jumps and flicker

- **Symptom:** the list shifts while reading; content above the viewport pushes
  the read position down; rows visibly resize after they appear.
- **Root causes (Verified):**
  1. **Two-pass paint.** `chat-paint-row-lite.tsx` (873 lines) renders first and
     is then swapped for the `ChatComposer` rich path — **not** for
     `message-row.tsx`, which is the ticket/system renderer (§1.1a). The swap is
     gated by `richHydrationEnabled`, which flips **420 ms after the
     transition** (`RICH_HYDRATION_AFTER_TRANSITION_DELAY_MS`), so rows change
     renderer while the user is already reading. Markdown, images, and link
     previews then re-measure → every row is a resize event.
     `shouldKeepChatPaintPreview` pins collapsible and
     custom-emoji-without-media rows to Lite, so two geometry authorities
     coexist in one list. The only thing preventing visible jumps is a ~25-line
     `maintainVisibleContentPosition` config in `chat-list.tsx` (built at lines
     2301–2340; passed into the list at 2553) whose own comments warn that
     changing the native MVCP contract mid-open "can make iOS recalculate from a
     stale offset."
  2. **`shouldRestorePosition` is a heuristic over live scroll state** — it
     reads `listRef.current?.getState()`, `scrollStateRef`, `unreadTailLocked`,
     `contentExpansionAnchorState`, and `hasRequestedAnchorRef` and returns a
     boolean. Six inputs, one boolean, no test.
- **v3 mechanism:** eliminate the _cause_, then keep MVCP as a safety net rather
  than a load-bearing mask.
  - **One row component. One pass.** A row's height is computed
    deterministically from its model _before_ it renders (§6.3) and fed to
    LegendList via `getFixedItemSize` where the height is exactly known and
    `getItemType` so each row family gets its own size average. (Doc:
    `getFixedItemSize` "enables optimal performance by skipping measurement
    overhead"; `getItemType` for "item families with meaningfully different
    average sizes".)
  - **Media reserves its box before it loads.** Aspect ratio and reserved height
    already exist in the paint model (`ChatPaintMediaGeometry.reservedHeightPx`,
    `MediaPlaceholder.aspectRatio`) — v3 makes reserving mandatory, so an image
    arriving never changes row height.
  - **`shouldRestorePosition` becomes a pure function** of the open state
    union + a single scroll-mode enum, with unit tests. Not a six-input
    heuristic reading live refs.

### B6 — Data inconsistency (message missing, stale, duplicated, or out of order)

- **Symptom:** a message visible on desktop is absent on mobile; a message
  appears twice; ordering differs between the list and the notification.
- **Root cause (Verified):** the view runs a **second merge** on top of the
  engine's. `chat-list.tsx:584` calls
  `dedupeAndSortConversations(cacheRowsForOpen, liveRowsForOpen)` — the same
  shared function, but at a second call site with different inputs — while
  `cachedMessageRevision` (state, line 485) and `cachedMessageSnapshotRef`
  (line 495) hold the component's own revisioned copy of the window. Two merge
  sites over two input sets means the ordering the user sees is decided in a
  place the engine cannot see, so cache/live disagreements surface as missing,
  duplicated, or out-of-order rows.
- **v3 mechanism:** **the view subscribes; it never owns.** React's official
  rule: _"When something can be calculated from the existing props or state,
  don't put it in state. Instead, calculate it during rendering."_ and _"you
  don't need Effects to transform data for rendering."_ (Doc.) v3 has exactly
  one merge — the shared one — and the row model is `useMemo`-derived from it
  during render. There is no `cachedMessageRevision`, no second window, no
  effect that copies store data into component state.

### B7 — Notification continuity (partial history, missing the notified message)

- **Symptom:** tapping a push opens the chat but shows only a sliver of
  messages, or not the notified message at all; scrolling up shows a gap.
- **Root cause (Verified, partly):** the warm path already has the right _idea_
  — `warmZeroFromNotification.ts` checks `containsNotificationTarget` against
  the MMKV cache and only fetches when the cache can't land the exact message;
  `restorePersistedChatWindow.ts` restores a persisted window. But the _view_
  can evict that restored window when a partial live query result arrives, and
  the cached-vs-live handover is expressed in refs.
- **v3 mechanism:** the warm window is a first-class, typed input to the open
  machine (`OpenSource = 'live' | 'warm' | 'warm+live'`), and the handover rule
  is a pure function with the invariant **a live window never replaces a warm
  window unless it is a superset for the requested target**. v2's existing test
  suite already asserts exactly this
  (`"does not let a partial live window evict the visited thread"`,
  `"hands over to the settled live window once it is authoritative"`) — those
  tests become v3's spec.

### B8 — Composer occlusion / message hidden behind the composer or keyboard

- **Symptom:** the newest message sits under the composer or the keyboard;
  sending scrolls to a position where the sent message is partly hidden.
- **Root cause (Verified in v2 approach):** bottom reserve is a mix of
  Reanimated shared values (`use-chat-composer-geometry.ts` →
  `contentInsetEndAdjustment={composerGeometry.extraHeight}` on
  `KeyboardAwareLegendList`) **and** ad-hoc `paddingBottom` styles on the list
  content container and dock. The inset path is already the right one; the
  padding path is what still fights it.
- **v3 mechanism:** use **only** the library-native inset on
  `KeyboardAwareLegendList`. That wrapper (not base `LegendList`) is what types
  `contentInsetEndAdjustment` as `SharedValue<number>`. Composer height is a
  Reanimated shared value → inset, never a React state that re-renders the list.
  Landing the sent message in a readable position uses `scrollMessageToEnd`, not
  `anchoredEndSpace` (that offset pins the last index to the top).

### B9 — Unrelated screens stall for up to 10 seconds after opening a chat

- **Symptom:** open a chat, go back, other lists are stale/empty for a while.
- **Root cause (Verified):** `beginCriticalWindow('chat:<id>')` writes into a
  **module-level global** with `CRITICAL_WINDOW_TIMEOUT_MS = 10_000`, and
  `useIsCriticalWindowActive()` gates unrelated queries app-wide
  (`useDeferredLiveData`). Chat opens call it from `openChatRoute.ts`; **the
  same module is also used by tab transitions, channel/DM lists, activity,
  search, and chat info** — v3 must stop using it for chat-open, but Phase 11
  may not delete the file until those other callers are gone. If any chat-open
  exit path forgets `endCriticalWindow`, the app defers work for the full 10 s.
- **v3 mechanism:** deferral becomes **scoped and lifetime-bound**. The open
  machine owns a `deferral` token tied to the screen's lifetime (released in the
  same place the machine is torn down — impossible to leak because there is one
  teardown, not many exit paths), it names _what_ it defers rather than freezing
  everything globally, and the timeout is a safety net measured in hundreds of
  ms. Non-critical work is deferred with `InteractionManager` /
  `requestAnimationFrame`-after-paint, which is RN's documented mechanism,
  instead of a bespoke global.

### B10 — Duplicate/dead taps and double-open

- **Symptom:** double-tapping a chat row opens two screens or dead-ends.
- **Root cause (Verified, partly mitigated):** guard state lives in
  `openChatRoute` + `useFocusEffect`; v2's `chatOpenIntent.test.ts` already
  covers
  `"does not release another invocation's guard when re-anchoring a duplicate tap"`.
- **v3 mechanism:** intent resolution is idempotent by construction. `intentKey`
  identifies the **surface** (channel / thread / ticket-thread), not the landing
  message. A second `open` with the same `intentKey` while non-terminal is a
  no-op (I9). A new target _on that same surface_ once `ready` is `reanchor`
  (I11 / B12), not a second `open`.

### B11 — Navigating away mid-open leaves the app in a strange state

- **Symptom:** tap a chat, immediately hit back (or tap a different chat) while
  it is still loading → the previous open's callbacks land on a dead screen, a
  guard is never released, or the next open inherits stale placement.
- **Root cause (Verified):** v2 has no single point at which an in-flight open
  is abandoned. In `ChatChannelScreen.tsx` alone,
  `endCriticalWindow(getChatCriticalWindowTag(channelId))` is called from
  **three** independent sites (lines 476, 683, 731), alongside `releaseChatOpen`
  (488), a `useFocusEffect` (642) and a `BackHandler` subscription (647). Three
  release sites for one global window is precisely the leak surface described in
  B9, and none of them cancels the in-flight continuations — late callbacks
  still land.
- **Book, Ch. 13 (Navigation Architecture):** _"Asynchronous navigation is a
  common issue that few engineers consider handling ahead of time… What happens
  when the user attempts to navigate away during this phase? If you do not plan
  and test for this scenario, the app can get into strange states."_
- **v3 mechanism:** the union gains an explicit abandon path. `teardown` from
  **any** non-terminal status transitions to `idle` and releases the deferral
  token, and **every** async continuation (`surfaceResolved`, `warmWindowRead`,
  `landingConfirmed`, `tick`) is a **no-op unless its `intentKey` matches the
  current state's**. Late callbacks from an abandoned open cannot mutate a live
  one. Tested as its own invariant (I10).

### B12 — Deep link into an already-open chat (in-place re-anchor)

- **Symptom:** you are reading channel A; a notification for a different message
  in channel A (or a reply in a thread you have open) arrives and is tapped. The
  screen re-anchors but keeps fragments of the previous open's state — old
  target, old resolver flags, old scroll ownership.
- **Book, Ch. 4 (Deeplinks):** _"State problems when deeplinking to a running
  app with existing state… What should happen? … The solution that results in
  the least amount of non-deterministic behavior is to **reset the app's state
  fully when receiving a deeplink**. However, there might be flows that you do
  not want to break, so plan carefully."_
- **v3 mechanism — the planned exception to full reset.** v3 takes the book's
  default (full reset) and names the one deliberate exception:
  - **Different conversation → full reset.** New `intentKey` → the surface
    remounts via `key={intentKey}` (C5). Nothing carries over. This is the
    book's recommended behaviour.
  - **Same conversation, new target → controlled re-anchor.** The `intentKey` is
    unchanged, so the machine takes a `reanchor(target)` action:
    `ready → placing` with the new target, explicitly clearing scroll ownership
    and any previous target lock, while keeping the loaded window. This is the
    "flow you do not want to break" — remounting a conversation the user is
    already reading would be a worse experience than re-anchoring it.
  - v2 already encodes both cases in tests
    (`"clears stale message and resolver state when re-anchoring in place"`,
    `"re-anchors a newer notification inside the current thread"`,
    `"recognizes an in-place deep-link channel as the current main conversation"`,
    `"does not re-anchor an unresolved external message into the main list"`) —
    they port as the spec for `reanchor`.
- **Backward compatibility:** Ch. 4 also warns that existing deeplinks must keep
  working in older app versions. v3 changes only how a link is _consumed_, never
  the link format, so no link that works today can stop working.

### B13 — App killed by the OS mid-conversation; reopening loses the place

- **Symptom:** the OS reclaims the app while a chat is open; relaunching drops
  the user at the tab root, or at the chat's tail rather than where they were
  reading.
- **Book, Ch. 1 (State Management):** _"The OS monitors CPU, memory, and energy
  consumption. If the OS determines that your app is taking up too many
  resources… it can be killed with little warning. It is the app developer's
  responsibility to react to application state changes, save state, and to
  restore the app to where it was running."_
- **v3 mechanism:** process death is treated as a **first-class open source**,
  not an edge case. `lastOpenChannel.ts` + `restorePersistedChatWindow.ts`
  already persist the necessary state; v3 consumes them through the same
  `readWarmWindow` path, producing an `OpenIntent` with `entry: 'restore'` and a
  `LandingTarget` derived from the persisted read position. A restored open
  therefore travels the _same_ five states as every other open — there is no
  separate restore code path to drift.

---

## 5. Architecture

### 5.1 Layer map

```
  ┌────────────────────────────────────────────────────────────────────┐
  │ L0  Route edge          app/(protected)/chat/**  (flag switch only)│
  ├────────────────────────────────────────────────────────────────────┤
  │ L1  intent/             untrusted params → validated OpenIntent    │  pure
  ├────────────────────────────────────────────────────────────────────┤
  │ L2  machine/            OpenIntent + data facts → OpenState union  │  pure
  ├────────────────────────────────────────────────────────────────────┤
  │ L3  data/               subscribe-only adapters (@xyne/shared,Zero)│  hooks
  │     warm/               MMKV warm window read contract             │
  ├────────────────────────────────────────────────────────────────────┤
  │ L4  model/              Conversation[] → ChatRow[] (single pass)   │  pure
  ├────────────────────────────────────────────────────────────────────┤
  │ L5  list/               ONE LegendList engine (channel + thread)   │  view
  │     rows/               ONE row component per row kind             │
  ├────────────────────────────────────────────────────────────────────┤
  │ L6  composer/ overlays/ dock, geometry, sheets                     │  view
  ├────────────────────────────────────────────────────────────────────┤
  │ L7  scheduling/         scoped deferral · observability            │
  └────────────────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows point down only. L1/L2/L4 import **no React
components** and no React Native modules — they are plain TypeScript, importable
from a test file with no renderer. This is what makes G8 (testable policy) true
rather than aspirational.

### 5.2 L2 — The open state machine (the core of v3)

This is the single change that closes B1, B2, B3, most of B5, and the testing
gap simultaneously.

```ts
// v3/machine/openState.ts

/** Where the surface should land once data is ready. Set at loading/placing entry; immutable until `reanchor`. */
export type LandingTarget =
  | { kind: 'tail' }
  | {
      kind: 'unread';
      boundaryAt: number;
      boundaryConversationId: string | undefined;
    }
  | {
      kind: 'anchor';
      conversationId: string;
      messageId: string;
      createdAt: number;
    };

export type OpenSource = 'live' | 'warm' | 'warm+live';

export type OpenFailure =
  | { reason: 'invalid-intent' } // link/params failed validation at L1
  | { reason: 'not-found' } // channel/thread/message does not exist or is inaccessible
  | { reason: 'no-access' }
  | { reason: 'anchor-unreachable' } // target could not be located after exhausting expansion
  | { reason: 'timeout'; stage: 'resolving' | 'loading' } // placing times out to reveal, not error
  | { reason: 'offline-cold' }; // nothing cached and no connection

export type OpenState =
  /** Nothing requested yet. Pre-dispatch only — the screen fires `open` on mount. Never a user-visible open. */
  | { status: 'idle' }
  /** A link/notification needs its surface resolved (thread vs channel vs ticket). Renders skeleton. */
  | { status: 'resolving'; intent: OpenIntent; startedAt: number }
  /** Surface known; first window not usable yet. Renders skeleton. */
  | {
      status: 'loading';
      intent: OpenIntent;
      target: LandingTarget;
      startedAt: number;
    }
  /** Rows exist and are mounted; position not yet confirmed. Renders whatever rows it has —
   *  skeleton only if there is nothing paintable (I1/I2). Never conceals held rows. */
  | {
      status: 'placing';
      intent: OpenIntent;
      target: LandingTarget;
      source: OpenSource;
      startedAt: number;
    }
  /** Settled: position confirmed. The only state in which the list is *interactive*; rows may
   *  already have been visible during `placing`. */
  | {
      status: 'ready';
      intent: OpenIntent;
      target: LandingTarget;
      source: OpenSource;
    }
  /** Terminal failure with a retry affordance. Renders an error surface. Never blank. */
  | { status: 'error'; intent: OpenIntent | null; failure: OpenFailure };
```

**Invariants — each one enforced by a test:**

| #   | Invariant                                                                                                                                                                                                                                                                                                                                                                                  | Kills      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| I1  | For a tail/unread open the surface is eligible to paint iff `status === 'ready'` **or** `hasPaintableRows`. For an **anchor** open it is eligible iff the window `containsTarget` (never flash the latest page then jump). Eligibility is data readiness; the list keeps a short paint guard until LegendList `onLoad`, `readyToRender`, or first-visible evidence confirms native layout. | B1, B7     |
| I2  | The skeleton is visible while the open cannot paint (`!canPaintOpen`) or while paintable rows are still awaiting their first native layout. It never survives the machine reaching `ready`, so the placement timeout and user-ownership fallback cannot become an infinite shimmer.                                                                                                        | B1, B2, B7 |
| I3  | The error surface is visible **iff** `status === 'error'`.                                                                                                                                                                                                                                                                                                                                 | B1         |
| I4  | I1–I3 are **mutually exclusive and exhaustive** — every reachable state renders skeleton, rows, or error. **There is no state that renders nothing.** Proven by `assertNever` plus a property test over `status × hasPaintableRows`.                                                                                                                                                       | B1         |
| I5  | Every non-terminal status carries `startedAt`; exceeding its budget transitions as in the timeout table.                                                                                                                                                                                                                                                                                   | B2         |
| I6  | `target` is set at `loading`/`placing` entry and is immutable until `reanchor` or `teardown`.                                                                                                                                                                                                                                                                                              | B3         |
| I7  | `placing → ready` via `landingConfirmed` requires `isPlaced` (LegendList `positionByKey` / `isAtEnd`, not viewport range). The placing-budget `tick` is the **one** exception: it forced-reveals at the best-known position and logs.                                                                                                                                                      | B3         |
| I8  | `source` may go `warm → warm+live → live` but a live window may only supersede a warm one when `isAuthoritativeFor(target)`.                                                                                                                                                                                                                                                               | B7         |
| I9  | A second `open` action with the same `intentKey` while non-terminal is a no-op. `intentKey` is surface identity, not the landing message.                                                                                                                                                                                                                                                  | B10        |
| I10 | Every async continuation is a no-op unless its `intentKey` matches the current state's; `teardown` from any non-terminal status reaches `idle` and releases the deferral token.                                                                                                                                                                                                            | B11        |
| I11 | `reanchor` is legal from `loading` / `placing` / `ready` / `error` with an unchanged `intentKey`; it starts a new hunt so notification A then B on the same channel is not dropped. A changed `intentKey` remounts instead. `reanchor` is the **only** imperative scroll.                                                                                                                  | B12        |

**Where `hasPaintableRows` comes from.** It is a **data fact, not machine
state** — the selectors take `(state, facts)`:

```ts
export const isSkeletonVisible = (s: OpenState, f: DataFacts): boolean =>
  s.status !== 'ready' && s.status !== 'error' && !canPaintOpen(s, f);
export const isSurfaceVisible = (s: OpenState, f: DataFacts): boolean =>
  s.status !== 'error' && (s.status === 'ready' || canPaintOpen(s, f));
export const isErrorVisible = (s: OpenState): boolean => s.status === 'error';
```

`canPaintOpen` is `containsTarget` for an anchor and `hasPaintableRows`
otherwise. `isSurfaceVisible` excludes `error` so I3/I4 stay mutually exclusive.

`hasPaintableRows` proves that React has data to submit to LegendList; it does
not prove that Android has laid out a native cell. `ConversationList` therefore
keeps the skeleton above the mounted list until LegendList `onLoad`,
`readyToRender`, or `onFirstVisibleItemChanged` confirms native layout. This is
not the old placement shimmer: once native layout exists, placement may continue
without covering the warm window. If the placing budget or user ownership moves
the machine to `ready`, the guard yields to that terminal decision.

`hasPaintableRows` is derived during render from the subscribed window (§5.4)
and reaches the reducer only through `dataFactsChanged`, which the machine uses
for _transitions_. It is **never stored in `OpenState`** — copying store data
into machine state would be the C4 violation this whole design exists to remove.
The selectors stay pure; they simply take two arguments.

**Why I1/I2 are stated in terms of `hasPaintableRows` rather than
`status × source`.**

An earlier draft carved out an exception: warm `placing` mounted the list at
opacity 0 with no skeleton. That is _faithful_ to v2's
`shouldHoldWarmChatPlacement`, which does return `true` for a `seeded-target`
open whose placement is unconfirmed — but it ports a workaround together with
its failure mode, and the resulting visual (no rows, no skeleton, no error) **is
B1**.

Three reasons it does not survive into v3:

1. **It is the state PR #174 already patched away.** #174's fix was
   _shimmer-during-hold_ (`22879cf`) — v2 on HEAD shows a skeleton during a
   seeded-target hold, never nothing. Re-specifying "concealed + no skeleton"
   would revert that fix without replacing it.
2. **It contradicts this document's own timeout rationale** (below): _"at
   `placing` we have the data; withholding it is strictly worse than showing it
   imperfectly"_. Warm `placing` is exactly the case where we have the data.
3. **The reason v2 concealed is gone.** v2 hid warm rows because placement could
   land visibly wrong — estimated row heights fed `scrollToIndex`, which then
   corrected in view. v3 removes that cause (single-pass paint, deterministic
   heights via `getFixedItemSize`, declarative `initialScrollIndex`, §6.2–6.3).
   Only the blank screen would have survived the port.

The `status × source` formulation was also **too narrow**, which is the second
reason for the change. When a warm window exists but does _not_ contain the
target, the machine enters `loading`, not `placing` — and a `status`-keyed rule
would put a skeleton over rows we are already holding. The three v2 cases being
ported as spec all say otherwise: _"does not conceal warm rows when the target
has not arrived yet"_, _"lets cached notification rows paint while the live
query hydrates"_, and _"still shows the skeleton when there **genuinely** is no
warm data"_ — that "genuinely" is the whole rule. So the predicate is a **data
fact**, not a status: skeleton iff there is nothing paintable.

What v2's two "no second shimmer" cases actually assert is the _absence of a
second shimmer over warm content_
(`"never shows the skeleton while the warm window is on screen"` — the window is
**on screen**), which I2 preserves exactly. They are re-expressed against
`hasPaintableRows`, not ported literally as concealment.

**Decision, not a remark — the designated fallback.** If Phase 8 measures a
visibly ugly scroll correction during warm `placing`, the fallback is
conceal-**with**-skeleton (#174's answer). **Conceal-with-nothing is forbidden
in every branch.** That sentence is the entire point of the union; no
measurement result may reintroduce it.

**Timeout budgets (initial values, tuned in Phase 8 against real devices):**

| Stage       |   Budget | On expiry                                                                                        |
| ----------- | -------: | ------------------------------------------------------------------------------------------------ |
| `resolving` | 4,000 ms | `error{timeout, stage:'resolving'}` with retry **and** "Open latest"                             |
| `loading`   | 8,000 ms | `error{timeout, stage:'loading'}` with retry **and** "Open latest". Absolute; no hunt.           |
| `placing`   | 1,500 ms | reveal anyway at the best-known position, and log — a slightly-off position beats a blank screen |

Note the asymmetry: `placing` **degrades to reveal**, the other two degrade to
error. Rationale: at `placing` we _have_ the data; withholding it is strictly
worse than showing it imperfectly.

**Implementation shape:** a plain reducer (`(state, action) => state`) with an
exhaustive `switch` and a `never` check on both `state.status` and
`action.type`. Not XState — the state count is small, the repo already has
XState for the room machine, and a plain reducer keeps the file readable and
dependency-free. React's guidance for "complex state logic that involves
multiple sub-values" is `useReducer`. (Doc.)

The reducer is driven from the component by `useReducer`, and its _inputs_ (data
facts) are read via subscriptions, never copied into state.

### 5.3 L1 — Intent: validate at the edge

`Building Mobile Apps at Scale` (Deeplinks): _a deeplink is untrusted input —
validate before acting._ Expo Router agrees: params are strings-or-arrays from
an untrusted URL.

`OpenFailure` lives in a **neutral** `v3/types/openFailure.ts`, not in
`intent/`. It spans both layers — `invalid-intent` is a parse failure, while
`timeout` / `anchor-unreachable` / `offline-cold` are machine failures — so
neither layer owns it. Defined once; imported by both.

```ts
// v3/intent/parseOpenIntent.ts
export type OpenIntent = {
  intentKey: string; // surface identity only — see below. Powers I9 + I11.
  surface:
    | { kind: 'channel'; channelId: string }
    | { kind: 'thread'; channelId: string; threadId: string }
    | {
        kind: 'ticket-thread';
        channelId: string;
        threadId: string;
        ticketId: string;
      };
  hint: OpenHint;
  entry:
    | 'tap'
    | 'notification'
    | 'deeplink'
    | 'activity'
    | 'search'
    | 'share'
    | 'forward'
    | 'call'
    | 'restore';
  isColdStart: boolean;
};
```

`intentKey` is **not** a hash of the landing message. If it included
`messageId`, I11's same-conversation re-anchor could not keep the key unchanged.
Canonical form:

```
channel:${channelId}
thread:${channelId}:${threadId}
ticket-thread:${channelId}:${threadId}:${ticketId}
```

`entry` maps today's `ChatLinkSource`
(`notification | activity | deeplink | search | forward | call`) plus `tap`
(channel/DM list), `share` (share-target picker), and `restore` (process death).
`forward` and `call` are live sources in `chatOpenIntent.ts` — dropping them
would break existing links.

```ts
export function parseOpenIntent(
  raw: Record<string, unknown>,
): Result<OpenIntent, OpenFailure>;
```

Rules:

- **Zod at the boundary.** `zod@^4.1.12` is already a dependency — the raw
  params object is parsed by a schema. A parse failure produces
  `error{invalid-intent}`, which renders a real error surface. Today an
  unparseable link can enter a half-initialised state (B1).
- **`useLocalSearchParams`, never `useGlobalSearchParams`.** Expo's docs:
  `useGlobalSearchParams` _"made the background screens re-render when the URL
  route parameters changed. It can cause performance issues if overused"_; local
  params keep unfocused screens stable and preserve the previous screen's data
  on back. (Doc.) The chat screen sits in a stack under other screens — this
  matters.
- **Cold vs warm start is explicit,** not implicit in effect-fire order.
  `isColdStart` is a field, and the machine's warm-cache branch keys off it.
- **Surface resolution is the `resolving` stage's single job.**
  `resolveLocation(intent)` (snapshot first, then `getMessageForActivityV2` /
  `getConversationById`) produces a `ResolvedLocation`. The reducer accepts
  `surfaceResolved` **only in `resolving`** and builds `target` from it once.
  `hint.createdAt` is never the anchor cursor. `parseOpenIntent` still returns
  `invalid-intent` / `not-found`. Ticket redirect happens from the resolved
  surface **before** the conversation mounts.

### 5.4 L3 — Data: subscribe, never own

```ts
// v3/data/useConversationWindow.ts  — the ONLY data hook the list consumes.
export function useConversationWindow(
  intent: OpenIntent,
  target: LandingTarget,
): {
  conversations: readonly Conversation[]; // already merged (server + pending) by useMessages
  isInitialLoadComplete: boolean;
  hasReachedStart: boolean; // mapped from hasReachedChannelStart; true for threads
  initialLoadError: string | null;
  loadOlder: () => void; // no-op on threads — the thread query is the full thread
  loadNewer: () => void; // no-op on threads
  retry: () => void;
};
```

It is a **thin adapter** over `useMessages(ref)` from `@xyne/shared/messages`
(the public overload; there is no `useChannelMessages` / `useThreadMessages`
export). Channel refs return `UseChannelMessagesResult`; thread refs return
`ThreadConversation | null`. The adapter normalises those two shapes. It
contains no merge, no cache, no revision counter, no window of its own. Pending
rows are **already merged inside `useMessages`** — do not subscribe to the
pending queue a second time to build the list (that would recreate B6). Per-row
`usePendingStatusByMessageId` for failed-send chrome is allowed.

Hard rules (each is a review-blocking violation):

- No `useState` holding message data.
- No `useEffect` whose body calls a `setState` with data derived from another
  value — React: _"you don't need Effects to transform data for rendering."_
  (Doc.)
- External stores that are **not** the message window (the deferral registry,
  keyboard metrics) are read with `useSyncExternalStore`, with a **cached**
  `getSnapshot` — React's documented pitfall is returning a new object each
  call, which causes infinite re-render loops. (Doc.) The repo already uses this
  pattern correctly in `interactionCriticalWindow.ts`; v3 generalises it. The
  message window itself comes from `useMessages` — do not mirror it into another
  store.
- Resetting per-conversation state uses **`key={intentKey}`** on the surface
  component, not an effect — React: _"When a prop changes and you want to reset
  all state, use a `key` instead of an Effect."_ (Doc.) This alone deletes a
  large class of v2's "reset on open" effects and the `openIdentityKey` ref
  dance.

### 5.5 L3 — Warm cache (MMKV) and the notification path

This is the layer the user explicitly called out ("we have to fix the mmkv and
notification part so we can get and view data").

**What exists and works (Verified):**

- `src/services/mmkvStorageAdapter.ts` (932 lines) implements the shared
  `StorageAdapter`, is user- and workspace-scoped, keeps a `chatCacheIndex` with
  LRU caps (`MAX_DISK_CHANNELS = 100`, `MAX_DISK_THREADS = 50`,
  `MAX_DISK_CHANNEL_ROWS = 200`), batches query-cache writes behind a 2 s flush
  (`QUERY_CACHE_RESUME_WRITE_DELAY_MS = 2000`), and exposes **global,
  non-user-scoped keys** (`xyne-global:userId`, `:workspaceId`, `:authToken`,
  `:schemaVersion`) precisely so a background/headless notification handler can
  read the cache before the app has hydrated.
- `containsNotificationTarget` is an alias of `containsChatWindowTarget` from
  `features/chat/navigation/chatWindowContainment.ts`, re-exported by the
  adapter so warm-up, persisted-source selection, and the reader cannot drift.
- `readNotificationChatEntitySync` answers _"give me the cached entity"_;
  containment answers _"can that entity already land this exact message?"_.
- `warmZeroFromNotification.ts` uses that containment answer to decide whether
  to fetch, and falls back to `executeFallbackQueries` with a shadow-value cache
  (`WARM_SHADOW_MAX_AGE_MS` from `@xyne/shared/utils`).

**What v3 changes — the contract, not the storage:**

```ts
// v3/warm/warmWindow.ts
export type WarmWindow = {
  kind: 'channel' | 'thread';
  id: string;
  rows: readonly Conversation[];
  fingerprint: string;
  readAt: number;
  containsTarget: boolean; // decided by the shared containment module — never re-implemented
};

export function readWarmWindow(intent: OpenIntent): WarmWindow | null;
export function isAuthoritativeFor(
  live: readonly Conversation[],
  warm: WarmWindow,
  target: LandingTarget,
): boolean;
```

1. **Warm is a typed input to the machine, not an ambient side channel.**
   `readWarmWindow` is called once, synchronously, during `resolving`. MMKV
   reads are synchronous (Doc: no bridge, no promises), so this costs nothing
   and removes an entire async race from the open path.
2. **Cached-first paint is mandatory when `containsTarget`.** If the warm window
   can land the target, the machine goes `resolving → placing` **directly**,
   skipping `loading`. There is no state in which a user who has visited this
   thread before sees a skeleton. (This is what
   `"never shows the skeleton while the warm window is on screen"` in v2's suite
   already asserts.)
3. **The live window may not evict the warm window unless
   `isAuthoritativeFor`.** One pure function, one place, tested. Closes B7.
4. **Schema/version safety.** The adapter already tracks
   `chatCacheEntityVersion` and `_schemaVersion`; v3 treats a version mismatch
   as "no warm window" rather than attempting a partial read — a stale-shape
   read is exactly how a half-initialised state is reached.
5. **Freshness.** A warm window older than a bounded age is still _painted_
   (better than a skeleton) but is marked `source: 'warm'` so reveal doesn't
   wait on it and reconcile is expected.
6. **`compareBeforeSet`** — MMKV v4 supports it (Doc); enabling it on the chat
   cache instance avoids redundant disk writes on the hot path where the same
   window is re-persisted unchanged. To be validated in Phase 7.

**Notification → open sequence in v3:**

```
push tap
  └─ tapNavigation → route with params
       └─ L1 parseOpenIntent(params)                      → OpenIntent | error{invalid-intent}
            └─ machine: resolving
                 └─ resolveLocation(intent)               → ResolvedLocation | error
                      ├─ readWarmWindow(intent)
                      │    ├─ containsTarget → placing(source:'warm')      ← no skeleton
                      │    └─ null / warm miss on an anchor → loading     ← skeleton, bounded
                      │         (warm rows without the target never enter placing)
       └─ placing: mount list at LandingTarget, measure, confirm via isPlaced
            └─ ready: reveal                                ← single visual transition
```

Note there is **exactly one** reveal transition in the whole sequence. v2's
problem was that reveal was attempted from several independent places.

### 5.6 L7 — Scoped deferral (replacing the global critical window)

```ts
// v3/scheduling/deferral.ts
export type DeferralScope = 'chat-open';
export function acquireDeferral(
  scope: DeferralScope,
  budgetMs: number,
): DeferralToken; // token.release()
```

- Owned by the open session (`useChatOpen`), released in **one** teardown path.
- Budget in the low hundreds of ms, not 10,000.
- `token.defer` for named non-critical work (list badge refresh, activity
  counts, link-preview fetch) is **Phase 8**. Until then acquire/release only
  marks the open as in-flight so a global critical window is not needed.
- Non-critical work inside chat itself is scheduled with
  `InteractionManager.runAfterInteractions` or a double-rAF after first paint —
  RN's documented deferral primitives, already used in v2's `runAfterFirstPaint`
  helper (which is fine and can be lifted verbatim).

### 5.7 Read cursor

Leaving a channel marks it read up to now (v2 parity — D1). The flush is **never
dropped**: if `channel_user_status` is not loaded yet, the payload is deferred
and drained when status arrives or on the next chat mount. Additional triggers:
viewing at the tail (1 000 ms debounce) and AppState background/inactive.
Payload is
`markChannelAsViewed({ channelId, timestamp: max(newestSeen.createdAt, now), conversationId })`.
Mark-as-unread still skips the flush. Opening a **thread** marks nothing (D2, v2
parity). The unread boundary used at open is taken only from an unread-open hint, then
raised with `max(hint.unreadBoundaryAt, liveStatus.lastViewedAt)` and frozen in
`target`. A tail tap does not inherit live `lastViewedAt`.

---

## 6. The list and paint contract

### 6.1 One engine, two configurations

v2 has two hand-synced list engines (`chat-list.tsx` 2,669 + `chat-thread.tsx`
2,174 = 4,843 lines). A fix to one does not reach the other. v3 has **one**:

```ts
// v3/list/ConversationList.tsx
type ConversationListProps = {
  surface: OpenIntent['surface'];
  state: OpenState;
  rows: readonly ChatRow[];
  composer: ConversationComposer; // list owns the dock + send-scroll
  onPaginate: (edge: 'older' | 'newer') => void;
  onRowEvent: (kind: RowEventKind, row: ChatMessageRow) => void;
  onListEvent: (event: ListEvent) => void;
};
```

**Six props, not twenty-seven.** The lifecycle flags v2 threaded individually
(`liveHydrationEnabled`, `richHydrationEnabled`, `isNotificationOpen`,
`isLinkResolving`, `openStartedAtMs`, `notificationOpenKind`, `isUnreadOpen`,
`unreadBoundaryLastViewedAt`, `unreadBoundaryLastViewedConversationId`,
`unreadCount`, `entryPoint`, …) are **all** derivable from `state` and
`surface`. Threading them separately is what allowed them to contradict each
other.

Channel-vs-thread differences (reply tray, also-send-to-channel, ticket header,
"N replies" footer) are handled by **row kinds and a small config object**, not
a forked component.

### 6.2 LegendList configuration — verified against `@legendapp/list@3.3.5`

Every prop below was confirmed in the installed package's `react-native.d.ts` /
`keyboard.d.ts` and against the official v3 API reference this session. The
findings doc flagged this section as _Inferred_; it is now **Verified**. v2
already uses `KeyboardAwareLegendList` from `@legendapp/list/keyboard` — not
base `LegendList` — because that wrapper is what types
`contentInsetEndAdjustment` as `SharedValue<number>` and owns the keyboard-aware
scroll contract (`useKeyboardScrollToEnd`). v3 uses the same component.

```tsx
<KeyboardAwareLegendList
  data={rows}
  renderItem={renderRow}

  /* identity — stable server ids only. Docs: "strongly recommended … enables layout
     caching across data changes and detects duplicate keys". */
  keyExtractor={row => row.id}
  dataKey={intentKey} /* logical dataset identity: channel/thread switch */

  /* sizing — deterministic, single-pass */
  getItemType={
    getRowType
  } /* 'date' | 'unread' | 'text' | 'media' | 'ticket' | 'system' */
  getFixedItemSize={
    getFixedRowSize
  } /* exact height when known; undefined for dynamic */
  estimatedItemSize={ESTIMATED_ROW_HEIGHT}
  estimatedListSize={listSize}

  /* chat semantics — docs: do NOT use `inverted`; it "can cause animation and scroll edge cases" */
  alignItemsAtEnd
  maintainScrollAtEnd={{
    animated: true,
    on: { dataChange: true, itemLayout: true, layout: true },
  }}
  maintainScrollAtEndThreshold={0.1}
  maintainVisibleContentPosition={{
    data: true,
    size: true,
    shouldRestorePosition,
  }}

  /* landing — declarative on first mount; confirmation is isPlaced from
     positionByKey / isAtEnd, not viewport range. Reanchor is the only
     imperative scrollToIndex. */
  initialScrollAtEnd={target.kind === 'tail'}
  initialScrollIndex={
    target.kind !== 'tail'
      ? { index: landingIndex, viewPosition: 0.35 }
      : undefined
  }

  /* composer occlusion — KeyboardAwareLegendList takes SharedValue<number>; base LegendList takes number.
     Do not hand-roll the shared value: the library ships the hook that produces it —
       const { contentInsetEndAdjustment, onComposerLayout } =
         useKeyboardChatComposerInset(listRef, composerRef, initialHeight)
     (Verified: keyboard.d.ts Omits both `contentInsetEndAdjustment` and `anchoredEndSpace` from the
      base props, then re-adds them as SharedValue<number> and AnchoredEndSpaceConfig.) */
  contentInsetEndAdjustment={composerReserve}

  /* Do not pass anchoredEndSpace. keyboard.d.ts sizes that offset from the
     last index, which pins the sent row to the top of the viewport. Send
     landing uses scrollMessageToEnd instead (M12). */

  /* pagination — unchanged semantics from v2 (channel only; thread loadOlder/loadNewer are no-ops) */
  onStartReached={onLoadOlder}
  onStartReachedThreshold={1.5}
  onEndReached={onLoadNewer}
  onEndReachedThreshold={1.5}

  recycleItems
  drawDistance={DRAW_DISTANCE}
/>
```

Notes tied to specific documentation statements:

- **`inverted` is forbidden.** The chat guide's headline advice is to use
  `alignItemsAtEnd` + `maintainScrollAtEnd` instead, because `inverted` "causes
  weird behavior (in animations, etc…)".
- **`initialScrollAtEnd` / `initialScrollIndex` over imperative scrolls.** The
  guide says _"For initial load, prefer `initialScrollAtEnd` over imperative
  scroll calls in `useEffect`."_ This is the direct fix for B3's "lands then
  jumps".
- **`estimatedItemSize` is only an allocation hint** (default 100 px) and "less
  critical in v3 after items are measured". So v2's investment in tuning
  estimates is misdirected effort — the real lever is `getFixedItemSize` +
  `getItemType`. We still pass a sane estimate for the first frame.
- **Use LegendList's render-ahead lifecycle.** Pass its 250 px default as the
  configured distance. The library internally caps visible-first allocation to
  50 px until `readyToRender`, then prewarms the full buffer. The application
  must not duplicate that lifecycle with another opening-status switch.
- **Stable keys are load-bearing for jump-freedom.** The guide: _"Keep stable
  key extractors — changing keys while adjusting overlay insets discards cached
  measurements."_ v3 asserts in a unit test that `keyExtractor` returns the
  server conversation id for every row kind.
- **`recycleItems` risks state carryover.** Rows must therefore be _pure
  functions of their model_. Any row-local state uses `useRecyclingState`
  (auto-resets on recycle) — never plain `useState`.
- **`extraData` is banned.** Docs: _"Changing `extraData` causes Legend List to
  re-render all items."_ Anything that would go in `extraData` belongs in the
  row model instead.
- **`setItemSize` is the escape hatch** for the one legitimate late-measurement
  case (media dimensions arriving from cache) — the ref method exists
  specifically for this, and it updates the size without a data-change round
  trip.

### 6.3 Single-pass paint — deleting lite→rich

**v2:** `buildChatPaintRows.ts` (1,309 lines) → `ChatPaintRowLite` (873) renders
→ 420 ms later swapped for the `ChatComposer` rich path (~2,600 lines across
`conversation-composer/`), while `MessageRow` (675) separately serves stable
ticket/system rows (§1.1a). **Three renderers, three geometry authorities, one
visible jump per promoted row.**

`MessageRow`'s own header already states the correct rule — _"P5 contract:
fidelity changes content, never geometry"_ — and v3 simply generalises it to
every row.

**v3:**

```
Conversation[]  ──buildRows()──▶  ChatRow[]  ──▶  <MessageRow row={row} />
   (from shared merge)              pure, memoised          one component, one pass
```

- **One renderer.** `ChatPaintRowLite`, the `ChatComposer` row path, and
  `MessageRow` collapse into a single `MessageRow` component per row kind.
  `rowPresentationStore`, `shouldKeepChatPaintPreview`, `richHydrationEnabled`
  and the 420 ms `RICH_HYDRATION_AFTER_TRANSITION_DELAY_MS` gate are
  **deleted**, not tuned — there is no second pass to schedule.
- **One row model, no aliases.** `ChatRow` carries the v14 canonical sub-models
  only (`body`, `reactionPreview`, `replyPreview`, `mediaPreview`). All nine
  `@deprecated` v13 alias fields are **not carried forward**. Any code that
  needs `plainPreviewText` reads `row.body.markdown`.
- **Height is estimated, then measured.** Date and unread-divider rows return an
  exact `getFixedItemSize`. Message rows use `measureRowHeight` only as a
  first-pass estimate; LegendList measures the real cell and
  `useHeightViolation` records drift. System rows must not clip to the estimate.
- **Nothing may change a row's height after mount.** Enforced by:
  - media always reserving its box from `aspectRatio` (already in the model),
  - link previews rendering a fixed-height card skeleton that the fetched
    metadata fills _in place_,
  - markdown measured through the same deterministic path used for the height,
  - custom emoji reserving width from `emojiSlots[].reservedWidthPx` (already in
    the model).
- **`buildRows` is pure and file-split by concern**, each under the budget:
  `buildRows.ts` (orchestration) · `buildBody.ts` · `buildMedia.ts` ·
  `buildPreviews.ts` · `buildGrouping.ts` (avatar/name/date-pill/consecutive
  grouping) · `measureRowHeight.ts`.
- The heavy markdown/HTML conversion utilities in
  `v2/components/conversation-composer/utils/**` (`htmlToMD`, `parseInlineRich`,
  `parseCustomEmojiMarkdownSegments`, `longMessageCollapse`, `markdownStyle`,
  `mentionSchemes`) are **pure functions with no lifecycle coupling** and are
  the natural reuse candidates — but they are adopted through the §8.1 gate
  below, not copied on sight.

### 6.4 Row kinds

```ts
export type ChatRow =
  | { type: 'date'; id: string; date: number }
  | { type: 'unread-divider'; id: string; count: number }
  | { type: 'system'; id: string; ... }
  | { type: 'message'; id: string; model: MessageRowModel };
```

Row _components_ are one per `type`, each `React.memo`'d with an explicit
comparator over the model's `contentSignature` (the field already exists in the
paint model and is the right idea — it is kept).

### 6.5 `shouldRestorePosition` as a pure function

```ts
// v3/list/anchoring.ts
export type ScrollMode = 'follow-tail' | 'anchored' | 'user-owned';

export function shouldRestorePosition(args: {
  mode: ScrollMode;
  status: OpenState['status'];
  rowId: string;
  lockedRowId: string | null;
  distanceFromBottomPx: number;
}): boolean;
```

Three inputs of consequence instead of six live refs, no `listRef.getState()`
call inside the callback, and a table-driven unit test covering every
`(mode × status)` pair. `ScrollMode` transitions are themselves a two-line
reducer: `follow-tail → user-owned` on drag; `anchored → user-owned` on drag;
`user-owned → follow-tail` when the user returns to the bottom.

---

## 7. Reveal and landing policy

### 7.0 The model — two opens, one rule

**There are only two opens.** Everything else is how you arrived.

| Open | What the user means | Where we land |
|---|---|---|
| **Open the chat** — list tap, restore, share | _"Show me the conversation."_ | **Read:** the tail, following new messages. **Unread:** the divider — the first unseen message — and we do **not** follow the tail. |
| **Open a message** — notification, deeplink, activity, search, jump | _"Show me this message."_ | That row, in the right surface (channel / thread / ticket-thread), about a third of the way down. |

Those collapse into **one priority, and it never mixes**:

```
1. a named message          -> anchor
2. else an unread-open hint -> unread
3. else                     -> tail
```

**Three rules make it hold:**

1. **The unread line is frozen at tap time** — `unreadOpen=1` plus the `lastViewedAt` the list row
   carried. Live `lastViewedAt` must never rewrite it after open. Rewriting it is how the divider
   appeared and then vanished.
2. **A later resolve may not turn an anchored open into a tail pack.** Stale unread (the list
   still said unread, but every message is at or before that cursor) becomes a read/tail open.
   Live `lastViewedAt` still must not rewrite a real unread hint.
3. **Never use a parent thread's timestamp as the reply's cursor.** If the message is gone: error plus
   _Open latest_. Never reveal some other place in the list.

**Mounting follows from LegendList's contract:** it honours first-mount scroll only, so the list is not
mounted until the target is known — and unread/anchor additionally wait until that row exists. Tail may
mount straight away and pack at the end.

### 7.1 The five-way device walk — the acceptance test

Same channel, five ways in, one outcome each. If any is wrong, the model is still mixed:

- [ ] Tap, fully read -> **bottom**
- [ ] Tap, unread -> **divider, and it stays**
- [ ] Push / link / search to a message -> **that message, one paint**
- [ ] Thread-reply push -> the **reply in the thread**, not the parent in the channel
- [ ] Leave / background -> next tap is a **read open at the tail**, unless the user marked unread

### 7.2 Implementation map (verified against the code 2026-09-03)

| Rule | Where it lives |
|---|---|
| anchor > unread > tail | `machine/revealPolicy.ts` — `landingTargetFrom` |
| unread frozen at tap time | `intent/parseOpenIntent.ts` gates on `unreadOpen === '1'`; `intent/resolveLocation.ts` — `unreadBoundaryOf` reads the **hint**, never live `lastViewedAt` |
| resolve cannot weaken an **anchor** to tail | `machine/revealPolicy.ts` — `isWeakerLanding`; stale unread may become tail |
| parent timestamp is never the cursor | `resolveLocation.ts` — documented and enforced; anchor `createdAt` comes from the message/conversation query or the snapshot, never `hint.createdAt` |
| missing message -> error, never elsewhere | `resolveLocation.ts` returns `not-found`; `ConversationListError` offers **Open latest** |
| mount only when the target is known | `list/landing.ts` — `canMountConversationList`: no target -> no mount; tail -> mount; unread/anchor -> wait for `landingIndex(rows, target)` |
| open guard released | `screens/useReleaseChatOpen.ts` |
| read cursor never dropped | `read/useReadCursor.ts` — leave / background / tail-viewing flushes, with `defer` while status is unknown |

### 7.3 The three landing cases in detail


The three opening cases, unchanged in _behaviour_ from v2's (already good)
policy, but relocated from inside a 2,669-line component into pure, tested
functions.

| Case       | Trigger                                   | Landing                                     | Reveal condition                                               |
| ---------- | ----------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| **Tail**   | normal tap, no unread, no anchor          | last row                                    | as soon as any rows exist — never waits for anchored placement |
| **Unread** | unread count > 0 with a boundary cursor   | unread divider                              | rows exist **and** the divider row is positioned               |
| **Anchor** | notification / deeplink / jump-to-message | the target message at `viewPosition ≈ 0.35` | rows exist **and** the target row is confirmed placed          |

**Anchored opens reveal in two steps — do not collapse them.** v2's case
_"reveals an anchored open as soon as rows exist"_ maps to entering
**`placing`**, not `ready`. `placing` mounts the list and paints whatever rows
exist (I1 — they are never concealed); `ready` follows only once
`isLandingConfirmed(target, metrics)` passes, or the placing budget expires and
forces the reveal (I7). Collapsing the two into a single `ready` transition is
how B3 ("lands, then jumps") returns: the surface would be declared settled
while its position is still an estimate.

```ts
// v3/machine/revealPolicy.ts  — pure
export function classifyOpen(intent: OpenIntent): LandingTarget;
export function landingTargetFrom(location: ResolvedLocation): LandingTarget;
export function isLandingConfirmed(
  target: LandingTarget,
  metrics: ListMetrics,
): boolean;
```

**These functions inherit v2's existing test suite as their specification.**
`chatOpenRevealPolicy.test.ts` (761 lines, **40** `it()` cases) already encodes
hard-won rules that must not be lost. Porting is not 1:1 onto the v3 states, and
two translations must be made deliberately:

1. **`"reveals an anchored open as soon as rows exist"`** means _the list may
   mount and paint_ — in v3 that is entering **`placing`**, not `ready`. The
   rows are on screen; the position is not yet confirmed.
2. **`"never shows the skeleton while the warm window is on screen"`** is I2
   exactly as written: no skeleton over paintable rows. It is **not** a licence
   to conceal those rows. v2's `shouldHoldWarmChatPlacement` does conceal for a
   `seeded-target` open, but that conceal is a v2 workaround for
   estimated-height placement drift; v3 removes the drift and therefore drops
   the conceal (§5.2). Port the _assertion_ (no second shimmer), not the
   _mechanism_ (hold).

- `"never reveals an empty window"`
- `"reveals a tail open as soon as it has rows"`
- `"does not make a direct tail open wait for anchored placement"`
- `"does not put a second shimmer over a warm target while native placement confirms"`
- `"makes an exhausted missing anchor terminal instead of revealing unrelated rows"`
- `"does not reveal unrelated rows after an anchored target times out"`
- `"lets cached notification rows paint while the live query hydrates"`
- `"never lets a warm anchor seed render messages that do not exist"`
- `"retains the cached opening window until the live thread query completes"`
- `"does not let a partial live window evict the visited thread"`
- `"never shows the skeleton while the warm window is on screen"`
- `"still shows the skeleton when there genuinely is no warm data"`

Porting these tests is **Phase 2's exit criterion**, before any v3 UI exists. If
a v2 case cannot be expressed against the v3 union, that is a design bug in the
union and the union changes — not the test.

> Correction to the source findings doc: it reports "2 test files / 23,649
> lines". The repo actually contains `chatOpenRevealPolicy.test.ts` (761 lines,
> 40 cases) and `chatOpenIntent.test.ts` (714 lines, 25 cases) plus
> `chatKeyboardConfig.test.ts` and `awaitKeyboardHidden.test.ts` in-feature.
> Policy coverage is 65 cases, not 71. The _component_ coverage is what is
> absent.

---

## 8. Code standards — how "readable, not bloated" is enforced

These are review-blocking rules, not suggestions. Each cites the official
guidance behind it.

| #   | Rule                                                                                                                                                                                     | Source                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| C1  | **File budget ≤ 300 lines**; ≤ 400 with a one-line written exemption at the top of the file. No file in `v3/` may approach v2's 2,669.                                                   | project rule                               |
| C2  | **One component = one job.** A component either _orchestrates_ (no JSX beyond composition) or _renders_ (no lifecycle logic). Never both.                                                | project rule                               |
| C3  | **No shadow state.** `useRef` is for values that don't trigger renders (timers, imperative handles, previous-value comparison). A ref that the UI reads to decide what to draw is a bug. | React: refs are for non-render values      |
| C4  | **Derive during render; don't sync with Effects.** `"You don't need Effects to transform data for rendering."` No `useEffect` that only calls `setState` from other state/props.         | react.dev — _You Might Not Need an Effect_ |
| C5  | **Reset with `key`, not an Effect.** Switching conversation remounts via `key={intentKey}`.                                                                                              | react.dev — same                           |
| C6  | **`useSyncExternalStore` for every external store**, with a cached `getSnapshot`. Never a new object per call.                                                                           | react.dev — _useSyncExternalStore_         |
| C7  | **`useReducer` for the open lifecycle.** Exhaustive `switch`, `assertNever` default.                                                                                                     | react.dev — _useReducer_                   |
| C8  | **Discriminated unions make illegal states unrepresentable.** No pair of booleans may encode a state that a union could.                                                                 | TypeScript handbook                        |
| C9  | **`readonly` on every array/props type crossing a layer boundary.** No in-place mutation of list data.                                                                                   | TS + RN virtualization contract            |
| C10 | **Stable keys = server ids.** Never index, never a per-render uuid. Asserted by test.                                                                                                    | LegendList docs                            |
| C11 | **Rows are pure functions of their model**, `React.memo` + stable callbacks, no inline closures in `renderItem`. Row-local state uses `useRecyclingState`.                               | RN + LegendList recycling docs             |
| C12 | **`useLayoutEffect` only for pre-paint measurement**, never for lifecycle sequencing.                                                                                                    | React                                      |
| C13 | **`useLocalSearchParams`**, never `useGlobalSearchParams`, on stacked screens.                                                                                                           | Expo Router docs                           |
| C14 | **The composer never gates a send.** Connectivity/queue/retry belong to the engine.                                                                                                      | B4                                         |
| C15 | **No `extraData`** on the list.                                                                                                                                                          | LegendList docs                            |
| C16 | **Pure layers (`intent/`, `machine/`, `model/`) import no React and no react-native.** Enforced by an ESLint `no-restricted-imports` rule scoped to those folders.                       | project rule                               |
| C17 | **Every exported function in a pure layer has a unit test.**                                                                                                                             | project rule                               |
| C18 | **No `@deprecated` compatibility aliases.** v3 starts clean; a field either is the model or isn't.                                                                                       | project rule                               |

An ESLint override block scoped to `src/features/chat/v3/**` encodes C1
(`max-lines`), C16 (`no-restricted-imports`), C15, and C10 where statically
checkable, so violations fail CI rather than relying on review attention.

### 8.1 The reuse gate — code may be carried over, badly-written code may not

Reusing working logic is encouraged; **inheriting v2's quality is not.** No
file, function, or component enters `v3/` by being copied. Each candidate passes
this gate, and the outcome is recorded in the PR:

| Step                                                 | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0. Adopt-verbatim (mandatory, outranks the rest)** | Any module that _defines what the user sees_ — design tokens, theme resolution, colour palettes, spacing and measurement constants, bubble chrome — is adopted **unchanged**, whatever its code quality. These are not implementation, they are **specification**; rewriting them silently changes the product. Canonical set: `ChatRenderTokens`, `chat-render-tokens.ts`, `useSelectedChatBubbleContentTokens`, `chatPaintSizing` height constants, `getUserColor`. If genuinely unreadable, adopt first, ship parity, then clean it in a **separate** commit proven no-op by screenshot diff. |
| **1. Characterise**                                  | Write a test against the v2 implementation's _current behaviour_ first. This is what makes the move safe and is the only reason to reuse rather than rewrite.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **2. Audit against C1–C18**                          | Does it exceed the line budget? Hold shadow-state refs? Sync data in an Effect? Carry `@deprecated` aliases? Depend on React or RN inside what should be a pure layer? Any hit = it does not enter as-is.                                                                                                                                                                                                                                                                                                                                                                                        |
| **3. Decide, explicitly**                            | **Adopt** (passes clean — move it, run the characterisation test), **Refactor-then-adopt** (logic is right, shape is wrong — split, retype, drop dead branches, then move under the same test), or **Rewrite** (the logic itself is the bug, or it is entangled with the lifecycle).                                                                                                                                                                                                                                                                                                             |
| **4. Measure if it is on a hot path**                | Anything that runs per row, per frame, or per keystroke gets a measurement before adoption, not an assumption. Row building, height measurement, markdown parsing, and segment parsing are all hot.                                                                                                                                                                                                                                                                                                                                                                                              |
| **5. No dead branches**                              | v2 branches that exist only to support a v2-era workaround are deleted during adoption, not carried forward "just in case".                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Two named consequences of this gate:

- **`ChatPaintRow`'s nine `@deprecated` v13 aliases fail step 2 outright.** The
  canonical sub-models are adopted; the aliases are not (C18).
- **v2's `runAfterFirstPaint` double-rAF helper is Adopt-with-a-constraint** —
  it is fine as written, but it is a heuristic, not a guaranteed post-paint
  signal, so it may only schedule non-critical work (risk R7). Adopting it does
  not license building correctness on it.

The rule in one line: **reuse the knowledge, never the mess.**

---

## 9. Feature parity checklist — the release gate

**Provenance:** the first draft of this list was derived by walking the v2 file
tree — filename-level confidence. It was then **re-derived from the code** in a
dedicated parity audit (`chat-message-list-row.tsx`, `message-row.tsx`,
`buildChatPaintRows.ts`, `use-message-actions.tsx`,
`chat-paint-preview-policy.ts`, `chatPaint.types.ts`, the shared `MessageType`
enum). That audit found the render architecture mis-described (§1.1a) and added
**ten checklist items** the filename pass missed, plus the new §9.0
taxonomy/grouping spec and the exact action-visibility matrix. Additions are
marked in place.

**Calibration:** the rendering, row-model, grouping and message-actions sections
are now **code-confirmed**. The composer, navigation and chat-surface-chrome
sections remain **file-confirmed plus spot-checked** — every path they name
exists, but their internals were sampled, not exhausted. Phase 6's
characterisation tests are where that residue gets closed; do not treat those
sections as audited to the same depth.

**Nothing here may be dropped.** Each item ships with a manual verification note
in the plan.

### 9.0 Row taxonomy and grouping — the spec that is easiest to regress

Read from source during the parity audit. These are **not** obvious from
filenames and a v3 that gets them subtly wrong is visibly wrong on every screen.

**Taxonomy** (`chatPaint.types.ts:166–167`) — a 4 × 5 matrix:

- `ChatPaintRowType = 'message' | 'media' | 'ticket' | 'system'`
- `ChatPaintRowKind = 'CURRENT_USER' | 'OTHER_USER' | 'BOT' | 'TICKET' | 'SYSTEM'`
- `MessageType` (shared schema) `= USER | BOT | SYSTEM | FORWARDED`

**Grouping is two passes in opposite directions**
(`buildChatPaintRows.ts:815–930`):

| Rule                                   | Behaviour                                                                                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showSenderName`                       | look-**backward** — anchored to the **first** message of a consecutive group                                                                                                                                                  |
| `showAvatar`                           | look-**ahead** — `applyTrailingGroupAvatars` anchors it to the **last** message of a group, because bubbles lay out `items-end`. It is the _single source of truth_ for `showAvatar` and runs once over the fully built list. |
| DM channels                            | **no avatars and no identity at all** — every `showAvatar` forced false                                                                                                                                                       |
| `CURRENT_USER`                         | never shows an avatar, but **does** break a group for older rows                                                                                                                                                              |
| `SYSTEM`                               | carries no identity and **never breaks a group**                                                                                                                                                                              |
| `BOT`                                  | **always** shows identity **and** always shows an avatar — never grouped                                                                                                                                                      |
| `TICKET` / rows with a `ticketPreview` | never show a sender name                                                                                                                                                                                                      |
| Day boundary                           | a change in `yyyy-MM-dd` breaks a group even for the same sender                                                                                                                                                              |

Reference equality is deliberately preserved when a row's flags do not change,
so incremental rebuilds and list recycling keep working — v3 must preserve that
property, not just the visual outcome.

- [x] `rowType` × `rowKind` taxonomy represented in the v3 row model
- [x] `showSenderName` look-backward pass
- [x] `showAvatar` look-ahead pass (trailing-group anchoring)
- [x] DM: no avatars, no identity
- [x] `CURRENT_USER`: no avatar, still breaks groups
- [x] `SYSTEM`: no identity, never breaks a group
- [x] `BOT`: always identity + avatar, never grouped
- [x] `TICKET` / ticketPreview rows: no sender name
- [x] day-boundary group break
- [x] reference equality preserved for unchanged rows

### Message rendering

- [x] Plain text messages with markdown
      (bold/italic/strike/code/links/lists/quotes/headings)
- [x] Inline rich text (`rich-inline-text.tsx` / `parseInlineRich`)
- [x] Long-message collapse + "show more" (`longMessageCollapse.ts`,
      `LONG_MESSAGE_MAX_COLLAPSED_LINES`)
- [ ] Mentions — user (`MENTION_USER_SCHEME`) and broadcast
      (`MENTION_BROADCAST_SCHEME`), tappable
- [ ] Mention press → user profile sheet (`useMentionPress`, `useOpenUserDm`)
- [x] Custom emoji, inline and reserved-width
      (`parseCustomEmojiMarkdownSegments`, `useResolvedEmojiMarkdown`,
      `useMtlsEmoji`)
- [x] Emoji-only / jumbo emoji rendering (`chatPaintEmoji.ts`)
- [x] System messages (`conversation-composer-system-message.tsx`)
- [x] **Bot messages** (`MessageType.BOT` / `rowKind: 'BOT'`) with their
      always-identity, always-avatar, never-grouped layout — **missed by the
      filename-level pass**
- [ ] **Deleted-message tombstones** (`message.isDeleted`) — deleted messages
      still render, and gate 8 of the 12 actions
- [ ] **Call messages** (`isCallMessage`) and **ticket-creation messages**
      (`isTicketCreationMessage`) as distinct shapes with their own action rules
- [ ] **`showInChannel` thread replies** surfaced in the parent channel
      (`isShowInChannel`)
- [x] Per-row **expanded** state (`presentation.expanded` /
      `onRowContentExpanded`) — survives recycling
- [ ] Flow-JSON messages (`flow-json-message.tsx`, 710 lines; markdown helpers
      live in `src/utils/flowJsonMarkdown.ts`, not in v2 utils)
- [ ] Ticket cards + ticket activity rows (`conversation-composer-ticket.tsx`,
      `parseTicketMd`)
- [ ] Call-transcript cards (`components/chat/call-transcript-card`)
- [x] Forwarded-message rendering (`conversation-composer-forwarded.tsx`,
      `parseForwardedMessageXml`)
- [x] Edited indicator (`conversation-composer-edited.tsx`)
- [x] Pinned indicator (`conversation-composer-pinned.tsx`)
- [x] Bookmarked indicator + reminder indicator
      (`message-bookmark-reminder-indicator.tsx`)
- [x] Sender name + avatar + consecutive-message grouping
- [x] Per-user name colour (`getUserColor.ts`)
- [x] Timestamps (`paint-time-label.tsx`) and date pills
      (`components/chat/date-pill`)
- [x] Floating date header while scrolling
- [x] Unread divider row ("New messages", no count)
- [x] Message highlight on jump-to-message (`message-highlight.tsx`)
- [x] Row entrance animation (`chat-row-entrance.tsx`,
      `chat-row-entrance-controller.ts`)

### Media and attachments

- [ ] Image attachments with reserved aspect-ratio box (`useMtlsImage`,
      `useMtlsThumbnail`)
- [ ] Video attachments + thumbnail + duration (`useMtlsVideoStream`,
      `video-viewer-page.tsx`)
- [ ] File attachments card (`file-attachment-card.tsx`,
      `useMtlsAttachmentFile`)
- [ ] Mixed / multi-attachment layouts (`attachment-layout.ts`)
- [ ] Attachments viewer (open, swipe, download) —
      `components/attachments-viewer`
- [ ] Image download to library (`useImageDownload`)
- [ ] Media preview cache (`media/mediaPreviewCache.ts`)

### Link previews

- [ ] Stored / extracted / metadata sources; `needsMetadataFetch` flow
      (`link-preview-card.tsx`, `parseLinkPreviewMd`,
      `chat-paint-preview-policy.ts`)
- [ ] Failed preview degradation

### Reactions

- [ ] Reaction pills, grouped + counted (`reaction-pill.utils`,
      `conversation-composer-reactions.tsx`)
- [ ] Add/remove reaction; quick reactions bar
      (`QUICK_REACTIONS = ['👍','😂','✅','🙌','🎉','❤️']`)
- [ ] Full emoji picker from the actions sheet (`components/emoji-picker`)
- [ ] Reactions detail sheet — who reacted (`reactions-sheet-host.tsx`)

### Threads and replies

- [ ] Reply tray / "N replies" with replier avatars
      (`conversation-composer-replies.tsx`)
- [ ] Open thread from a channel message
- [ ] Thread screen with parent message header
- [ ] "Also send to channel" (`input-composer-also-send-to-channel.tsx`,
      `alsoSendToChannel` → `childConversationId`)
- [ ] Replied-to-thread indicator in channel
      (`conversation-composer-replied-to-thread.tsx`)
- [ ] Parent-message preview inside a reply (`ChatPaintParentPreview`)
- [ ] Ticket-thread surface (`threadTicketSurface.ts`) rendering inside
      `TicketDetailsScreen`
- [ ] Thread list embedded in xyne-desks `messages-tab`

### Message actions

Long-press actions sheet (`message-actions-sheet.tsx`,
`use-message-actions.tsx`). The list below is the **verified** action inventory
read from `use-message-actions.tsx` — every `id` is exact. All of them,
including their conditional visibility rules and destructive-confirm dialogs,
must ship in v3.

- [ ] `pending-retry` — **Retry Send** (failed send only)
- [ ] `pending-delete` — **Delete Message** (failed send only, destructive)
- [ ] `reply-in-thread` — **Reply in Thread**
- [ ] `send-to-channel` — **Send to Channel** (thread reply → parent channel)
- [x] `edit-in-chat` — **Edit in Chat**. The row carries original composer HTML;
      save updates the existing message and restores the editor on mutation
      failure.
- [x] `copy-message` — **Copy Message**. Plain text is derived from original
      composer HTML and the rich clipboard retains that HTML.
- [ ] `copy-link` — **Copy Link**
- [ ] `forward-message` — **Forward Message** → forward sheet with recipient
      picker (`forward-message-sheet-view.tsx`)
- [ ] `copy-image` — **Copy Image** (image attachments only)
- [ ] `pin` — **Pin Message / Unpin Message** (label toggles on
      `target.isPinned`)
- [ ] `bookmark` — **Add Bookmark / Remove Bookmark** (label toggles on
      `isBookmarked`)
- [ ] `remind-me` — **Remind me** → reminder options sheet
      (`message-reminder-options-sheet.tsx`, `message-reminder-config.ts`,
      `message-reminder-utils.ts`)
- [ ] `start-call` — **Start Call**
- [ ] `mark-as-unread` — **Mark as Unread**
- [ ] `delete` — **Delete Message** (destructive, with Cancel/confirm alert)
- [ ] Quick-reactions bar above the sheet (`QUICK_REACTIONS`) + "more" → full
      emoji picker
- [ ] User profile actions sheet from avatar/name tap
      (`chat-user-profile-actions-sheet.tsx`)
- [x] **Tap-to-retry directly on a failed row** — `MessageRow` calls
      `firePendingMutator(zero, pending)` when `rowPressIntent` is `retry`.
      Separate from the sheet.
- [x] **Tap on a pending row with visible status opens the actions sheet**, not
      the thread. `rowPressIntent` returns `actions` → `onLongPress`. In-flight
      healthy sends (`status === null`) fall through to `open`.
- [ ] Section dividers driven by `visibility.editInChat || visibility.delete`
      and `!visibility.markAsUnread` — rendered in `MessageActionsHost`.
- [ ] **Archived-channel read-only behaviour** (`isChannelArchived` suppresses
      edit) — in `actionFlagsFor` / `actionVisibility`. Device-verify in
      Phase 9.

**Per-action visibility — the exact matrix**, read from
`use-message-actions.tsx:163-224`. Each row is a rule that regresses silently if
reimplemented from memory. Ten flags drive the twelve non-pending actions:
`isMessageDeleted`, `isSystemMessage`, `isTicketCreationMessage`,
`isCallMessage`, `isShowInChannel`, `isOwnMessage`, `canEditMessage`,
`hasImages`, `hasTextContent`, plus the context flags `isThread`,
`isChannelArchived`, `isFirstInThread`, `hasTicket`, `repliesEnabled`.

| Action            | Visible when                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reply-in-thread` | `!isThread && repliesEnabled && (!isSystemMessage OR isTicketCreationMessage OR isCallMessage) && !isShowInChannel`                                                                  |
| `send-to-channel` | `isThread && !isShowInChannel && !isFirstInThread && isOwnMessage && !isMessageDeleted`                                                                                              |
| `edit-in-chat`    | `canEditMessage && !isChannelArchived && onEditInChat != null`                                                                                                                       |
| `copy-message`    | `!isMessageDeleted && hasTextContent`                                                                                                                                                |
| `copy-image`      | `!isMessageDeleted && hasImages`                                                                                                                                                     |
| `copy-link`       | `isThread ? true : !isMessageDeleted`                                                                                                                                                |
| `forward-message` | `!isMessageDeleted && !isSystemMessage`                                                                                                                                              |
| `pin`             | `(!isSystemMessage OR isTicketCreationMessage) && !isMessageDeleted && !isThread` — thread rows carry no pinned state, so the control is **withheld rather than shown inaccurately** |
| `bookmark`        | `(!isSystemMessage OR isTicketCreationMessage) && !isMessageDeleted`                                                                                                                 |
| `remind-me`       | `!isMessageDeleted && openReminderOptions != null`                                                                                                                                   |
| `start-call`      | `isThread && !isSystemMessage && !isMessageDeleted`                                                                                                                                  |
| `mark-as-unread`  | `!isSystemMessage && !isMessageDeleted && !isTicketCreationMessage`                                                                                                                  |
| `delete`          | `canEditMessage && !hasTicket`                                                                                                                                                       |
| `pending-retry`   | pending && `isFailed`                                                                                                                                                                |
| `pending-delete`  | pending && `canDeletePending`                                                                                                                                                        |

- [x] Every row above reproduced and **unit-tested as a table**. This is a pure
      function of flags in `v3/overlays/actionVisibility.ts`. Individual action
      ids stay unticked until `MessageActionsHost` ships.

### Composer

- [x] Rich text input (`react-native-enriched`), formatting panel
      (bold/italic/strike/code/lists/quote/link)
- [x] Mentions autocomplete list (`input-composer-mentions-list.tsx`)
- [x] Emoji picker in composer (`input-composer-emoji-picker.tsx`)
- [x] Attachment picker: camera, library, documents
      (`input-composer-attachments-sheet.tsx`)
- [x] Attachment chips with progress + remove
      (`input-composer-attachments-list.tsx`, `useDraftAttachments`)
- [x] Link insert modal (`input-composer-link-modal.tsx`)
- [x] Edit-message banner + caret preservation
      (`input-composer-editing-banner.tsx`) — note commits #175/#177 fixed caret
      jump and flicker; v3 must not regress this
- [ ] Reply tray above composer (`chat-reply-tray.tsx`)
- [x] Draft persistence + cross-device drafts (`findZeroDraftForComposer`,
      `flushComposerDraft`, `useDraft` / `draft.ts` via `@xyne/shared/messages`)
- [ ] Offline banner (`offline-composer-banner.tsx`)
- [ ] Unfocused preview state (`composer-unfocused-preview.tsx`)
- [x] Send button state + keyboard behaviour
      (`input-composer-keyboard-lifecycle.tsx`)
- [x] Composer dock geometry across keyboard show/hide, safe area,
      gesture-driven keyboard (`chatKeyboardConfig.ts`, `KeyboardGestureArea`,
      `useKeyboardScrollToEnd`)
- [ ] **Schedule send** (landed in `#171` / `3a18941`, after the original draft
      base): long-press send → `composer-schedule-host.tsx` /
      `schedule-message-sheet.tsx`; upcoming banner
      (`upcoming-scheduled-banner.tsx`); edit-scheduled composer
      (`edit-scheduled-message-composer.tsx`); drafts/sent/scheduled tab.
      Scheduling is a `delayedMessages` mutator, not the pending queue — it may
      stay offline-gated. Regular send must not.

### Navigation and open paths

- [ ] Tap from channel list / DM list
- [ ] Notification tap (channel message, thread reply, DM), cold and warm
- [ ] Deep link (`chat-deeplink.tsx`, `resolveChatLink.ts`)
- [ ] Activity screen → message / thread
- [ ] Global search → message
- [ ] Share target → chat (`share-target.tsx`)
- [ ] Jump to message from pinned/bookmarks/links surfaces
- [ ] Persisted window restore (`restorePersistedChatWindow.ts`) +
      `lastOpenChannel.ts`
- [ ] Back-handler + double-tap guard (`useFocusEffect`)
- [ ] Workspace switch mid-session (`useDeepLinkWorkspaceSwitch`)

### Chat surface chrome

- [ ] Header v3 with title, avatar, presence-free subtitle, actions
      (`src/components/chat/chat-header-v3`) — **naming collision:** these
      `*-header-v3` packages are the _current_ chrome, not this rewrite.
- [ ] Thread header (`thread-header-v3`), pinned-messages header, links header,
      canvas header
      (`src/components/chat/{thread,pinned-messages,links,canvas}-header-v3`)
- [ ] Join-channel card for non-members (`join-channel-card.tsx`,
      `useJoinableChannel`)
- [ ] Scroll-to-bottom button with correct visibility threshold
      (`ChatComposerScrollToBottomButton`)
- [ ] Empty-channel state
- [ ] **User-selectable chat bubble themes** —
      `app/(protected)/settings/chat-theme/` wired through
      `useSelectedChatBubbleContentTokens` into the row token resolver. **Missed
      by both the filename pass and the code audit** because its entry point
      lives outside `features/chat/v2/`.
- [ ] The full `ChatRenderTokens` contract applied to every row (22 scalars +
      12-colour username palette + 8-colour mention palette) — see
      [`chat-v3-visual-parity.md`](./chat-v3-visual-parity.md)
- [ ] Error state with retry (**new in v3** — v2 has no explicit error surface)

### Data behaviour

- [ ] Optimistic send + pending row
- [ ] Failed send indicator + retry + delete
- [ ] Offline queue and replay on reconnect
- [ ] Bidirectional pagination (older/newer) with correct anchoring
- [ ] Live updates while the screen is open
- [x] Read cursor / mark-as-read: leave, background, and tail-viewing flush
      (`useReadCursor`; never dropped; `conversationId` written)
- [ ] Unread count and boundary correctness
- [ ] Warm MMKV cache read on cold open
- [ ] Reconnect / foreground re-sync (`useForegroundListSyncProbe`)

---

## 10. Testing strategy

The book's Ch. 17 pyramid, applied:

**Unit (the bulk — pure layers, no renderer):**

- `parseOpenIntent` — port all **25** cases from `chatOpenIntent.test.ts`.
- `openReducer` — every `(state × action)` pair, including illegal-action no-ops
  (I9) and all timeouts (I5).
- `classifyOpen` / `canReveal` / `isLandingConfirmed` — port all **40** cases
  from `chatOpenRevealPolicy.test.ts`.
- `shouldRestorePosition` — table-driven over `(mode × status × distance)`.
- `buildRows` + `measureRowHeight` — snapshot the row model for every message
  shape in §9 (text, media, ticket, flow-json, forwarded, system,
  long-collapsed, emoji-only, with/without reactions/replies).
- `isAuthoritativeFor` (warm vs live handover).
- `keyExtractor` returns a server id for every row kind.

**Integration (React Testing Library, no device):**

- Mount the surface with a stubbed data hook; assert I1–I4 hold for every
  `(status × hasPaintableRows)` pair — including that a warm `placing` surface
  renders its rows and no skeleton, and that no combination renders nothing.
- Send while offline → `sendMessage` is called (B4 regression guard).
- Conversation switch remounts via `key` and carries no state across.

**Snapshot tests (the tier the plan was missing).** Ch. 17 treats snapshot
testing as its own cheap tier — _"A page is spun up, a screenshot taken and
compared to a stored image… cheap to build, and can help with faster iteration
cycles"_ — and the industry numbers it quotes (Airbnb ~30,000 screenshot tests;
Uber "thousands") show how heavily it is leaned on. Chat is an ideal fit: ~20
message shapes whose visual regressions are otherwise only caught by eye.

- [ ] One snapshot per row kind in §9, light and dark, narrow and wide.
- [ ] Snapshots for each non-`ready` state: skeleton, error, empty.
- [ ] Mock data lives in a single labelled fixtures directory (Ch. 17's "test
      data management" warning — keep it structured and human-readable from day
      one, not after it sprawls).
- [ ] Reference images are **not** committed if the set grows past a few hundred
      (Ch. 17: they "take up lots of space which slows repo checkouts"). Start
      committed; revisit at that threshold.

**Adversarial network testing (Ch. 32).** Two practices from the book, both
cheap and both directly aimed at the bugs users reported:

- [ ] **Inject latency and drop requests on dev builds.** Wave _"drop 10% of the
      network requests on development builds and add latency at the networking
      layer… This approach reminds people to minimize roundtrips, to build good
      'loading' UIs and to make every mutation idempotent."_ Every one of those
      three is a v3 goal.
- [ ] **A slow-network day.** Uber ran the beta app with throttled traffic every
      Thursday. Even an occasional throttled session on the chat surface
      surfaces stalls that a fast office network hides.
- [ ] **Treat "very slow" as offline.** Ch. 7: _"A robust solution is to treat
      this as offline and perhaps notify the user."_ Our stage timeouts already
      do this structurally — a stalled `loading` becomes a visible error rather
      than an endless shimmer.

**Manual QA matrix (Phase 8 — every cell):**

|                                | cold start | warm (app open) | backgrounded |
| ------------------------------ | ---------- | --------------- | ------------ |
| **tap from list**              | ☐          | ☐               | ☐            |
| **notification, channel msg**  | ☐          | ☐               | ☐            |
| **notification, thread reply** | ☐          | ☐               | ☐            |
| **notification, DM**           | ☐          | ☐               | ☐            |
| **deep link**                  | ☐          | ☐               | ☐            |
| **activity → message**         | ☐          | ☐               | ☐            |

× each of: **cached / uncached** · **online / offline / flaky** · **unread / no
unread** · **short channel / long history** · **iOS / Android**.

Plus these rows, which the matrix above does not cover and which map to B11–B13:

- **abandon mid-open** — tap a chat and immediately hit back; tap chat A then
  chat B before A loads
- **in-place re-anchor** — tap a notification for the conversation already on
  screen
- **process death** — force-kill from the app switcher with a chat open,
  relaunch
- **background → foreground** with new messages having arrived meanwhile
- **captive-WiFi** — connected to a portal that reports online but passes no
  data (Ch. 7: _"The OS could report the user being online; however, this might
  not be the case"_)

**Exploratory testing.** Ch. 18: great testers _"attempt to 'break' the app
using creative steps that do not occur to engineers, but which end users will
employ, regardless. Except that unlike users — who often quietly churn and do
not report anything — these testers will provide detailed steps."_ Budget an
explicit exploratory session on the chat surface before rollout; the checklist
above will not find what it does not already imagine. And per Ch. 18, leave time
**to fix** what it finds, not just to run it.

**Performance gates — measured at p95, not average.** Ch. 32: _"Using a p95
measurement point is a sensible choice for mobile because this will give you the
number that most people experience, not counting the slowest 5%, which will
likely include people on slow devices or with well below average connectivity."_
An average hides exactly the users we are trying to fix.

| Metric                                                                              | Gate (p95)                               | Why this metric                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tap → first painted row, warm cache                                                 | **< 150 ms**                             | the perceived "instant open"                                                                                                                                                           |
| tap → `ready`, uncached, good network                                               | **< 800 ms**                             | Ch. 32's "latency of loading screens"                                                                                                                                                  |
| **silent-failure rate** — chat opens ending in `error` or hitting any stage timeout | **< 0.1%**                               | the measurable form of G1/G2. Ch. 6 frames crashes this way (≥ 99.99% crash-free = world class); a blank screen is the silent cousin and deserves the same numeric target              |
| slow rendering frames while scrolling                                               | **< 0.1% of frames**                     | Ch. 32's definition                                                                                                                                                                    |
| frozen frames                                                                       | **none**                                 | Ch. 32's definition                                                                                                                                                                    |
| post-mount height changes for visible rows                                          | **zero**                                 | instrumented via `onItemSizeChanged` in a debug build; any hit is a G4 violation                                                                                                       |
| **chat MMKV store size**                                                            | bounded and shrinking under the LRU caps | Ch. 32 lists _"local store size… to ensure cache eviction policy works properly"_ as a first-class metric. Our caps (100 channels / 50 threads / 200 rows) are asserted, never assumed |

**Measure proactively, not only in production.** Ch. 32: _"avoid relying on APMs
to catch specific performance problems — you will not be able to react quickly
enough."_ On mobile there is no rollback (Ch. 2), so a regression caught in
production is a regression users live with for a release cycle. These numbers
are therefore taken on real devices during Phase 8, before rollout — not
discovered from a dashboard afterwards.

---

## 11. Risks, open questions, deferred work

| #   | Item                                                                                                                                                 | Position                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **`TicketDetailsScreen` + xyne-desks `messages-tab`** consume the v2 thread list. Several other surfaces import v2 utils/rows/actions (design §3.3). | **Decided:** `TicketDetailsScreen` is **in scope** and migrates in Phase 9a. **xyne-desks `messages-tab` is deferred to Phase 9b.** Non-list imports are Phase 9c. Consequence: v2 stays on disk past the v3 chat rollout until 9b **and** 9c land. Phase 11 (delete v2) is gated on both, not on rollout.                                                                                                                                                                                                                                                                                            |
| R2  | **MMKV vs SQLite read model.** A separate plan proposes an SQLite chat read model.                                                                   | **Decided: MMKV for v3. SQLite is deliberately deferred** until chat is fixed and we have real confidence in how sync, new-message arrival, and optimistic reads behave — that confidence is a prerequisite for designing the local table and its queries, not an output of it. v3 is therefore built **swappable, not built for SQLite**: `readWarmWindow` (§5.5) is the seam, and no layer above it may know where rows came from. Do not add speculative SQLite scaffolding now — an unused abstraction built for an unbuilt system is exactly the bloat this rewrite exists to remove. See §11.1. |
| R3  | **Presence layer** — typing indicators, read receipts, online/last-seen, "N new ↓" jump pill. Absent in v2 (Verified).                               | Typing/receipts/presence need backend support → **out of scope**, tracked separately. The **jump-to-latest pill** needs no backend and _is_ in scope (§9, "scroll-to-bottom button").                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R4  | **`react-native-enriched` composer** is a third-party rich-text input; v3 reuses `components/input-composer` rather than rewriting it.               | The composer's _integration_ (docking, geometry, send path) is v3; the input widget itself is not. **Phase 6b removed the `send()` offline early-return (B4).** Schedule-send offline gating may stay.                                                                                                                                                                                                                                                                                                                                                                                                |
| R5  | **Zero query shape** may need a new query for a genuinely atomic "window around message N" fetch to make anchored opens single-round-trip.           | Flag if Phase 5 measurement shows anchored opens need it. Would be the one sanctioned `@xyne/shared` addition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R6  | **Rollout regression risk** — v3 flag defaulting to `true` for all users at once.                                                                    | Staged: internal → % rollout → 100%. Kill switch at every stage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| R7  | **The `runAfterFirstPaint` double-rAF helper** is a heuristic, not a guaranteed post-paint signal.                                                   | Acceptable (it is what RN offers) but v3 must not build correctness on it — only non-critical scheduling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 11.1 What "swappable, not built for" means in practice

The SQLite read model is a real future direction, and v3 must not make it
harder. It also must not pay for it today. The line between those two:

**Do now (costs nothing, preserves the option):**

- Keep `readWarmWindow(intent) → WarmWindow | null` as the _only_ way rows enter
  from local storage. Nothing above L3 knows whether that came from MMKV,
  SQLite, or nowhere.
- Keep the row model (`ChatRow`) independent of storage shape — it is built from
  `Conversation[]`, and `Conversation` is the shared engine's type, not a
  storage type.
- Keep `isAuthoritativeFor` (live-supersedes-local) as one pure function.
  Whatever the store becomes, that rule does not change.
- Instrument the questions SQLite will need answered: how often the warm window
  is a hit, how stale it is when hit, how often a live window supersedes it, how
  large the store grows. **This telemetry is the input to the SQLite design.**
  Phase 8 collects it as a side effect of the perf work.

**Do not do now:**

- No storage abstraction layer, no repository interface, no adapter registry, no
  "pluggable backend". One concrete implementation behind one function is
  already swappable.
- No schema design, no migration scaffolding, no query-builder.
- No changes to Zero queries in anticipation of local tables.

When the SQLite work starts, it replaces the body of `readWarmWindow` and adds a
write path. If v3 is built as specified, that is the blast radius — and by then
the telemetry above will say what the local tables and their queries actually
need to be.

---

## 12. Scale-engineering requirements — _Building Mobile Apps at Scale_, chapter by chapter

Read first-hand from the PDF. Each row is a lesson, our status, and where v3
acts on it. Rows marked **NEW** are requirements this reading added that the
earlier digest-based pass did not surface.

| Ch.                                   | Lesson (the book's words)                                                                                                                                                                                                                                                             | v2 status                                                 | v3 requirement                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** State Management                | _"Most bugs and unexpected crashes are usually caused by an unexpected or untested combination of events and the application's state becoming corrupted… a common problem area with apps where global or local states are manipulated by multiple components unknown to each other."_ | ❌ ~32 refs are a second source of truth beside the store | The union + reducer (§5.2). Exactly the described failure mode.                                                                                                                                                          |
| **1**                                 | _"Keep state as immutable as possible, storing models as immutable objects that emit state changes."_                                                                                                                                                                                 | ⚠️ store yields new snapshots, but the view re-owns them  | `readonly` at every layer boundary (C9); the view subscribes (§5.4).                                                                                                                                                     |
| **1**                                 | _"The challenge becomes deciding which component owns listening to these [global] state changes."_ Screens listening individually → duplication; a forwarder → tight coupling.                                                                                                        | ❌ the composer listened to connectivity itself           | **This is B4's root cause named by the book.** v3's answer: connectivity is owned by the send engine alone; no chat component reads it (C14).                                                                            |
| **1**                                 | _"It is the app developer's responsibility to react to application state changes, save state, and to restore the app to where it was running."_                                                                                                                                       | ⚠️ persistence exists, restore is a separate path         | **NEW** → B13. Process-death restore is an `OpenIntent` with `entry: 'restore'`, travelling the same five states.                                                                                                        |
| **2** Mistakes Are Hard to Revert     | _"Once a user updates to a version with a client-side bug, they are stuck with that bug until a new version is released."_ iOS review 24–48 h; Android can exceed 7 days; _"you can not assume that all users will get this updated version, ever."_                                  | n/a                                                       | **NEW** → §3.2. v3 stays **off by default**. Enable locally from Settings (dev). Not CAC, not a build-time flag. Frozen v2 remains plan B.                                                                               |
| **4** Deeplinks                       | _"The solution that results in the least amount of non-deterministic behavior is to reset the app's state fully when receiving a deeplink. However, there might be flows that you do not want to break, so plan carefully."_                                                          | ⚠️ in-place re-anchor works but is expressed in refs      | **NEW** → B12. Full reset via `key={intentKey}` is the default; same-conversation `reanchor` is the one named, tested exception.                                                                                         |
| **4**                                 | _"Backward compatibility: ensuring that existing deeplinks keep working in older versions of the app, even after significant navigation or logic changes."_                                                                                                                           | ✅                                                        | v3 changes how links are consumed, never their format. No live link can break.                                                                                                                                           |
| **5** Push & Background Notifications | _"A push notification is a glorified deeplink… Thinking about backward compatibility, state problems, and planning ahead all apply."_                                                                                                                                                 | ❌ the push path had its own half-lifecycle               | Push and deeplink share one `parseOpenIntent` → one machine. There is no notification-specific open path to drift (§5.5).                                                                                                |
| **5**                                 | _"Background notifications… introduce message deliverability issues, message order problems, and you need to combine this approach with local data caching for offline scenarios."_                                                                                                   | ✅ warm cache exists                                      | Ordering is the shared merge's job (one merge, §5.4); caching is the typed warm contract (§5.5).                                                                                                                         |
| **6** App Crashes                     | _"Reduce crashes to a stability level that means less than one in 10,000 sessions are impacted… 99.99% or above is world-class."_                                                                                                                                                     | ⚠️ no crash, but "blank" is silent degradation            | **NEW** → §10. A **silent-failure rate < 0.1% of chat opens**, measured, tracked like a crash rate. "No blank screens" becomes a number.                                                                                 |
| **7** Offline Support                 | _"Reliably detecting when the phone is offline. The OS could report the user being online; however, this might not be the case"_ (captive portals).                                                                                                                                   | ⚠️                                                        | **NEW** → never gate UX on a connectivity boolean. Sends always enqueue; the stage timeouts, not a flag, decide when to show failure. Captive-WiFi is a QA row (§10).                                                    |
| **7**                                 | _"Decide which features should work offline and which ones should not. Many teams miss this simple step."_                                                                                                                                                                            | ❌ never written down                                     | **NEW** → §12.1 below. An explicit table.                                                                                                                                                                                |
| **7**                                 | _"Push all retries on API endpoints to be safe, by having these endpoints be idempotent."_                                                                                                                                                                                            | ✅                                                        | Preserved property: `send.ts` generates the `messageId` client-side _before_ sending — that id **is** the idempotency key, which is why the offline queue can replay safely. v3 must not move id generation server-side. |
| **7**                                 | _"You might see race conditions or data issues if the first request returns, then the second request does too."_                                                                                                                                                                      | ⚠️                                                        | v3's `retry` action re-enters `loading` under the **same** `intentKey`, so I10 discards the first attempt's late callbacks. Retry cannot double-apply.                                                                   |
| **13** Navigation Architecture        | _"Asynchronous navigation… What happens when the user attempts to navigate away during this phase? If you do not plan and test for this scenario, the app can get into strange states."_                                                                                              | ❌ no single abandon point                                | **NEW** → B11 + invariant I10.                                                                                                                                                                                           |
| **13**                                | _"It usually also means lots of code duplication in instructing the app to navigate."_                                                                                                                                                                                                | ❌ 27-prop bag; two engines                               | Six props; one engine (§6.1).                                                                                                                                                                                            |
| **14** App State & Event-Driven       | _"The larger and more complex the app, the more likely bugs are caused by a combination of events that are out of the ordinary… a background push that causes a state change might arrive right after the user locks the screen."_                                                    | ❌ this is the blank screen, exactly                      | The union makes the illegal combinations unrepresentable (§5.2).                                                                                                                                                         |
| **14**                                | _"Record invalid states with information to replay or debug… You want to have a log, not just of user events, but of incoming network notifications."_                                                                                                                                | ⚠️ profiler exists, not replay-grade                      | **NEW** → §12.2 below. The open trace must be reconstructable into a bug report, not just timed.                                                                                                                         |
| **17** Automated Testing              | The four tiers: unit → integration → **snapshot** → UI. _"Snapshot tests are cheap to build."_ Airbnb ~30,000 screenshot tests.                                                                                                                                                       | ❌ no snapshot tier                                       | **NEW** → §10 gains a snapshot tier: every row kind × theme, plus every non-`ready` state.                                                                                                                               |
| **17**                                | _"Unit testing… is the safety net for making meaningful refactors and to be able to keep cleaning up tech debt."_                                                                                                                                                                     | ❌ policy is trapped in components                        | The pure layers (C16) exist precisely so the policy is unit-testable.                                                                                                                                                    |
| **17**                                | Mocked data: _"come up with a structured way to both store this data, and to label the use cases they support."_                                                                                                                                                                      | n/a                                                       | One labelled fixtures directory from day one.                                                                                                                                                                            |
| **18** Manual Testing                 | _"Exploratory testing… attempt to 'break' the app using creative steps that do not occur to engineers."_ And: leave time to **fix**, not just to test.                                                                                                                                | ⚠️                                                        | **NEW** → an explicit exploratory session + fix buffer before rollout (§10).                                                                                                                                             |
| **25** Adopting New Frameworks        | Uber's Swift rewrite _"was almost a disaster"_; _"stories like Uber's Swift rewrite should serve as reminders of what can happen when you have no 'plan B'."_ And: _"limit the blast radius."_                                                                                        | n/a                                                       | **This chapter is about us.** v3 is a rewrite. Plan B = the flag + frozen v2, which is why v2 must stay bit-identical and deletable-later rather than being refactored alongside. §12.3 states the blast-radius plan.    |
| **31** Feature Flag Hell              | _"Stale feature flags are worse than dead code… there is a very real danger of deleting non-dead code behind a feature flag."_ Conflicting flags; dependent flags.                                                                                                                    | n/a                                                       | **NEW** → §3.2 flag discipline: one owner, one expiry, one greppable pattern, no nesting, conflict check before ramp.                                                                                                    |
| **32** Performance                    | _"Using a p95 measurement point is a sensible choice for mobile because this will give you the number that most people experience."_                                                                                                                                                  | ❌ no percentile stated                                   | **NEW** → all gates are p95 (§10).                                                                                                                                                                                       |
| **32**                                | _"Local store size, if the app uses local storage… to ensure cache eviction policy works properly"_ is a first-class metric.                                                                                                                                                          | ⚠️ caps exist, unmeasured                                 | **NEW** → chat MMKV store size is a tracked metric; the LRU caps are asserted, not assumed.                                                                                                                              |
| **32**                                | _"Avoid relying on APMs to catch specific performance problems — you will not be able to react quickly enough."_ Be proactive.                                                                                                                                                        | ⚠️                                                        | Numbers are taken on real devices in Phase 8, **before** rollout.                                                                                                                                                        |
| **32**                                | Wave _"drop 10% of the network requests on development builds and add latency."_ Uber's weekly slow-network day.                                                                                                                                                                      | ❌                                                        | **NEW** → adversarial network testing (§10).                                                                                                                                                                             |
| **32**                                | Frozen frames / slow rendering frames as defined metrics.                                                                                                                                                                                                                             | ⚠️                                                        | Adopted verbatim as gates (§10).                                                                                                                                                                                         |
| **37** Client-Side Data Migrations    | _"What happens if the new version of the app has a bug which corrupts the new schema? Users can be stuck in an invalid state, where the only option… is to wipe the app."_                                                                                                            | ⚠️ versions tracked                                       | v3's `schemaGuard` returns `null` on mismatch — a corrupt or unknown-shape cache is _ignored_, never partially read. Degrading to "fetch from server" is always available.                                               |
| **37**                                | _"Carefully consider if you can make the backend the source of truth… can you build support for re-downloading data from the backend?"_                                                                                                                                               | ✅ Zero is authoritative                                  | Stated as an invariant: the MMKV warm cache is **only ever an accelerator**. Every screen it serves must render correctly with the cache empty. Tested by a "cold cache" run of the whole QA matrix.                     |

### 12.1 The offline feature matrix (Ch. 7 — _"decide which features should work offline"_)

Written down, once, so it stops being implicit.

| Capability                                | Offline behaviour                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Read a previously-visited conversation    | ✅ full — served from the MMKV warm window                                                          |
| Read a never-visited conversation         | ❌ `error{offline-cold}` with retry — **an explicit error surface, never a blank one**              |
| Send a message                            | ✅ enqueued, painted optimistically, replayed in order on reconnect                                 |
| Edit a message                            | ✅ queued as a mutation                                                                             |
| Delete a message                          | ✅ queued                                                                                           |
| React to a message                        | ✅ queued                                                                                           |
| Load older / newer pages                  | ❌ only what the warm window holds; the list shows its true boundary rather than an endless spinner |
| Attach a file                             | ⚠️ selectable and queued; upload resumes on reconnect                                               |
| Open an attachment already cached         | ✅                                                                                                  |
| Open an attachment not cached             | ❌ explicit "unavailable offline" state                                                             |
| Link preview metadata fetch               | ❌ deferred; the card renders at its reserved height with no visual shift when it later fills       |
| Jump to a message outside the warm window | ❌ `error{offline-cold}` with retry                                                                 |

The rule behind the table: **an offline limitation is always a visible,
explained state — never a skeleton and never nothing.** That is G1 restated for
the offline case.

### 12.2 Replay-grade open tracing (Ch. 14)

The book asks for more than timing: _"Record invalid states with information to
replay or debug… a log, not just of user events, but of incoming network
notifications."_ v3's `openTrace` therefore records, per open, enough to
reconstruct it:

- `intentKey`, `entry`, `isColdStart`, the raw params **as received** (so an
  invalid-intent failure can be reproduced from the actual link),
- every state transition with a timestamp and the action that caused it,
- the warm-cache decision (`containsTarget`, fingerprint, age) — the input that
  decides skeleton vs no skeleton,
- inbound events during the open: push arrival, Zero connect/disconnect, app
  foreground/background, keyboard show/hide,
- the terminal outcome, and for `error` the full `OpenFailure`.

A single trace should answer "why was this screen blank?" without a repro.
Attached to bug reports; not enabled at full sampling in production (Ch. 32:
_"doing any sort of sampling, or tracing, will have an impact on the performance
of the code"_ — beta users and a small production sample).

### 12.3 Blast radius and plan B (Ch. 25)

Uber went 100% Swift and _"the decision was almost a disaster."_ The lesson the
author draws is not "don't rewrite" — it is _"limit the blast radius"_ and
_"have a plan B."_ Concretely, for v3:

- **Plan B is v2, frozen and intact.** This is the strongest argument for the
  freeze rule in §0. A v2 that has been "cleaned up a little" alongside v3 is no
  longer a known-good fallback. Do not touch it.
- **Pilot on the smallest surface first.** Ch. 25: _"Building a smaller 'pilot'
  project with the new language or framework is a great way to get a better feel
  for it."_ Applied here: enable v3 first on the **thread** surface (fewer entry
  points, smaller blast radius) before the channel surface, and before the
  notification path.
- **Employees before users.** Ch. 25: _"Could we start by making a change, so
  that only company employees test this new setup, before we move further?"_
  This is the internal stage of the Phase 10 rollout, and it is not skippable.
- **Evaluate before committing.** The maturity check the chapter prescribes has
  been done for the one new dependency-shaped decision in this design —
  LegendList's chat contract — by reading the installed `@legendapp/list@3.3.5`
  types and the official v3 API reference (§6.2). No prop in §6.2 is assumed.

---

## 13. Summary

v3 is a from-scratch **view and lifecycle** layer for chat that consumes the
already-correct **data and send engine** unchanged. Its defining property is
that the four illegal states behind every reported bug — _held-and-unshimmered_,
_shimmering-forever_, _sent-but-unpainted_, and _anchored-and-tail-following_ —
**cannot be constructed**, because the open lifecycle is one discriminated union
with an exhaustive reducer instead of ~32 refs and ~73 effects.

Everything else follows from that: one list engine instead of two, one paint
pass instead of lite→rich, one merge instead of two, one reveal transition
instead of several, deferral scoped to a screen instead of a 10-second global,
warm-cache continuity as a typed input instead of an ambient side channel, and a
policy layer that is pure TypeScript with the existing **65** policy test cases
(25 intent + 40 reveal) as its executable specification.
