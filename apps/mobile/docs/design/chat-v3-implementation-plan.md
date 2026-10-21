# Chat v3 — Implementation Plan

**Status:** Phase 9 screens + 9a landed (v3 list mounts behind the flag). **9d
(open/landing/read hardening, 2026-09-02) is the next work** — see
[`chat-v3-open-and-read-hardening-plan.md`](./chat-v3-open-and-read-hardening-plan.md).
9b/9c and design §9 device ticks are outstanding. Flag still defaults off.
**Fact-checked against:** `mobile-dev` @ `3a18941` (same HEAD as the design
doc). **Companion:** [`chat-v3-design.md`](./chat-v3-design.md) — the
architecture contract. Read it first. **Resumability:** every task is a
checkbox. Tick as you land. A future session should be able to open this file,
find the first unticked box, and continue with no other context.

---

## Ground rules (apply to every phase)

1. **Never edit `src/features/chat/v2/**`.** Not a "small fix", not a shared
   helper tweak. Frozen. **Code-review F3 (2026-08-23): hold this line.** v2 bug
   fixes ship on their own PR against `mobile-dev` so the fallback stays the
   last known-good release. Do not land v2 changes on the v3 branch.
2. **Every phase must be mergeable with the flag OFF.** Nothing outside
   `src/features/chat/v3/**` and the three chat-screen entry files (design §3.2)
   changes until Phase 10, **except** ground rule 8.
3. **Pure layers first, UI after.** `intent/`, `machine/`, `model/` land with
   tests before any component consumes them.
4. **File budget ≤ 300 lines** (≤ 400 with a written exemption). Enforced by
   ESLint in Phase 0.
5. **No `@deprecated` aliases, no shadow-state refs, no data-copying Effects.**
   See design §8 (C1–C18).
6. **Copy tests freely; copy code only through the §8.1 reuse gate.** v2's
   policy test suites are the spec. v2's _component_ code is not a reference
   implementation — it is the thing being replaced. Reusable logic (the pure
   text utilities, mostly) enters v3 only after: characterisation test → audit
   against C1–C18 → an explicit **Adopt / Refactor-then-adopt / Rewrite**
   decision recorded in the PR → a measurement if it is on a hot path. **Reuse
   the knowledge, never the mess.** Nothing enters `v3/` because it "already
   works".
7. **Never break a §9 parity item silently.** If a feature can't ship in its
   phase, tick nothing and raise it.
8. **Named exception — B4 lives outside `v3/`.** Phase 6b removed the `send()`
   early-return on `isOfflineRef.current` in
   `src/components/input-composer/input-composer-root.tsx`. Schedule-path
   offline gates (`openSchedule` / `confirmSchedule`) stay — those are
   `delayedMessages` mutators, not the pending queue. That remains the sole
   pre-Phase-10 edit outside `v3/` + the three entry files.

---

## Phase 0 — Scaffold and guardrails

_Goal: the v3 directory exists, is lint-enforced, and is reachable behind an
off-by-default flag._

- [x] Create the `src/features/chat/v3/` tree exactly as in design §3.1
      (`intent`, `machine`, `data`, `warm`, `model`, `list`, `rows`, `composer`,
      `overlays`, `scheduling`, `screens`, `__tests__`).
- [x] Add `v3/flag.ts` — `isChatV3Enabled()`, default `false`, read once per
      mount, with a **named owner and written expiry date** in a header comment
      (Ch. 31 discipline). Local MMKV + Settings **Chat v3 (dev)** toggle. Not
      CAC, not `EXPO_PUBLIC_*`.
- [x] Confirm the flag appears in **exactly the three chat-screen entry files**
      (design §3.2) and nowhere inside `v3/` — no nested sub-feature flags (Ch.
      31's dependent-flag trap). `TicketDetailsScreen` is added in Phase 9a, not
      here.
- [x] Add ESLint override scoped to `src/features/chat/v3/**`:
  - [x] `max-lines: [error, { max: 300, skipBlankLines: true, skipComments: true }]`
  - [x] `no-restricted-imports` banning `react` / `react-native` inside
        `intent/`, `machine/`, `model/`
  - [x] ban `extraData` usage on `LegendList` (custom rule or
        `no-restricted-syntax`)
- [x] Add `v3/README.md` — one screen: the layer map, the dependency rule, and
      links to both docs.
- [x] Verify `yarn lint` and `yarn tsc --noEmit` pass on the empty tree.

**Exit:** scaffolding landed; flag off; zero behaviour change. Phase 0 files
lint clean (0 errors). Repo-wide `tsc` still reports pre-existing errors in
`flowAction` / scheduled-message tests, none in `v3/` or the route switch.

---

## Phase 1 — Intent: validate at the edge

_Goal: untrusted route params become a typed `OpenIntent` or a typed failure.
Pure TypeScript._

- [x] `v3/intent/openIntent.types.ts` — `OpenIntent`, `Result<T, E>` (design
      §5.3). `OpenFailure` lives in the neutral `v3/types/openFailure.ts`, not
      here — it spans intent _and_ machine failures, so neither layer owns it.
      Defined once; imported by both.
- [x] `v3/intent/openIntentSchema.ts` — Zod schema over the raw params object.
- [x] `v3/intent/parseOpenIntent.ts` — schema parse → normalised intent;
      computes `intentKey` as **surface identity only** (design §5.3):
      `channel:${channelId}` / `thread:${channelId}:${threadId}` /
      `ticket-thread:${channelId}:${threadId}:${ticketId}`. The landing message
      is **not** in the key (I9 + I11).
- [x] `v3/intent/resolveSurface.ts` — channel vs thread vs ticket-thread
      resolution, including the "resolve authoritatively before choosing ticket
      or plain thread" rule. This is what `chat-deeplink.tsx`'s 319-line host
      does today — v3 owns it in `resolving`, so the deeplink route can shrink
      to a param-passer.
- [x] `v3/intent/entryPoint.ts` —
      `tap | notification | deeplink | activity | search | share |     forward | call | restore`,
      and `isColdStart`. **`forward` and `call` are live `ChatLinkSource`
      values** in `chatOpenIntent.ts`. **`restore` is process-death recovery**
      (B13).
- [x] Keep the raw params on the intent (or on the failure) so an
      `invalid-intent` error can be reproduced from the actual link (Ch. 14
      replay requirement).
- [x] **Port `tests/unit/features/chatOpenIntent.test.ts` (all 25 `it()`
      cases)** to `v3/__tests__/parseOpenIntent.test.ts`, adapted to the v3
      types. Specifically preserve:
  - [x] rejects a link without a channel identity
  - [x] authoritatively resolves an external message when its surface is unknown
  - [x] builds a resolved ticket-thread route without mounting a plain thread
        first
  - [x] keeps a message-only notification behind the resolver
  - [x] keeps Activity underneath an activity thread open
  - [x] keeps call-stack synthesis separate from chat notification opens
  - [x] clears stale message/resolver state when re-anchoring in place
  - [x] does not release another invocation's guard when re-anchoring a
        duplicate tap
- [x] Assert `intentKey` is stable and idempotent for the same triple (backs
      invariant I9).

**Exit:** all intent tests green; no React imported anywhere in `intent/`.

---

## Phase 2 — The open state machine (the keystone phase)

_Goal: the union, the reducer, and the reveal policy — fully tested, before any
UI exists._

- [x] `v3/types/openFailure.ts` — `OpenFailure` in a **neutral** home imported
      by both `intent/` and `machine/` (design §5.3). It spans both layers, so
      neither owns it. Defined exactly once.
- [x] `v3/machine/openState.ts` — the `OpenState` discriminated union,
      `LandingTarget`, `OpenSource`; imports `OpenFailure` (do not redefine).
- [x] Lazily initialise the reducer **straight into `resolving`** —
      `useReducer(openReducer, intent,     initFromIntent)` — and dispatch
      `teardown` **only from unmount cleanup**. That makes "`idle` never
      renders" true by construction rather than by discipline (design §5.2).
- [x] `v3/machine/openActions.ts` — the action union (`open`, `reanchor`,
      `surfaceResolved`, `warmWindowRead`, `dataFactsChanged`,
      `landingConfirmed`, `userTookOwnership`, `tick`, `retry`, `fail`,
      `teardown`). Every action carries an `intentKey`.
- [x] `v3/machine/openReducer.ts` — exhaustive `switch` on `state.status` ×
      `action.type`, with `assertNever` on both. **Under 300 lines.**
- [x] `v3/machine/timeouts.ts` — stage budgets (`resolving` 4000 / `loading`
      6000 / `placing` 1500) and the degrade rules (`placing` degrades to
      _reveal_, the others to _error_). The placing-budget `tick` is the
      documented exception to I7.
- [x] `v3/machine/revealPolicy.ts` — `classifyOpen`, `canReveal`,
      `isLandingConfirmed` (pure). Map v2's "reveals an anchored open as soon as
      rows exist" to entering `placing`, not `ready` (design §7) — the two steps
      must not be collapsed, or B3 returns.
- [x] Re-express v2's two "no second shimmer" cases against `hasPaintableRows`
      rather than porting them as concealment:
      `"holds warm rows without showing a second shimmer until placement     confirms"`
      and
      `"does not put a second shimmer over a warm target while native placement     confirms"`
      assert the **absence of a shimmer over rows**, not the absence of rows.
      Porting `shouldHoldWarmChatPlacement`'s conceal literally would
      reintroduce B1 and revert PR #174's shimmer-during-hold fix (design §5.2).
- [x] `v3/machine/selectors.ts` — `isSurfaceVisible`, `isSkeletonVisible`,
      `isErrorVisible` derived from `status` **and the data fact
      `hasPaintableRows`** (design §5.2). Not from `source`: a warm window that
      does **not** contain the target puts the machine in `loading`, and a
      status-keyed rule would then cover rows we already hold. **Skeleton iff
      non-terminal AND nothing paintable. Rows we hold are never concealed.**
      Signature is `(state, facts)` — never store `hasPaintableRows` in
      `OpenState` (that would be the C4 violation; it reaches the reducer only
      via `dataFactsChanged`, for transitions).
- [x] **Port `tests/unit/features/chatOpenRevealPolicy.test.ts` (40 `it()`
      cases)** to `v3/__tests__/revealPolicy.test.ts`. Every named case in
      design §7 must appear.
- [x] `v3/__tests__/openReducer.test.ts`:
  - [x] every `(status × action)` pair produces a defined state (no `undefined`,
        no throw)
  - [x] **I1–I4:** for every `(status × hasPaintableRows)` pair, exactly one of
        surface / skeleton / error is visible and **never none** (property test
        over the full cross-product, not just the status union). Specifically
        assert: warm `placing` **shows the rows** with no skeleton over them;
        `loading` with warm-but-not-containing rows **shows the rows**, not a
        skeleton; only a genuinely empty non-terminal state shows the skeleton.
  - [x] **I5:** each non-terminal status escapes on `tick` past its budget
  - [x] **I6:** `target` never changes after `loading`/`placing` entry except
        via `reanchor`
  - [x] **I7:** `placing → ready` via `landingConfirmed` is impossible without
        confirmation; placing timeout `tick` forced-reveals (the documented
        exception)
  - [x] **I8:** a partial live window cannot supersede a warm window containing
        the target
  - [x] **I9:** duplicate `open` with the same `intentKey` while non-terminal is
        a no-op
  - [x] **I10:** every async continuation is a no-op when its `intentKey` does
        not match current state; `teardown` from every non-terminal status
        reaches `idle` and releases the deferral token (**B11** — Ch. 13's
        asynchronous-navigation trap: back-out mid-open)
  - [x] **I11:** `reanchor` is legal only from `ready` with an unchanged
        `intentKey`, and clears scroll ownership + previous target lock, then
        writes the new `target`; a changed `intentKey` remounts instead
        (**B12**)
  - [x] `retry` from `error` re-enters `loading` under the same `intentKey`, so
        the failed attempt's late callbacks are discarded and retry cannot
        double-apply (Ch. 7's retry race)

**Exit:** the machine is provably total. **This is the phase that closes B1, B2,
B3 and B10 — do not start Phase 3 until every box above is ticked.**

---

## Phase 3 — Row model and single-pass paint

_Goal: `Conversation[]` → final `ChatRow[]` with deterministic heights. Pure. No
lite/rich split._

- [x] Represent the full v2 taxonomy (design §9.0):
      `rowType = message | media | ticket | system` ×
      `rowKind = CURRENT_USER | OTHER_USER | BOT | TICKET | SYSTEM`, and
      `MessageType = USER | BOT |     SYSTEM | FORWARDED`. **`BOT` was missing
      from the first parity pass** — do not drop it again.
- [x] Handle **deleted-message tombstones** (`message.isDeleted`), **call
      messages**, **ticket-creation messages**, and **`showInChannel` replies**
      as first-class shapes.
- [x] `v3/model/chatRow.types.ts` — `ChatRow` union + `MessageRowModel` with
      **only** the canonical sub-models (`body`, `reactionPreview`,
      `replyPreview`, `mediaPreview`). **Zero `@deprecated` alias fields** (v2
      carries nine — see design §1.1).
- [ ] Retire **all three** v2 renderers, not two: `ChatPaintRowLite`, the
      `ChatComposer` row path, and `MessageRow` (design §1.1a — the original
      "lite -> message-row" description was wrong; the rich target is
      `ChatComposer`). Delete `rowPresentationStore`,
      `shouldKeepChatPaintPreview`, `richHydrationEnabled` and the 420 ms
      `RICH_HYDRATION_AFTER_TRANSITION_DELAY_MS` gate with them — there is no
      second pass left to schedule. **Not this phase:** ground rule 1, v2 stays
      frozen until Phase 11. v3 simply does not port the two-pass architecture.
- [x] Adopt `MessageRow`'s **P5 contract** (_"fidelity changes content, never
      geometry"_) as the rule for **every** row, enforced by `measureRowHeight`.
      v2 stated it correctly for one renderer and never generalised it.
- [x] Run each pure text utility from
      `v2/components/conversation-composer/utils/` through the **§8.1 reuse
      gate** on its way into `v3/model/text/`: `htmlToMD`, `parseInlineRich`,
      `parseCustomEmojiMarkdownSegments`, `longMessageCollapse`,
      `markdownPreview`, `markdownStyle`, `mentionSchemes`,
      `htmlListsToMarkdown`, `getConversationKind`,
      `getConversationReactionsMd`, `getUserColor`.
  - [x] characterisation test written **against the v2 implementation** first
  - [x] audited against C1–C18 (line budget, no React/RN import, no dead v2-era
        branches)
  - [x] explicit **Adopt / Refactor-then-adopt / Rewrite** verdict recorded per
        file in the PR
  - [x] **measured** for the ones on the hot path — `parseInlineRich`,
        `parseCustomEmojiMarkdownSegments`, `longMessageCollapse` run per row
        and must be benchmarked before adoption, not assumed fast
- [x] `v3/model/buildRows.ts` — orchestration only (≤ 200 lines).
- [x] `v3/model/buildBody.ts` — markdown/segments/collapse.
- [x] `v3/model/buildMedia.ts` — attachment kinds, aspect ratio, **mandatory
      reserved height**.
- [x] `v3/model/buildPreviews.ts` — link preview, parent preview, ticket
      preview, forwarded.
- [x] `v3/model/buildGrouping.ts` — **two passes in opposite directions**, per
      design §9.0: `showSenderName` look-backward (first of a group),
      `showAvatar` look-ahead (last of a group, because bubbles are
      `items-end`). Plus: DM = no avatars/identity; `CURRENT_USER` = no avatar
      but still breaks a group; `SYSTEM` = no identity, never breaks a group;
      `BOT` = always identity + avatar, never grouped; `TICKET`/ticketPreview =
      no sender name; day boundary breaks a group. Preserve reference equality
      for unchanged rows (incremental rebuild + recycling depend on it).
- [x] Table-test every §9.0 grouping rule — this is the single most
      regression-prone spec in the row model and it is invisible in filenames.
- [x] `v3/model/measureRowHeight.ts` — pure height function; returns an exact
      height where the shape is fully determined, `undefined` where genuinely
      dynamic.
- [x] `v3/model/rowType.ts` — `getRowType` for LegendList `getItemType`.
- [x] Tests:
  - [x] snapshot the row model for **every** message shape in design §9 (text,
        long-collapsed, emoji-only, media ×4 kinds, ticket, ticket-activity,
        flow-json, forwarded, system, call-transcript, with/without reactions,
        replies, parent preview, pinned, bookmarked, edited)
  - [x] `measureRowHeight` is deterministic: same model in → same height out,
        ×1000 fuzzed models
  - [x] `keyExtractor` returns the server conversation id for every row kind
        (C10)
  - [x] no row model contains an alias field (guard test against regression to
        v2's shape)

**Exit:** the model layer is pure, tested, and contains no React. **This closes
B5's root cause.**

---

## Phase 4 — Data adapters: subscribe, never own

_Goal: one hook over `@xyne/shared`, with no local message state._

- [x] `v3/data/useConversationWindow.ts` —
      `useConversationWindow(intent, target)` as design §5.4. Thin adapter over
      `useMessages(ref)` from `@xyne/shared/messages` (there is no
      `useChannelMessages` / `useThreadMessages` export). Query options are
      derived from intent + target (`messagesOptionsFor`) — no v2 options bag.
      Channel `ChannelRef` → `UseChannelMessagesResult` (`messages`,
      `hasReachedChannelStart`, `retryInitialLoad`, `loadOlder`/`loadNewer`).
      Thread `ThreadRef` → `ThreadConversation | null` (full-thread query;
      `loadOlder`/`loadNewer` are no-ops). Returns
      `{ conversations, isInitialLoadComplete,     hasReachedStart, initialLoadError, loadOlder, loadNewer, retry }`.
      Pending rows are **already merged inside `useMessages`**.
- [x] `v3/data/useDataFacts.ts` — the machine's data inputs (`hasRows`,
      `isInitialLoadComplete`, `containsTarget`, `hasReachedStart`, `error`)
      derived **during render**, never stored.
- [x] Do **not** add `usePendingRows` as a second window. That would recreate
      B6. Per-row `usePendingStatusByMessageId` for failed-send chrome is
      allowed.
- [x] `v3/data/useChatSubscriptions.ts` — channel/user/reaction/bookmark lookups
      the rows need.
- [x] Verify by grep that `v3/data/**` contains **zero** `useState` holding
      message data and **zero** effects that `setState` from derived values
      (C4).
- [x] Test: switching `intentKey` remounts and carries no state (C5 — `key`, not
      an Effect). Screens will pass `key={surfaceRemountKey(intent)}` in
      Phase 9.

**Exit:** the view has exactly one merge (the shared one). **This closes B6.**

---

## Phase 5 — The one list engine

_Goal: replace 4,843 lines of two hand-synced engines with one configured list._

- [x] `v3/list/ConversationList.tsx` — **six props** (design §6.1). ≤ 300 lines.
- [x] `v3/list/legendListProps.ts` — the verified prop configuration from design
      §6.2, built as a pure function of `(state, target, rows, composerReserve)`
      so it is unit-testable.
- [x] `v3/list/anchoring.ts` — `ScrollMode`, the mode reducer, and pure
      `shouldRestorePosition`.
- [x] `v3/list/landing.ts` — `landingIndex(rows, target)` and
      `isLandingConfirmed` wiring to `getState()` metrics.
- [x] `v3/list/ListSkeleton.tsx` / `v3/list/ListError.tsx` /
      `v3/list/ListEmpty.tsx` — the three non-`ready` visuals. **`ListError` is
      new — v2 has no explicit chat error surface.**
- [x] `v3/list/FloatingDateHeader.tsx`.
- [x] Confirm each rule holds in code review:
  - [x] the list component is `KeyboardAwareLegendList` from
        `@legendapp/list/keyboard`, not base `LegendList` (required for
        `contentInsetEndAdjustment: SharedValue<number>`; the keyboard variant
        Omits then re-adds both that prop and `anchoredEndSpace` — Verified in
        `keyboard.d.ts`)
  - [x] `ListSkeleton` is rendered **only** when `isSkeletonVisible` is true,
        and it never overlays mounted rows — grep-verify there is no opacity-0 /
        `display:none` path on the list itself
  - [x] `inverted` is **not** used anywhere (docs: causes animation/scroll edge
        cases)
  - [x] tail landing uses `initialScrollAtEnd`; anchored landing uses
        `initialScrollIndex={{ index, viewPosition: 0.35 }}` — **no imperative
        scroll in an effect**
  - [x] `keyExtractor` = server id; `dataKey` = `intentKey`
  - [x] `getItemType` + `getFixedItemSize` are wired from Phase 3
  - [x] `recycleItems` is on **and** no row uses plain `useState` (use
        `useRecyclingState`)
  - [x] `extraData` is not passed (C15)
  - [x] `maintainVisibleContentPosition={{ data: true, size: true, shouldRestorePosition }}`
  - [x] `onStartReached`/`onEndReached` thresholds 1.5, matching v2's pagination
        feel
- [x] Tests: `legendListProps` snapshot per `(target.kind × status)`;
      `anchoring` table test over `(mode × status × distance)`; `landingIndex`
      for tail/unread/anchor.

**Exit:** one engine, declarative landing. **This closes B3's second half and
B5's masking.**

---

## Phase 6 — Rows, composer and overlays

_Goal: feature parity for everything the user touches._

### 6a — Rows

**Blocking prerequisite — visual parity
([`chat-v3-visual-parity.md`](./chat-v3-visual-parity.md)).** Rows must be built
_on top of_ v2's token contract, not styled independently. Doing this after the
rows exist is a rewrite; doing it first is free.

- [ ] Move the `ChatRenderTokens` type to a shared non-`v2` home
      (`src/theme/chatRenderTokens.ts`) — a pure move, and the one sanctioned v2
      edit.
- [ ] Adopt `chat-render-tokens.ts` **verbatim** (reuse gate step 0) — 22
      scalars, 12-colour username palette, 8-colour mention palette.
- [ ] Wire `useSelectedChatBubbleContentTokens` so user-selected chat themes
      work in v3.
- [ ] Resolve tokens **once at the list** and pass down — never per-row
      `useCSSVariable`; v2's type comment states this as a performance contract.
- [ ] Bubble width from `inlineContentMaxWidth` / `windowWidth`, never a
      hard-coded percentage.
- [ ] No generic utility class may stand in for a token (`bg-card` where
      `currentUserBubbleBg` belongs, `text-muted` where `rootMetaUser` belongs).
- [ ] **Exit 6a on a clean screenshot diff vs v2** (G10), not on features being
      present.

- [x] `v3/rows/MessageRow.tsx` — one component, `React.memo` on
      `contentSignature` (via `rowsAreEqual`). ≤ 300 lines; split into
      `MessageRowBody`, `MessageRowMedia`, `MessageRowFooter`,
      `MessageRowHeader`.
- [x] `v3/rows/DateRow.tsx`, `UnreadDividerRow.tsx`, `SystemMessageRow.tsx`.
- [x] `v3/rows/parts/` remaining: row entrance animation, reminder indicator.
      **Landed:** ticket chrome, forwarded banner, stored link preview, parent
      preview, reaction pills, reply tray, attachment reserved box, mention
      styling (not tappable), status indicators, inline-rich markdown, custom
      emoji via `useMtlsEmoji` when `uri` is missing, jumbo 1–3 emoji-only with
      matching `measureRowHeight`, Show more / Show less (`isExpanded` on the
      row model via `applyRowPresentation` — not `extraData`; P5 is lite→rich,
      not user expand), recycle-safe jump highlight, tail-append entrance
      (`isEntering`, first paint and prepends do not animate), reminder label
      from the bookmark store, flow-json card chrome, call-transcript card
      chrome.
- [ ] Tick every "Message rendering", "Media and attachments", "Link previews"
      and "Reactions" item in design §9 as it lands. Display-only from the row
      model is in; viewers, add/remove reaction, and mention-press sheets wait
      for later 6a/6c slices. Tombstones paint but do not yet gate the twelve
      actions (6c).

### 6b — Composer

- [x] `v3/composer/ChatComposerDock.tsx` — hosts the existing
      `components/input-composer` widget (R4). Not a rewrite of
      `react-native-enriched`. Pass as `ConversationList` children so B8
      measures the dock. Screens compose this in Phase 9.
- [x] **B4 patch (ground rule 8):** in
      `src/components/input-composer/input-composer-root.tsx`, remove the
      `send()` early-return on `isOfflineRef.current` so `onSend` /
      `sendMessage` always runs. Leave the schedule-path offline gates
      (`openSchedule` / `confirmSchedule`) — those are `delayedMessages`
      mutators, not the pending queue. This is the only allowed pre-Phase-10
      edit outside `v3/`.
- [x] `v3/composer/useComposerReserve.ts` — a thin wrapper over the library's
      own
      **`useKeyboardChatComposerInset(listRef, composerRef, initialHeight)`**,
      which returns
      `{ contentInsetEndAdjustment: SharedValue<number>, onComposerLayout }`.
      **Do not hand-roll the shared value.** **No competing `paddingBottom` on
      the list** (design B8 — v2 already has the inset; v3 deletes the padding).
- [x] `v3/composer/sendScroll.ts` — `sendScrollToEndOptions` →
      `scrollMessageToEnd({ animated: true, closeKeyboard: false })` so a sent
      row lands readable above the composer with the keyboard still open. **Do
      not** pass `anchoredEndSpace` for the last row: the library sizes trailing
      space from the viewport start, which glued the thread to the top.
- [x] `v3/composer/onSend.ts` — `onSend` builds the payload and calls
      `sendMessage(zero, ref, payload)`. **No connectivity check, no early
      return** (C14, B4). HTML normalization stays in the view so logic tests
      stay Expo-free.
- [x] Test: send while `zero.connection.state === 'disconnected'` still calls
      `sendMessage`. The test is a lie if the B4 patch is not landed — the
      composer never invokes `onSend`.
- [x] **Never gate regular send on a connectivity boolean anywhere in v3** (Ch.
      7). Grep-verify: no `isConnected` / `NetInfo` / `isOffline` read on the
      send path inside `v3/` **or** in `input-composer-root.tsx`'s `send()`.
- [x] Implement the **offline feature matrix** in design §12.1 as
      `v3/machine/offlineMatrix.ts` — every capability maps to an explicit
      surface. ❌ cells have explained copy (`offline-cold`, unavailable).
      Send/edit/delete/react stay `{ kind: 'queue' }` — not a connectivity gate
      (C14). Warm read and hosts that consume this table land in Phase 7 / 9.
- [x] Preserve client-side `messageId` generation in `onSend` — that id **is**
      the idempotency key that makes offline replay safe (Ch. 7). Do not move it
      server-side.
- [x] Keyboard: reuse `chatKeyboardConfig.ts` semantics (`KeyboardGestureArea`
      on the list, `KeyboardStickyView` on `ChatComposerDock`,
      `useKeyboardScrollToEnd`); port `chatKeyboardConfig.test.ts` and
      `awaitKeyboardHidden.test.ts`. Note: `conversation-input.tsx` and
      `edit-scheduled-message-composer.tsx` import this file from `v2/` —
      retarget or copy-through-the-gate before Phase 11.
- [ ] Tick every "Composer" item in design §9, including **schedule send**
      (`#171`). Explicitly re-verify the caret/flicker fixes from commits
      `6d79408` (#177) and `6d39fc8` (#175) are **not** regressed. **Waits for
      Phase 9** — the dock is not hosted on a screen yet, so those items must
      not be ticked from this slice.

### 6c — Overlays

- [x] `v3/overlays/actionVisibility.ts` — the twelve-action × ten-flag
      visibility matrix from design §9 as a **pure function**, with a
      table-driven unit test. It lives outside the hook so it is testable; v2
      buries it in a `useMemo` inside `use-message-actions.tsx:163`.
      `rowPressIntent` is the pending-row tap policy (retry / sheet / thread).
      `QUICK_REACTIONS` lives here. Hosts are the next 6c slice.
- [x] Reproduce the two row-level pending affordances design §9 calls out
      separately from the sheet: tap-to-retry on a failed row
      (`firePendingMutator`), and tap-on-pending opening the sheet rather than
      the thread. Policy is `rowPressIntent`; wiring is in `MessageRow` via
      per-row `usePendingByMessageId` (not a second window, not extraData).
- [x] `v3/overlays/MessageActionsHost.tsx` — long-press sheet; reuse
      `use-message-actions` behaviour but re-expressed against the v3 row model.
      Handlers are `onAction.ts` (same shape as `composer/onSend`). Row chrome
      is `ActionRow.tsx`. Not mounted on a screen until Phase 9 — keep `target`
      until the sheet closes. Forward / reminder / full emoji picker are
      callbacks, not nested views.
- [x] `v3/overlays/ReactionsHost.tsx`, `ReminderOptionsHost.tsx`,
      `ForwardHost.tsx`, `UserProfileActionsHost.tsx`. Controlled
      `{ target, isOpen, onOpenChange }` hosts — no v2 Context providers, no
      `v2/` imports. Forward maps onto the shared `ForwardMessageSheetView`.
      Reminder adopts the v2 write-path into `model/reminder.ts`. Reactions is
      the who-reacted list (`reactionRowsFor`). Profile Message/Info/Call uses
      `profileActionEnabled` / `profileCallBlockedReason`. Not mounted on a
      screen until Phase 9.
- [x] Quick reactions bar with
      `QUICK_REACTIONS = ['👍','😂','✅','🙌','🎉','❤️']` on the actions sheet.
      "More" calls `onMoreReactions` (full picker is the next host).
- [ ] Tick every "Message actions" item in design §9 — that list is the
      **verified** action inventory (exact ids read from
      `use-message-actions.tsx`), including `send-to-channel`, `copy-image`,
      `start-call` and `mark-as-unread`, which are easy to miss. **Wait for
      Phase 9** — the host is not on a screen yet, so those items must not be
      ticked from this slice.
- [x] Re-derive each action's **visibility condition** from
      `use-message-actions.tsx` rather than guessing (own-message vs others,
      channel vs thread vs DM, pending vs sent, has-image, permissions). Landed
      in `actionVisibility.ts` against `:163-224` plus the `openReminderOptions`
      gate at the `remind-me` row.

**Exit:** §9 rendering / media / reactions / composer / actions sections fully
green.

---

## Phase 7 — Warm cache and the notification path

_Goal: notification continuity, no skeleton on revisit, no infinite shimmer, no
partial-window eviction._

- [x] `v3/warm/warmWindow.types.ts` — `WarmWindow` (design §5.5).
- [x] `v3/warm/readWarmWindow.ts` — **synchronous** read during `resolving`.
      Injects `readEntity` + `containsTarget` so tests stay Expo-free; the
      production adapter (`readNotificationChatEntitySync` +
      `containsNotificationTarget`) is passed at the screen edge in Phase 9.
      Never re-implements containment.
- [x] `v3/warm/isAuthoritativeFor.ts` — the single live-supersedes-warm rule
      (invariant I8). `deriveDataFacts` now sets `liveIsAuthoritative` from it.
- [x] `v3/warm/schemaGuard.ts` — a `chatCacheEntityVersion` / `_schemaVersion`
      mismatch yields **`null`** (treat as no warm window), never a partial
      read. Corrupt JSON is also `null`.
- [x] Wire `readWarmWindow` into the machine:
      `containsTarget → placing(source:'warm')`, skipping `loading` entirely (no
      skeleton for a revisited conversation). Producer is `warmWindowAction`;
      Phase 9 screens dispatch it during `resolving`.
- [x] Verify `restorePersistedChatWindow.ts` + `lastOpenChannel.ts` semantics
      are preserved (read-only consumption; do not modify these v2-shared
      modules). `lastOpenChannel` stores only a channel id (no scroll offset).
- [ ] Evaluate MMKV v4 `compareBeforeSet` on the chat-cache instance; measure
      write volume before/after. **Evaluated:** this app's `react-native-mmkv`
      `createMMKV({ id, mode })` wrapper has **no** `compareBeforeSet`. Left the
      adapter unchanged. Revisit only with a write-volume measurement after
      Phase 9 persists windows from v3.
- [x] Confirm the LRU caps still make sense for v3's window sizes
      (`MAX_DISK_CHANNELS 100` / `MAX_DISK_THREADS 50` /
      `MAX_DISK_CHANNEL_ROWS 200`) — recorded as `WARM_CACHE_CAPS`; not adjusted
      (no measurement yet, and the v3 path is read-only).
- [x] Tests:
  - [x] warm window containing the target → machine never enters `loading`
  - [x] partial live window cannot evict a warm window holding the target
  - [x] settled authoritative live window **does** take over
  - [x] no warm data → skeleton shows (and is bounded by the `loading` timeout)
  - [x] schema-version mismatch → treated as no warm window, not a partial read
- [x] Wire **process-death restore** (B13) at the v3 screen edge:
      `hydratePersistedWindow` seeds `restorePersistedChatWindow` synchronously
      before the live subscribe; channel + thread screens write
      `lastOpenChannel`. Mapper (`restoreIntentFromLastOpen`) produces
      `entry: 'restore'`. **Not ticked:** app-root relaunch navigation to the
      last channel if Expo Router does not restore the route (Phase 10). There
      is no persisted scroll offset — landing is a tail open.
- [ ] **Assert the cache is only ever an accelerator** (Ch. 37: _"can you make
      the backend the source of truth… build support for re-downloading data
      from the backend?"_). Run the whole QA matrix once with the chat cache
      wiped — every surface must render correctly, just slower. **Waits for
      Phase 10** (needs v3 screens on a device).
- [x] Track **chat MMKV store size** as a metric (`recordStoreBytes` from
      `useChatOpen` after first paint via `productionStoreBytes`). **Not
      ticked:** eviction assertion on a device (Phase 10).
- [x] Test the schema guard against a _corrupted_ cache entry, not just a
      version-mismatched one (Ch. 37: a bad schema can leave users stuck with
      "wipe the app" as their only recovery).
- [ ] Manual: kill the app, receive a push for a previously-visited thread, tap
      → full history with the notified message in place, **no skeleton**.
      **Waits for Phase 9.**
- [ ] Manual: force-kill with a chat open, relaunch → lands where the user was
      reading. **Waits for Phase 9/10 restore wiring.**

**Exit:** B7 closed; B1/B2 verified on the notification path specifically.

---

## Phase 8 — Scheduling, observability, and performance

- [x] `v3/scheduling/deferral.ts` — scoped
      `acquireDeferral('chat-open', budgetMs)` with a token released in the
      machine's single teardown. **The global 10 s `beginCriticalWindow` is not
      used by v3.** (v2 keeps using it; it is deleted with v2.) Token +
      `releaseDeferralOnTeardown` landed; the reducer stays pure (no timers).
      Screens acquire/release in Phase 9 — **B9 closed in code** (400 ms scoped
      token, teardown + budget). Not the v2 10 s window.
- [x] Confirm by grep that `v3/**` never imports `interactionCriticalWindow`.
- [x] `v3/scheduling/afterFirstPaint.ts` — lift v2's double-rAF helper verbatim;
      use it **only** for non-critical work, never for correctness (risk R7).
      Adopted with an injectable scheduler so node tests do not need rAF.
- [x] `v3/observability/openTrace.ts` — **replay-grade**, per design §12.2 (Ch.
      14: _"a log, not just of user events, but of incoming network
      notifications"_). Records: `intentKey`, `entry`, `isColdStart`, raw params
      as received, every state transition with timestamp + causing action, the
      warm-cache decision (`containsTarget`, fingerprint, age), inbound events
      during the open (push arrival, Zero connect/disconnect,
      foreground/background, keyboard), and the terminal outcome with the full
      `OpenFailure`. A single trace must answer "why was this blank?" without a
      repro. Unsampled traces drop events. `summarizeOpenTrace` is the replay
      string. Screens emit traces in Phase 9.
- [x] Sample the trace for beta users + a small production slice only — **not**
      everyone (Ch. 32: tracing itself costs performance). Policy:
      `shouldSampleOpenTrace` — always on in dev/beta, **2%** otherwise
      (`OPEN_TRACE_PRODUCTION_SAMPLE_RATE`). Not wired to a collector yet.
- [x] Debug-build height-violation detector: `useHeightViolation` on
      `ConversationList` `onItemSizeChanged` records a G4 hit via
      `recordHeightViolation` / `takeHeightViolation` (in-memory, no `console`).
      Device walk of visible-row jumps still waits on design §9.
- [ ] Measure and record against the design §10 gates — **all at p95, not
      average** (Ch. 32: p95 "will give you the number that most people
      experience"). **Needs v3 screens on a device.**
  - [ ] tap → first painted row, warm cache: **< 150 ms**
  - [ ] tap → `ready`, uncached, good network: **< 800 ms**
  - [ ] **silent-failure rate** (opens ending in `error` or hitting a stage
        timeout): **< 0.1%** — the measurable form of "no blank screens",
        tracked like a crash rate (Ch. 6)
  - [ ] slow rendering frames **< 0.1%**; **zero** frozen frames (Ch. 32
        definitions)
  - [ ] zero post-mount row-height changes for visible rows
  - [ ] chat MMKV store size bounded and evicting
- [ ] Add the **adversarial network harness** (Ch. 32): dev builds drop ~10% of
      requests and inject latency. Wave's rationale — it forces good loading UIs
      and idempotent mutations — is exactly what v3 is trying to guarantee.
      **Policy landed** (`shouldDropDevRequest`, `devInjectedLatencyMs`); not
      attached to axios/fetch (would change app-wide behaviour before Phase 9).
- [ ] Run at least one throttled-network session on the chat surface (Uber's
      slow-network day). **Needs v3 screens.**
- [ ] Tune the Phase 2 stage budgets against the measured numbers; record the
      final values in the design doc's §5.2 table. **Needs the p95 numbers.**
- [x] **Collect the telemetry the future SQLite read model will need** (design
      §11.1) — warm-window hit rate, staleness when hit, how often a live window
      supersedes it, store growth. This is the input to that design. Collect the
      data; **build no SQLite scaffolding now.** Collectors: `recordWarmRead` /
      `recordLiveSupersede` / `recordStoreBytes`. Screens call them in Phase 9.

**Exit:** measured, not asserted. **B9 is closed in code** (scoped deferral on
the screen teardown). p95 gates still need a device.

---

## Phase 9 — Third-party consumers and screens

_Goal: everything that renders a chat list renders the v3 one._

- [x] `v3/screens/ChatChannelScreen.tsx` — thin: intent → machine → list +
      composer + overlays. ≤ 250 lines (v2's is 1,063). Shared host is
      `ChatConversation`; this file is the header + parse edge.
- [x] `v3/screens/ChatThreadScreen.tsx` — thin, same shape. Ticket threads still
      `replace` to `/ticket/[ticketId]` (same as v2).

### 9a — In scope now

- [x] Migrate `src/screens/TicketDetailsScreen.tsx` to the v3 list (behind the
      same flag). `TicketThreadPane` + `isChatV3Enabled()` once per mount.
- [x] Verify the ticket-thread surface (`threadTicketSurface.ts`) renders
      identically. **Code path:** parse yields `ticket-thread`; the thread
      screen still redirects via `readConversationTicketId`. Device visual
      parity is not ticked (design §9).

### 9d — Open, landing and read-cursor hardening (2026-09-02)

The screens mount, but the open path drifted from design §5.2/§7 (four
resolvers, `target` mutated in place, no `resolving`/`loading` budgets, a 30 s
anchor hunt that force-reveals, two placement mechanisms, range-based landing
confirmation) and mark-as-read is leave-only and silently dropped. Root causes,
contract deltas, and the resumable checklist live in
[`chat-v3-open-and-read-hardening-plan.md`](./chat-v3-open-and-read-hardening-plan.md).
**Do 9d before the design §9 device walk** — otherwise the walk measures the
drift, not the contract.

- [x] Phase A — one `resolveLocation` in `resolving`; deeplink host is a
      passthrough under v3; dead resolvers deleted
- [x] Phase B — reducer back on contract (I1, I5, I6, I7); `anchorHunt` gone
- [x] Phase C — one placement mechanism; `isPlaced` from `positionByKey`
- [x] Phase D — read cursor: never-dropped flush, viewing + background flush,
      boundary from live status at open
- [x] Phase E — cleanup, design-doc amendments, 9d typecheck + v3 eslint +
      `test:chat-v3` green
- [ ] Phase E leftover — full-app `tsc` / `lint` / `test:render` (pre-existing
      at `807eb260` / missing `expo-modules-core` here)
- [ ] Phase F — device matrix (flag on)

### 9b — Deferred until chat is complete and stable

- [ ] Migrate
      `src/features/xyne-desks/detail/components/messages-tab/messages-tab.tsx`
      to the v3 list. **Deliberately after** the chat rollout, not alongside it
      — it keeps the chat effort's blast radius small (Ch. 25). Consequence: v2
      stays on disk past the chat rollout until 9b **and** 9c land, so **Phase
      11 is gated on 9b+9c, not on the v3 rollout**.

### 9c — Non-list v2 imports (must be retargeted before Phase 11's grep goes green)

See design §3.3. Each is Adopt / Refactor-then-adopt / Rewrite through the §8.1
gate, not a silent copy. At minimum:

- [ ] `chat-bubble-preview.tsx` + `chatBubblePreviewTokens.ts` — paint/row
      tokens
- [ ] `pinned-messages.tsx` — `ConversationComposer` + user-profile sheet
- [ ] `bookmarks.tsx` + `bookmark-list-item.tsx` — message-actions sheet
- [ ] `conversation-input.tsx` + `edit-scheduled-message-composer.tsx` —
      `chatKeyboardConfig`
- [ ] xyne-desks email-tab / email-summary / `email-html-to-markdown.ts` —
      htmlToMD, rich-inline-text
- [ ] leftover `src/features/chat/paint/chatPaint.types.ts` (used by
      `src/components/conversation-composer`)

- [ ] Tick every "Navigation and open paths" and "Chat surface chrome" item in
      design §9. **Needs a device with the flag on.** Phase 9 mounts the
      screens; it does not walk that checklist.

**Exit (9a + screens):** chat list surfaces used by the flagged routes render
v3. **Exit (9c):** the Phase 11 grep can go green. 9b may still be outstanding
after chat rollout.

---

## Phase 10 — Route switch, QA, rollout

- [ ] Switch the three chat-screen entry files to the flag (design §3.2):
  - [ ] `app/(protected)/chat/[channelId]/index.tsx` — one-line re-export today;
        wrap with the flag
  - [ ] `app/(protected)/chat/[channelId]/[threadId].tsx` — same
  - [ ] `app/(protected)/chat-deeplink.tsx` — **not** a re-export. It is a
        319-line resolver host. Prefer collapsing resolution into L1
        `parseOpenIntent` + the machine's `resolving` state and leaving this
        file as a thin param-passer that mounts the flagged screen. Do not leave
        a second resolver running beside v3.
- [ ] Confirm `grep -rn "features/chat/v2/screens" app` shows only the intended
      flag wrappers.
- [ ] Confirm the flag is read once per mount, not per render.
- [ ] **Run the full QA matrix in design §10** — every cell, both platforms,
      including the B11–B13 rows (abandon mid-open, in-place re-anchor, process
      death, background→foreground, captive WiFi). Record results in a table
      appended to this file.
- [ ] Run the matrix **once more with the chat cache wiped** — the cache is an
      accelerator, never a dependency (Ch. 37).
- [ ] Walk the **entire design §9 parity checklist** on a device with the flag
      on. Every box ticked.
- [ ] **Add a snapshot-test tier** before rollout (Ch. 17 — the tier the first
      draft of this plan missed): one snapshot per row kind × light/dark, plus
      the skeleton, error, and empty states. Fixtures live in one labelled
      directory from day one.
- [ ] **Enumerate other live feature flags** that touch chat, notifications, or
      navigation, and test the intersection with v3 on (Ch. 31's
      conflicting-flag failure: two teams each test with only their own flag
      on).
- [ ] **Stand up the Superposition/CAC kill switch and verify it is flippable
      before any internal ramp.** The Settings toggle is local-only and cannot
      turn v3 off for anyone but the person holding the phone (design §3.2,
      code-review F7).
- [ ] **Rollout order limits blast radius** (Ch. 25 — Uber's Swift rewrite "was
      almost a disaster" without a plan B):
  - [ ] **employees only**, thread surface first (fewest entry points)
  - [ ] employees, channel surface
  - [ ] employees, notification path
  - [ ] staged % of users → 100%
  - [ ] kill switch verified working at **each** stage, not just the first
- [ ] Book an **exploratory testing session** on the chat surface, and leave
      buffer time to _fix_ what it finds (Ch. 18 — a checklist cannot find what
      it did not already imagine).
- [ ] Hold at 100% for one full release cycle with no chat regression reports.

**Exit:** v3 is the chat.

---

## Phase 11 — Delete v2

Only when **all** of design §3.4 holds **and Phase 9b + 9c have landed** —
`messages-tab` is the last list consumer, but the §3.3 table (bookmarks,
email-tab, keyboard config, bubble preview, leftover `features/chat/paint/`)
will still fail the grep until 9c is done.

- [ ] `grep -rn "features/chat/v2" src app` returns nothing.
- [ ] Delete `src/features/chat/v2/**` in a single commit.
- [ ] Delete leftover `src/features/chat/paint/` if nothing imports it.
- [ ] Delete `src/utils/interactionCriticalWindow.ts` **only if** v3 is its last
      consumer (check tab transitions, channel/DM lists, activity, search, chat
      info first — they still call it on HEAD).
- [ ] Delete the now-dead v2 policy test files (their cases live on in
      `v3/__tests__/`).
- [ ] Remove the flag and collapse the route files back to one-line re-exports
      of the v3 screens.
- [ ] Rename `v3/` → `chat/` **only if** it can be done without churning imports
      across the app; otherwise leave the name.

---

## Bug → phase traceability

Use this to answer "which phase fixes the thing the user reported?"

| Bug (design §4)                          | Closed by                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| B1 blank chat screen                     | Phase 2 (union + I1–I4), verified Phase 7                                                    |
| B2 infinite shimmer                      | Phase 2 (I2 + I5 timeouts)                                                                   |
| B3 wrong landing / jump after landing    | Phase 2 (`placing` + I7) + Phase 5 (declarative `initialScroll*`)                            |
| B4 sent message invisible                | Phase 6b (C14 + offline send test)                                                           |
| B5 scroll jumps / flicker / reflow       | Phase 3 (single-pass paint, deterministic heights) + Phase 5 (pure `shouldRestorePosition`)  |
| B6 data inconsistency                    | Phase 4 (subscribe, never own — one merge)                                                   |
| B7 notification continuity               | Phase 7 (warm contract + I8)                                                                 |
| B8 composer occlusion                    | Phase 6b (`contentInsetEndAdjustment` + `scrollMessageToEnd`, no `anchoredEndSpace` on send) |
| B9 10 s global stall                     | Phase 8 (scoped deferral)                                                                    |
| B10 duplicate/dead taps                  | Phase 1 (`intentKey`) + Phase 2 (I9)                                                         |
| B11 navigating away mid-open             | Phase 2 (I10 — abandon path)                                                                 |
| B12 deep link into an already-open chat  | Phase 2 (I11 — `reanchor`)                                                                   |
| B13 OS-kill mid-conversation, lost place | Phase 1 (`entry: 'restore'`) + Phase 7 (restore wiring)                                      |

---

## Open decisions to confirm before the phase that needs them

| Before      | Decision                                                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Phase 7~~ | ~~MMKV vs SQLite~~ — **resolved: MMKV for v3.** SQLite comes after chat is fixed and we understand sync / new-message arrival / optimistic reads. Build swappable behind `readWarmWindow`; build **no** SQLite scaffolding now (design §11.1). |
| Phase 5     | **Anchored-open query shape.** If measurement shows anchored opens need a genuine "window around message N" Zero query, that is the one sanctioned `@xyne/shared` addition (design R5).                                                        |
| ~~Phase 9~~ | ~~Scope of the ticket / desks migration~~ — **resolved: `TicketDetailsScreen` in scope (9a); xyne-desks `messages-tab` deferred to 9b after chat is complete.**                                                                                |
| Anytime     | **Presence layer** (typing, read receipts, online/last-seen) is out of scope — needs backend. The jump-to-latest pill **is** in scope.                                                                                                         |
| Phase 0     | **How v3 is enabled** — local Settings toggle, default **on** for the test release (opt out in Settings). Not a CAC key.                                                                                                                          |
