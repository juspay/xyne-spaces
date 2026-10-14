# Deep-link open: window sizing, pagination, shimmer policy, long-press

Status: plan, no code changes made
Related: `deep-link-final-review.md`, `deep-link-unified-open-plan.md`

## The reframe

Previous rounds fixed the **render** layer (row self-sufficiency, draw distance,
placeholder conditions). The symptom persists because the defect is in the
**window** layer:

- The list holds ~6–7 rows because the *window* is ~6–7 rows.
- Scrolling shows blank because you reach the end of that window and pagination
  is disabled.
- It resolves at ~20s because that is when the live query materializes and
  finally supplies both more rows and the flags that re-enable pagination.

Rendering changes cannot manufacture rows that were never fetched. Fix the
window and the pagination gates; the render layer is already close to correct.

## Root causes

### R1. Pagination is gated on flags that are false until live load completes

In `chat-list.tsx`:

```
hasMoreBefore = !hasReachedChannelStart
hasMoreAfter  = newConversationsAnchor !== null
```

`newConversationsAnchor` is null before the live query resolves, so
`hasMoreAfter` is **false**. `onEndReached` then early-returns. Scrolling down
past the cached window does nothing, forever, until live lands.

The correct semantics while the window is partial: **unknown means "assume more
exists"**, not "assume none". A false negative here is a dead scroll; a false
positive is one wasted request that returns empty.

### R2. `didUserScroll` gates the first pagination

Both `onStartReached` and `onEndReached` early-return unless
`scrollStateRef.current.didUserScroll` is true. The intent is to stop
programmatic anchor scrolls from triggering pagination. But the flag is a proxy,
and on a deep-link open the anchor scroll and the user's first drag can
interleave such that a legitimate scroll is dropped.

Replace the proxy with the precise condition: ignore pagination **while an
anchor scroll animation is in flight**, and re-enable the moment it settles.

### R3. The linked window is never explicitly sized

The deep-link path renders whatever the cache happens to hold around the target
plus whatever live eventually returns. Nothing requests "a page of N around this
cursor" up front. A cache that holds 7 rows near the cursor produces a 7-row
screen.

### R4. `canRenderMessages` can be false while messages exist

`canRenderBeforeComplete` enumerates `openKind` values (`recent | linked |
timestamp | unread | notification`). Any other kind, with `dataState !==
'complete'`, yields `canRenderMessages === false` → `paintRows =
EMPTY_PAINT_ROWS` → `displayRows.length === 0`, while `isInitialLoading` is
false because `messages.length > 0`.

Result is state-dependent: either a blank screen, or — in the ordering where
`isInitialLoading` is still true — **shimmer while data is present**. This is the
"sometimes we have data but are still stuck in shimmer" case.

### R5. Long press can be a silent no-op

`paintRowToActionsTarget` returns `null` when `row.messageId` is absent. The
guard is correct (a conversationId must never be treated as a messageId), but the
caller does nothing with `null`, so the gesture dies silently. If cached paint
rows lack `messageId`, every long press on them is inert — which matches "long
press does not work at first".

**Unverified hypothesis.** Confirm before building on it: log a breadcrumb when
`conversationItemToActionsTarget` returns null, including whether the source was
a paint row and whether `messageId` was present. One deep-link open answers it.

## The fix

### Part 1 — Make the window real

**1.1 Size the linked window explicitly.** When the route carries
`conversationId + createdAt`, request a page of at least ±25 rows around that
cursor as the *first* query, not as a later expansion. The user must land with
scrollable context in both directions.

**1.2 Treat unknown pagination as "more exists".** While
`isInitialLoadComplete === false`, both `hasMoreBefore` and `hasMoreAfter` must
evaluate to `true` unless positively known otherwise (`hasReachedChannelStart`
for the older edge; nothing yet for the newer edge). Only after initial load
completes may `hasMoreAfter` fall back to the `newConversationsAnchor` check.

**1.3 Replace the `didUserScroll` pagination gate.** Introduce an explicit
"anchor scroll in flight" flag, set when a programmatic scroll-to-index starts
and cleared on settle. Pagination checks that flag instead of `didUserScroll`.

**1.4 Let the bounded expansion pass run earlier.** The expansion effect
currently returns when `openPhase === 'paintOnly'`. With 1.1 and 1.2 in place it
should run as soon as any window exists and the target is known, bounded by the
existing pass counter.

### Part 2 — One shimmer policy, three states

Compute a single `windowState` in one place and derive everything from it. No
other condition may show or hide the skeleton.

| State | Condition | UI |
| --- | --- | --- |
| `empty` | no rows, and none ever rendered this cycle | shimmer, bounded |
| `usable` | rows present | render rows — **never** shimmer |
| `transient` | no rows now, but rows rendered earlier this cycle | keep the previous rows |

Rules that follow:

- **Delete the `canRenderBeforeComplete` openKind enumeration.** Make it plain
  `hasMessages`. Rows in the local window are usable UI regardless of how the
  chat was opened. An allowlist of open kinds will keep leaking new cases.
- **Add a `hasEverHadRows` ref per open cycle.** Once true, the screen may never
  regress to shimmer. This is what prevents the "data arrives, then shimmer
  returns" flicker.
- **Bound the shimmer.** After ~3s in `empty`, show an explicit "couldn’t load —
  retry" state. An indefinite shimmer is indistinguishable from a hang.
- The shimmer is for `empty` only. A partial window is `usable`.

### Part 3 — A long press must never be silent

**3.1 Confirm R5 first** with the null-target breadcrumb described above.

**3.2 Guarantee addressability.** A paint row without a `messageId` is not an
addressable message and should not render as one. Prefer making `messageId`
required on message-kind paint rows so the failure becomes a type error rather
than a dead gesture.

**3.3 Never no-op.** If a target genuinely cannot be built, still respond —
open the sheet with the minimal always-safe set (copy link, reply) or show a
brief inline "preparing actions" state. Silence reads as a frozen app and is the
single worst outcome for perceived quality.

**3.4 Keep the `isPaintOnly` gating** already in place for edit/delete/pin, and
extend it to `forwardMessage` when `hasAttachment` is true (see the attachment
inconsistency in `deep-link-final-review.md` §2).

## Order of work

1. **R5 breadcrumb** — one deep-link open confirms or kills the long-press
   hypothesis. Cheapest, highest information.
2. **1.2 + 1.3** — pagination gates. Likely fixes the blank-on-scroll on its own,
   because the window can finally grow on demand.
3. **Part 2** — shimmer policy. Fixes both "blank with data" and "shimmer with
   data" in one change.
4. **1.1** — explicit window sizing. Makes the first paint genuinely useful
   instead of merely non-blank.
5. **Part 3** — long-press hardening, informed by step 1.
6. **1.4** — expansion timing, last; it is an optimization once the above hold.

## How to verify each

Use the diagnostics already added to `chat-list.tsx`.

| Fix | Check |
| --- | --- |
| 1.2 / 1.3 | `pagination_ignored` breadcrumbs disappear on a deep-link open; `pagination_requested` fires on the first drag |
| 1.1 | `messages` count at first paint is ≥ 40, not ~7 |
| Part 2 | `paintGateReason` is never `hydrating_policy` with `messages > 0`; skeleton never shown when `displayRows > 0` |
| Part 3 | No null-target breadcrumbs; long press works on the first painted frame with the network disabled |
| Overall | With live query artificially delayed, the screen is fully usable — scroll, paginate, long press — before it lands |

The last row is the real acceptance test: **the screen must be completely
usable without the live query.** If it is, the 6–18s materialization stops being
a user-visible defect regardless of what causes it.

## Still worth separating

The 6–18s live materialization is a genuine backend/query problem. This plan
makes it invisible rather than fixing it. That is the right order — but once the
UX is stable, the latency deserves its own investigation.
