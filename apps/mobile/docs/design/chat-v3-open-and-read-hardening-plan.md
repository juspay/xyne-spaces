# Chat v3 — Open, Landing and Read-Cursor Hardening

**Status:** 9d Phases A–D landed; Phase E 9d gates green; full-app tsc/lint/jest
and Phase F still open. **Date:** 2026-09-02 **Fact-checked against:**
`fix/chat-v3` @ `807eb260` plus the uncommitted 9d working tree (`npm run
test:chat-v3` 509/509). **Companions:**
[`chat-v3-design.md`](./chat-v3-design.md) (the contract) ·
[`chat-v3-implementation-plan.md`](./chat-v3-implementation-plan.md) (build
order) · [`chat-v3-code-review.md`](./chat-v3-code-review.md) (review #2; its
§"divergences" is the prior record of code walking away from the contract).

**Question asked:** v3 is built, but opening/landing from notifications is not
100% deterministic, visited chats sometimes stay unread and re-open on an old
boundary, and the open-path code no longer reads as clean. What is the root
cause of each, and what is the _clean_ fix — WhatsApp-grade, not another patch?

**Resumability:** every task in §6 is a checkbox. A future session opens this
file, finds the first unticked box, and continues with no other context.

---

## 0. Verdict in five lines

1. The **open path has four resolvers** where the contract says one:
   `useOpenIntent`, a dead `useResolveOpenCursor`, the 335-line v2
   `chat-deeplink.tsx` host (still running under v3), and
   `useThreadSurfaceGate`'s ticket redirect. Each fills one payload gap; none
   owns the answer.
2. The **reducer drifted from §5.2**: `target` is mutated in place (I6),
   `resolving`/`loading` have no budget (I5), an anchor can enter `placing` on
   warm rows that do not contain it, and a 30 s `anchorHunt` then _force-reveals
   wherever the list is_. That is "lands on the wrong message" by construction.
3. **Placement has two mechanisms** (declarative `initialScrollIndex` +
   imperative `scrollToIndex` in a layout effect) and **confirmation checks
   "rendered", not "placed"** — `placing → ready` fires while the target is
   merely inside the render window, so the correction happens after `ready`.
4. **Mark-as-read is leave-only, timestamp-only, and silently dropped** when the
   status query has not loaded by the time the user leaves. Nothing flushes on
   background. The next list tap freezes the stale `lastViewedAt` into the
   route, and the open lands on the old boundary.
5. All four are fixable **inside `v3/` with zero `@xyne/shared` changes**: the
   message query already returns the reply `createdAt`, the parent thread and
   the ticket id; the mutator already accepts a `conversationId`; LegendList
   already exposes `positionByKey` / `listenToPosition`.

---

## 1. Symptom → root cause (all Verified by reading the cited lines)

### 1.1 "Open from notification lands wrong / late / on the parent"

| #   | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                         | Where                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | **Four resolvers.** `useOpenIntent` resolves the reply cursor in React state; `useResolveOpenCursor` rewrites the route (zero callers — dead code, still exported and referenced in comments); `chat-deeplink.tsx` runs the full v2 `resolveChatLink*` + `router.setParams` remount even when v3 is on; `useThreadSurfaceGate` runs a _second_ live `threadConversation` query only to `router.replace` to `/ticket/[id]` (the hop the user sees). | `screens/useOpenIntent.ts:52-87`, `screens/useResolveOpenCursor.ts`, `app/(protected)/chat-deeplink.tsx:65-67,124`, `screens/useThreadSurfaceGate.ts:45-58,67-87`, `navigation/chatOpenIntent.ts:205-215` (notification thread opens are routed to the deeplink host) |
| O2  | **Parent cursor mistaken for reply cursor.** `parseOpenIntent` copies `hint.createdAt` into `requestedMessage.createdAt`. On a thread-reply push that value is the _parent_ `conversation.createdAt`. `needsMessageCursor` then skips resolution because `createdAt > 0`. Thread surfaces mask it (full-thread query); it is wrong on every other surface.                                                                                         | `intent/parseOpenIntent.ts:79-86`, `screens/useOpenIntent.ts:15-18`                                                                                                                                                                                                   |
| O3  | **I6 broken.** `mergeSurfaceIntent` patches `target.createdAt` in place after `loading`/`placing` entry. `surfaceResolved` is accepted in every non-idle status. The design's `LandingTarget` also has no `messageId`; the code added one and now hunts by two identities.                                                                                                                                                                         | `machine/openReducer.ts:41-57,238-241,288-289,313`                                                                                                                                                                                                                    |
| O4  | **I5 dropped.** Only `placing` has a budget. A `loading` open whose live query never settles shimmers forever — B2 is back.                                                                                                                                                                                                                                                                                                                        | `machine/timeouts.ts:3-8`, `machine/openReducer.ts:246-247`                                                                                                                                                                                                           |
| O5  | **Anchor enters `placing` without the target** ("seeded-tail" on warm rows), then the 30 s `anchorHunt` tick calls `toReady` at whatever position the list is at. `canPaintOpen`'s third clause paints unrelated rows during anchor placing, contradicting I1 ("never flash the latest page then jump").                                                                                                                                           | `machine/openReducer.ts:111-123,272-277`, `machine/selectors.ts:18-26`                                                                                                                                                                                                |
| O6  | **Two placement mechanisms.** `initialScrollIndex` is honoured only at first mount of a `dataKey`, and is computed from `landingIndex(rows, target)` — usually `null` at mount because the target row is not in the window yet. So the imperative `scrollToIndex` in a `useLayoutEffect` (with `appliedLandingScrollRef` and two reset effects) does the real work. §6.2 forbids exactly this.                                                     | `list/legendListProps.ts:92,121-123`, `list/ConversationList.tsx:120-165`                                                                                                                                                                                             |
| O7  | **Confirmation is "rendered", not "placed".** `landingMetricsFromViewport` reports `targetPlaced` when the index lies in `viewport.start..end`, which is the render range _including_ the 250 px `drawDistance` overscan. `placing → ready` therefore fires before the row reaches `viewPosition 0.35`; the visible correction happens after `ready`.                                                                                              | `list/landing.ts:82-93`, `list/useLandingMetrics.ts:31-45`                                                                                                                                                                                                            |
| O8  | **Shadow state in the open hook.** `syncedLandingKey`, `syncedCursorAt`, `factsSeen` refs plus one 65-line effect drive `open` / `surfaceResolved` / `reanchor` / `dataFactsChanged` — the §8 C-rules pattern v3 exists to remove. A 250 ms `setInterval` polls `placing`.                                                                                                                                                                         | `screens/useChatOpen.ts:78-82,126-201`                                                                                                                                                                                                                                |

### 1.2 "Visited chat still unread; re-open lands on an old boundary"

| #   | Root cause                                                                                                                                                                                                                                                                   | Where                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| R1  | **Flush is silently dropped.** `canMarkChannelAsViewed(status)` is `false` while `status` is `undefined` (query not loaded yet). Leave fast → no mutation → channel stays unread.                                                                                            | `screens/useMarkChannelAsViewed.ts:30-36,53-55`, `components/input-composer/utils/drafts.ts:74-76` |
| R2  | **Leave-only, no background flush.** Nothing in `v3/` touches `AppState`. Backgrounded or killed while reading → never marked. Zero runs with `kvStore: 'mem'`, so a mutation queued at kill time is lost, not replayed.                                                     | `screens/useMarkChannelAsViewed.ts:44-65`, `providers/ZeroProvider.tsx:207-210`                    |
| R3  | **`lastViewedConversationId` is never written by v3.** The mutator only sets it when `conversationId` is passed; v3 (and v2) never pass it, so the only writer is `markChannelUnreadFrom`. The divider builder _prefers_ that stale id.                                      | `shared/src/zero/mutators.ts:738-786`, `model/unreadDivider.ts:64-68`                              |
| R4  | **Boundary frozen from the list row at tap time.** `openBaseChatRoute` copies the row's `lastViewedAt` / `unreadCount` into route params. A lost flush (R1/R2) ⇒ stale row ⇒ `unreadOpen=1` with an old boundary. The live `channel_user_status` is never consulted at open. | `utils/openChatRoute.ts:38-61`, `intent/parseOpenIntent.ts:60-68`, `machine/revealPolicy.ts:29-37` |
| R5  | **Timestamp is client wall-clock.** `timestamp: Date.now()` on a skewed device leaves messages with server `createdAt > now` unread.                                                                                                                                         | `screens/useMarkChannelAsViewed.ts:59`                                                             |
| R6  | **Thread read state is undefined in v3.** The mutator's activity sweep marks only root-message activities (`conv.initialMessageId === message.messageId`). Opening a thread marks nothing. v2 had the same gap; it must be a decision, not an accident.                      | `shared/src/zero/mutators.ts:855-865`                                                              |

### 1.3 "Code is not clean / tests do not give confidence"

| #   | Finding                                                                                                                                                                                                                                                                                                  | Where                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| C1  | `openReducer.ts` 385 lines, `ConversationList.tsx` 360 lines — over the 300 budget with no written exemption.                                                                                                                                                                                            | ground rule 4                                       |
| C2  | `openReducer.test.ts` (691 lines) passes **with** the drift, so some cases encode O3–O5 as correct behaviour. They must be rewritten to the contract, not preserved.                                                                                                                                     | `__tests__/openReducer.test.ts`                     |
| C3  | Screen tests are grep-based structure checks (`chatScreens.test.ts`), not behaviour. There is no test that a notification payload lands on its message, and none for the read flush being deferred or fired on background. The jest render tier (`tests/unit/**/*.test.tsx`) exists and is unused by v3. | `__tests__/chatScreens.test.ts`, `jest.config.*:15` |
| C4  | Dead / duplicated: `useResolveOpenCursor.ts`, the route half of `resolveOpenCursor.ts`, `withMessageCursor.ts`, `resolveSurface.ts` (unwired since review #2 M3).                                                                                                                                        | grep: zero callers                                  |

---

## 2. What the payload gives us, and what resolves the rest

Verified against `shared/dist/zero/queries.d.ts:14304-14350` and
`mutators.d.ts:170-205`.

| Gap in push payload                | Today                                                                                                           | Single resolver answer                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Reply-level `createdAt`            | `useOpenIntent` → `getMessageForActivityV2` in React state, skipped when the parent `createdAt` is present (O2) | `getMessageForActivityV2(messageId).createdAt` — **always** for a jump entry with a `messageId` |
| Thread parent id                   | payload `threadId` / `conversationId` when present                                                              | `.conversation.conversationId` + `.conversation.parentMessageId` (non-null ⇒ it is a thread)    |
| `ticketId` on ticket-thread pushes | `tapCache` cold-cache miss → deeplink → thread → ticket hop                                                     | `.conversation.ticketId` (nullable) ⇒ surface = `ticket-thread` before anything mounts          |
| `channelId` sanity                 | trusted from payload                                                                                            | `.conversation.channelId` — mismatch ⇒ `error{not-found}` with the raw params kept for replay   |
| Message deleted / inaccessible     | 30 s hunt then reveal somewhere                                                                                 | `.isDeleted` or `undefined` ⇒ `error{not-found}` immediately, with "Open latest" affordance     |
| Sync fast path                     | `createdAtFromSnapshotRows` (channel/thread snapshot)                                                           | same, run first; the query runs only on a miss                                                  |

One call, one shape, one place. Backend improvements (send `ticketId` + reply
`createdAt` in the push) remain welcome but are no longer _required_ for
correctness — they only skip the query.

---

## 3. Target architecture — the deltas to the contract

Everything below is a delta to `chat-v3-design.md`. Where code and contract
disagree today, this section picks the side; §7 lists the design-doc lines to
amend.

### 3.1 L1 intent: no landing decision at the edge

`parseOpenIntent` stops synthesising `requestedMessage` from `hint.createdAt`
(O2). The intent carries **hints only** (`messageId`, `conversationId`,
`threadId`, `ticketId`, `createdAt`, `unread*`). `intentKey` is unchanged
(surface identity). `withMessageCursor.ts` is deleted.

### 3.2 `resolving` owns one `ResolvedLocation`

```ts
// v3/intent/resolvedLocation.ts  (pure types)
export type ResolvedLocation = {
  surface: OpenSurface;                       // channel | thread | ticket-thread — final
  anchor:
    | { conversationId: string; messageId: string; createdAt: number }  // jump
    | null;                                                             // tail / unread
  unreadBoundary: { at: number; conversationId?: string } | null;       // frozen here, see §4.3
};

// v3/intent/resolveLocation.ts  (pure; zero.run injected)
export const resolveLocation = (
  intent: OpenIntent,
  deps: { snapshotRows; readCachedTicketId; run: RunQuery; readChannelStatus },
): Promise<Result<ResolvedLocation, OpenFailure>>;
```

Rules:

- Jump entries (`notification | activity | deeplink | search | forward`) with a
  `messageId` **always** resolve by id. Sync snapshot first;
  `getMessageForActivityV2` on a miss. `hint.createdAt` is never used as the
  anchor cursor.
- Conversation-only links (`conversationId`, no `messageId`) resolve via
  `getConversationById`.
- Surface is final after resolution: `conversation.parentMessageId !== null` ⇒
  thread; `conversation.ticketId` ⇒ `ticket-thread`. The screen redirects
  **once, before mount**, never after rows are painted. `useThreadSurfaceGate`'s
  second live query and post-mount `router.replace` go.
- Budget: `resolving` 4 000 ms (design table). Expiry ⇒
  `error{timeout, stage:'resolving'}` with retry **and** "Open latest" (tail
  open of the same channel) — never a blank screen, never a hunt.
- `surfaceResolved` is accepted **only** in `resolving` and carries the complete
  `ResolvedLocation`. The reducer builds `target` from it **once**.
  `mergeSurfaceIntent` is deleted. I6 holds again.

### 3.3 `LandingTarget` gains `messageId`; identity is one thing

```ts
| { kind: 'anchor'; conversationId: string; messageId: string; createdAt: number }
```

`landingIndex` / `windowContainsTarget` match on **`messageId` only** (row
`messageId` or `initialMessageId`). The "conversationId-or-messageId" double
match is removed. The design's `LandingTarget` is amended (it currently omits
`messageId`).

### 3.4 Machine invariants restored (I1, I5, I6, I7)

| Status      | Enter when                                                         | Budget                | On expiry                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resolving` | mount                                                              | 4 000 ms              | `error{timeout:'resolving'}`                                                                                                                                                               |
| `loading`   | location known; window cannot land yet                             | 8 000 ms **absolute** | `error{timeout:'loading'}` (retry + "Open latest"). The 30 s `anchorHunt` is deleted; with the exact `createdAt` the around-query is one page, and `useExpandTowardTarget` runs only here. |
| `placing`   | tail/unread: `hasPaintableRows`; anchor: `containsTarget` **only** | 1 500 ms              | forced reveal at best-known position + trace (the one I7 exception)                                                                                                                        |
| `ready`     | `isPlaced` (§3.5) or `userTookOwnership`                           | —                     | —                                                                                                                                                                                          |

- Anchor + warm rows that do **not** contain the target ⇒ `loading` with
  skeleton (bounded), not `placing` on the tail. §5.2 I1 as written. The
  `canPaintOpen` third clause is deleted.
- A warm window that **does** contain the target ⇒ `resolving → placing`
  directly (unchanged).
- `reanchor` is legal from `loading | placing | ready | error` with the same
  `intentKey` (design I11) and is the **only** path that changes `target`.
- `tick` is driven by one `setTimeout` per stage entry, not a 250 ms interval.
- `openReducer.ts` comes in under 300 lines by deleting `mergeSurfaceIntent`,
  `fromWarm`'s seeded-tail branch, `anchorHunt`, and `hunt`-from-`ready`.

### 3.5 One placement mechanism, one "placed" predicate

LegendList 3.3.5 exposes what we need (Verified
`@legendapp/list/react-native.d.ts:526-552,627-633`):
`getState().positionByKey(key)`, `sizes: Map<key, number>`, `scroll`,
`scrollLength`, `readyToRender`, `listenToPosition(key, cb)`, and
`scrollToIndex(...)` returning a `Promise<void>`.

```ts
// v3/list/placement.ts  (pure)
export type PlacementPlan =
  | { mode: 'declarative'; initialScrollIndex: { index; viewPosition } }   // first mount, target in rows
  | { mode: 'declarative'; initialScrollAtEnd: true }                       // tail
  | { mode: 'imperative'; index; viewPosition }                             // reanchor only
  | { mode: 'none' };
export const placementPlan = (rows, target, isFirstMountForDataKey, isReanchor): PlacementPlan;

export const isPlaced = (
  target, rowKey,
  s: { position?: number; size?: number; scroll: number; scrollLength: number; readyToRender: boolean; isAtEnd: boolean },
  tolerancePx = 8,
): boolean;
// tail   → readyToRender && isAtEnd
// unread → divider key measured && |position − (scroll + 0.35·scrollLength)| ≤ tolerance
// anchor → same as unread, on the target key
```

- Because §3.4 guarantees the target row is in `rows` before `placing`,
  `initialScrollIndex` is non-null at first mount and the declarative prop lands
  it. The layout-effect `scrollToIndex`, `appliedLandingScrollRef`, and both
  reset effects are deleted.
- `reanchor` on a mounted surface is the single imperative scroll; it awaits the
  `scrollToIndex` promise, then re-checks `isPlaced`.
- Confirmation is **event-driven**: `listenToPosition(targetKey)` +
  `listen('readyToRender')` + `onScroll` each call `isPlaced`; the first `true`
  dispatches `landingConfirmed`. `useLandingMetrics` and
  `landingMetricsFromViewport` (range check) are replaced.
- The skeleton guard stays exactly as §5.2 says: over the list until native
  layout, never over painted rows once `readyToRender` is true.

### 3.6 Deeplink host becomes a param-passer under v3

`app/(protected)/chat-deeplink.tsx` is an allowed entry file (design §3.2).
Under the flag it mounts `ChatChannelScreenV3` / `ChatThreadScreenV3` with the
raw params and **does not** run `resolveChatLink*` or `setParams`.
`chatOpenIntent.ts` (shared with v2, in `navigation/`) is not edited; its
routing of notification thread opens to the deeplink host is harmless once the
host is a passthrough. Removing that indirection is Phase 10 work and stays
there.

---

## 4. Read cursor — the clean model

### 4.1 Semantics (decision D1, recommended)

Keep v2/product parity for _what_ "read" means: **leaving a channel marks it
read up to now** (G10). Change _when_ and _how reliably_ that happens:

| Trigger                                                    | Today                          | Target                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Leave (unmount / `intentKey` change)                       | yes, dropped if status unknown | yes, **never dropped** (deferred until status resolves, or flushed on next open of any screen)                                        |
| While viewing at the tail with a live authoritative window | no                             | yes, debounced 1 000 ms after the newest row becomes visible — this is the only flush that survives a kill under `kvStore:'mem'` (R2) |
| App → background / inactive                                | no                             | yes, immediate                                                                                                                        |
| Mark-as-unread just set                                    | skip (correct)                 | skip (unchanged)                                                                                                                      |

Payload:
`markChannelAsViewed({ channelId, timestamp: max(newestSeenRow.createdAt, Date.now()), conversationId: newestSeenRow.conversationId, draft… })`.
The `conversationId` is what makes `lastViewedConversationId` truthful (R3); the
`max` closes clock skew (R5). No shared change.

### 4.2 Shape

```ts
// v3/read/readCursor.ts   (pure)
export type ReadCursor = { conversationId: string; createdAt: number } | null;
export const advanceReadCursor = (cursor: ReadCursor, newestVisible: Row | null, atEnd: boolean): ReadCursor;
export const flushDecision = (
  reason: 'leave' | 'background' | 'viewing',
  cursor: ReadCursor,
  statusKnown: boolean,
  unreadJustSet: boolean,
): { kind: 'flush'; timestamp; conversationId } | { kind: 'defer' } | { kind: 'skip' };

// v3/read/useReadCursor.ts  (screen edge)
// - advances from onViewableItemsChanged (itemVisiblePercentThreshold 50) and viewport isAtEnd
// - flushes per flushDecision; deferred flushes live in a module map keyed by channelId
//   and drain when getChannelUserStatus arrives or on the next chat mount
// - AppState listener for background/inactive
```

`useMarkChannelAsViewed` is replaced by `useReadCursor`. The monotonic cursor is
a `useReducer` (no shadow refs).

### 4.3 Unread boundary decided at open, from live truth

At `resolving`, an unread landing is created only when the tap was an
unread-open (`unreadOpen=1` / `hint.unreadBoundaryAt`). Live
`getChannelUserStatus` may then raise that boundary
(`max(hint, liveStatus.lastViewedAt)`) or cancel it when the cursor is ≥ the
newest known message — so a stale list row cannot force an old-boundary landing
(R4), and a second tap of a fully-read channel cannot inherit the previous
visit's `lastViewedAt` as a landing cursor. The boundary is then **frozen in
`target`** so the divider does not move while reading, which also satisfies
`useMessages`' latch of `lastViewedAt` on first subscribe
(`shared/src/messages/useMessages.ts:213-231`).

`insertUnreadDivider` keeps preferring `lastViewedConversationId` — it is
truthful once §4.1 writes it.

### 4.4 Thread read state (decision D2)

Opening a thread marks nothing today (R6). Options: (a) leave as v2 parity and
document it, (b) mark the thread's own activities read on leave via the activity
mark-read path. Recommend (a) for this plan (blast radius, Ch. 25) and file (b)
against the activity feature. Either way the answer is written down in §8, not
implied.

---

## 5. Testing — what "clean tests" means here

- **Reducer tests are rewritten to the contract.** Every `(status × action)`
  case still exists, but the cases that assert O3–O5 behaviour are replaced.
  Property test over `status × hasPaintableRows × containsTarget` for I1–I4;
  `tick` past each budget for I5; `target` immutability except `reanchor` for
  I6; `placing → ready` only via `isPlaced` or forced reveal for I7.
- **New pure modules get table tests**: `resolveLocation` (with an injected
  `run` and the six payload shapes from §2 — DM, channel message, thread reply
  with and without parent `createdAt`, ticket-thread reply with cold cache,
  deleted message), `placementPlan`, `isPlaced`, `advanceReadCursor`,
  `flushDecision`.
- **Notification fixtures test**: the raw payload examples in this plan's source
  (v4 tray, raw FCM thread reply) → `parseOpenIntent` → `resolveLocation` →
  `classifyOpen` → expected `LandingTarget`. This is the test that answers "will
  this push land on its message" without a device.
- **Render tier (jest)**: `useReadCursor` — deferred flush fires when status
  arrives; background flush fires on `AppState` change; leave flush passes
  `conversationId`. No LegendList needed.
- **`ConversationList` placement wiring**: a stub `LegendListRef` whose
  `getState()` returns scripted positions; assert `landingConfirmed` is
  dispatched only once `isPlaced` is true, and never on range-only visibility.
- Delete `chatScreens.test.ts` grep checks that the new tests make redundant;
  keep the structural ones that still guard C-rules (no `extraData`, no v2
  imports).

---

## 6. Plan (resumable)

### Phase A — Resolver (closes O1, O2; enables everything after)

- [x] `intent/resolvedLocation.ts` — types (§3.2).
- [x] `intent/resolveLocation.ts` — pure, injected deps; sync snapshot →
      `getMessageForActivityV2` → `getConversationById`; surface finalisation
      incl. `conversation.ticketId`; 4 s budget.
- [x] `parseOpenIntent` stops deriving `requestedMessage` from `hint.createdAt`;
      `OpenIntent.requestedMessage` removed.
- [x] `useOpenIntent` becomes `useResolveLocation(intent)` — one effect, one
      state, cancelled on `intentKey` change; dispatches `surfaceResolved` with
      the `ResolvedLocation`.
- [x] Delete `useResolveOpenCursor.ts`, `withMessageCursor.ts`, the route half
      of `resolveOpenCursor.ts`, and `resolveSurface.ts` (M3 decided: delete).
- [x] `useThreadSurfaceGate` → the ticket redirect happens from the resolved
      surface before mount; its second live query is removed.
- [x] `chat-deeplink.tsx` — v3 branch is a passthrough (§3.6). v2 branch
      untouched.
- [x] Tests: `resolveLocation.test.ts` table (§5), fixtures test for the six
      payload shapes.

### Phase B — Machine back on contract (closes O3, O4, O5)

- [x] `LandingTarget.anchor` gains required `messageId`; `landingIndex` /
      `windowContainsTarget` match by `messageId` only.
- [x] `surfaceResolved` accepted only in `resolving`; delete
      `mergeSurfaceIntent`.
- [x] Stage budgets per §3.4 in `timeouts.ts`; delete `anchorHunt`; `loading`
      expiry ⇒ error with retry + "Open latest".
- [x] Anchor may enter `placing` only with `containsTarget`; delete the
      seeded-tail branch and the `canPaintOpen` third clause.
- [x] `useChatOpen` — remove `syncedLandingKey` / `syncedCursorAt` /
      `factsSeen`; one `setTimeout` per stage instead of the 250 ms interval;
      `dataFactsChanged` keyed on `facts` identity only.
- [x] `openReducer.ts` ≤ 300 lines.
- [x] Rewrite `openReducer.test.ts` cases that encoded the drift; add the I1–I7
      property tests (§5).

### Phase C — One placement, one predicate (closes O6, O7)

- [x] `list/placement.ts` — `placementPlan`, `isPlaced` (§3.5) with table tests.
- [x] `ConversationList` — delete the layout-effect `scrollToIndex`,
      `appliedLandingScrollRef`, both reset effects; wire `initialScrollIndex`
      from `placementPlan`; `reanchor` awaits one `scrollToIndex`.
- [x] Replace `useLandingMetrics` + `landingMetricsFromViewport` with
      `listenToPosition` / `readyToRender` / `onScroll` → `isPlaced` →
      `landingConfirmed`.
- [x] `ConversationList.tsx` ≤ 300 lines (move keyboard/composer wiring to a
      hook if needed).
- [x] Stub-ref test: `landingConfirmed` only on `isPlaced`.

### Phase D — Read cursor (closes R1–R5)

- [x] `read/readCursor.ts` — `advanceReadCursor`, `flushDecision`, table tests.
- [x] `read/useReadCursor.ts` — viewability + `isAtEnd` advance; debounced
      viewing flush; leave flush; `AppState` flush; deferred-flush map drained
      on status arrival / next mount; passes `conversationId` and
      `max(createdAt, now)`.
- [x] Replace `useMarkChannelAsViewed` in `ChatChannelScreen`; keep the
      mark-as-unread skip.
- [x] `resolveLocation` computes `unreadBoundary` from `max(hint, live status)`
      (§4.3); `classifyOpen` reads it from the resolved location, not from
      `facts`.
- [x] Jest render tests for the three flush paths (§5).
- [x] Record D2 (thread read state) in §8.

### Phase E — Cleanup and docs

- [x] grep: no `requestedMessage`, no `withMessageCursor`, no
      `useResolveOpenCursor`, no `anchorHunt`, no `setInterval` in `v3/`.
- [x] Apply the §7 design-doc amendments; add this plan to the implementation
      plan's Phase 9 as 9d.
- [x] 9d files: `tsc` clean, v3 eslint (incl. `ConversationList` ≤ 300),
      `npm run test:chat-v3` 509/509.
- [ ] Full-app `tsc --noEmit` / `lint` / `test:render` — remaining `tsc` errors
      are pre-existing at `807eb260` (not 9d): `drafts.ts`, v2
      `useFlowMessageAction.ts`, `flowAction.ts`,
      `schedule-message-sheet.test.tsx`. `test:render` needs `expo-modules-core`
      in this workspace.

### Phase F — Device matrix (needs the flag on)

- [ ] Push tap: DM · channel message · thread reply (parent `createdAt` present)
      · ticket-thread reply with cold cache — each lands on the notified
      message, one visual transition, no hop.
- [ ] Same four with the chat cache wiped (Ch. 37 — cache is an accelerator).
- [ ] Visit channel with unread → leave fast (< 300 ms) → list shows read.
- [ ] Visit channel → background app → list shows read; force-kill while at tail
      → list shows read.
- [ ] Mark as unread → leave → still unread.
- [ ] Deleted-message push → `not-found` with "Open latest" in < 1 s, no
      shimmer.
- [ ] Airplane mode push tap on a visited thread → warm rows, target placed, no
      skeleton.

---

## 7. Design-doc amendments (apply in Phase E)

| Section                           | Change                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| §5.2 `LandingTarget`              | anchor gains `messageId: string`; note identity is `messageId` only                                                          |
| §5.2 invariant I5 / timeout table | `loading` 8 000 ms absolute; `resolving` 4 000 ms; remove any "hunt" wording                                                 |
| §5.2 I11                          | unchanged; note `reanchor` is the only imperative scroll                                                                     |
| §5.3                              | `OpenIntent` loses `requestedMessage`; add `ResolvedLocation` and `resolveLocation` as the `resolving` stage's single output |
| §5.5 sequence                     | `resolveSurface(intent)` → `resolveLocation(intent)`; add the "warm rows without target ⇒ loading, not placing" line         |
| §6.2                              | add `positionByKey` / `listenToPosition` as the confirmation source; strike the viewport-range wording                       |
| §7 table                          | Anchor reveal condition = `isPlaced`, defined in §3.5 here                                                                   |
| §9 Data behaviour                 | "Read cursor / mark-as-read" → link to §4; add "flush on background" and "never dropped"                                     |
| new §5.7                          | Read cursor contract (§4 of this plan, condensed)                                                                            |

---

## 8. Decisions to confirm

| #   | Decision                                                                                                  | Recommendation                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| D1  | Read semantics: whole-channel read on leave (v2 parity) vs partial read up to the newest seen row (Slack) | **Parity now.** The cursor already carries what partial-read needs; flip later behind the same `flushDecision`. |
| D2  | Thread read state                                                                                         | **Document as v2 parity (nothing marked);** file activity-side work separately.                                 |
| D3  | `loading` expiry affordance                                                                               | **Error with retry + "Open latest"** (tail open of the same channel). Never a silent reveal elsewhere.          |
| D4  | `chatOpenIntent.ts` routing notification threads to the deeplink host                                     | **Leave for Phase 10;** the passthrough makes it harmless.                                                      |
| D5  | Backend: send `ticketId` + reply `createdAt` in push metadata                                             | **Still ask.** It turns the resolver's query into a cache hit; it is no longer a correctness dependency.        |
