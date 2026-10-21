# Chat v3 — Visual & Behavioural Parity (blocking gap)

**Date:** 2026-08-23 · **Status:** open, blocks any v3 rollout
**Companions:** [`chat-v3-design.md`](./chat-v3-design.md) · [`chat-v3-implementation-plan.md`](./chat-v3-implementation-plan.md) · [`chat-v3-code-review.md`](./chat-v3-code-review.md)

## The requirement, stated correctly for the first time

> **v3 must be visually and behaviourally indistinguishable from v2.** Same pixels, same chrome, same
> gestures, same landings. The *only* permitted differences are that it is faster and does not exhibit
> the B1–B13 defects. Everything the user can see or feel stays identical.

**This document exists because the design doc got that wrong.** Design §9 is a *feature* checklist —
"reactions present", "link previews present". A row can tick every box and still look nothing like v2.
Parity was specified at the wrong altitude, and v3 was built to the letter of it.

Add to design §2.1 as **G10** and treat it as the release gate above all others:

| # | Goal | Acceptance signal |
|---|---|---|
| G10 | **Pixel and gesture parity with v2.** | Side-by-side screenshots of the same conversation on the same device are indistinguishable. Any diff is a bug, not a design decision. |

---

## Root cause: v3 rebuilt the presentation layer instead of reusing it

v2 renders every row through a **design-token contract** — `ChatRenderTokens`, defined in
`v2/components/chat/message-row.tsx`, resolved once per list by
`v2/components/chat/chat-render-tokens.ts`, and consumed by **ten** modules (`chat-paint-row-lite`,
`chat-paint-render-pieces`, `message-row`, `chat-list`, `chat-thread`, and the ticket / forwarded /
timestamp / composer parts).

It carries 22 scalar tokens plus a 12-colour username palette and an 8-colour mention palette:

```
foreground · foregroundMuted · rootTextUser · rootTextOther · rootMetaUser · rootAccentUser
cardBg · brand · ambientAccentColor · linkColor · linkColorUser · inlineContentMaxWidth
windowWidth · actionPrimaryColor · mutedForeground · forwardedBgUser · forwardedBgOther
embeddedBgUser · embeddedTitleUser · embeddedMutedUser · ticketPriorityLowColor
currentUserBubbleBg          ← the own-message bubble green (#d8fdd2)
usernamePalette[12]          ← per-sender name colours
mentionPalette{8}            ← otherBg/otherText/currentOtherBg/currentOtherText/
                               mentionedYouBg/mentionedYouText/currentSelfBg/currentSelfText
```

**v3 consumes none of it.** `grep` across `v3/rows/` finds zero references to `ChatRenderTokens`,
`chat-render-tokens`, or `useSelectedChatBubbleContentTokens`. Instead the rows were written with
generic utility classes — `MessageRow.tsx:85` is
`className='w-full gap-1 rounded-lg border border-foreground/10 bg-card px-3 py-2'`. Only two files
touch the theme at all (`MessageRowBody.tsx` reads `--color-foreground` and `--color-brand`;
`useSenderColor.ts` reads the username palette vars).

That is the whole explanation for "doesn't look the same at all". It is not a set of tweaks — v3
bypasses the design-token layer, so **every** colour, inset and max-width is a coincidence rather than
a match.

### Specific visual consequences

| v2 | v3 today |
|---|---|
| Own-message bubble uses `currentUserBubbleBg` (#d8fdd2) | generic `bg-card` — no green bubble |
| Forwarded blocks use `forwardedBgUser` / `forwardedBgOther` | generic card background |
| Mentions use an 8-colour palette that distinguishes *you were mentioned* from an ordinary mention, and own-bubble variants | not implemented |
| Embedded/quoted blocks use `embeddedBgUser` / `embeddedTitleUser` / `embeddedMutedUser` | generic border + card |
| Links use `linkColor` / `linkColorUser` (different inside own bubble) | single brand colour |
| Bubble width from measured `inlineContentMaxWidth` / `windowWidth` | hard-coded `w-[86%]` (`MessageRow.tsx:70`) |
| Timestamps/meta use `rootMetaUser` / `rootAccentUser` | `text-muted` |

### The dropped feature nobody listed

**User-selectable chat themes are absent from v3 entirely.** v2 wires
`useSelectedChatBubbleContentTokens` into `chat-render-tokens.ts`, backed by a whole settings surface
at `app/(protected)/settings/chat-theme/` (`index.tsx`, `chat-bubble.tsx`, `chat-bubble-preview.tsx`,
`_layout.tsx`). A user who has picked a bubble theme sees it in v2 and does not in v3.

This was missed by the design doc's §9 **and** by the parity audit, because both walked
`features/chat/v2/**` and this feature's entry point lives under `app/(protected)/settings/`. Add it to
§9 under "Chat surface chrome".

---

## Why this happened — a real hole in the §8.1 reuse gate

The gate says *"reuse the knowledge, never the mess"* and offers **Adopt / Refactor-then-adopt /
Rewrite**. Applied to `ChatRenderTokens` it produces the wrong answer, because the gate's audit step
asks only "is this code clean?" — and a token table is neither clean nor messy, it is **the product**.

**Amend §8.1 with a fourth category, ranked above the other three:**

> **Adopt-verbatim (mandatory).** Any module that *defines what the user sees* — design tokens, theme
> resolution, palettes, spacing/measurement constants, bubble chrome — is adopted **unchanged**,
> regardless of its code quality. These are not implementation, they are specification. Rewriting them
> silently changes the product. If such a module is genuinely unreadable, adopt it first, ship parity,
> and clean it in a **separate** commit that is proven no-op by screenshot diff.

`ChatRenderTokens` + `chat-render-tokens.ts` + `useSelectedChatBubbleContentTokens` are the canonical
Adopt-verbatim set. So are `chatPaintSizing`'s height constants and `getUserColor`'s palette mapping.

---

## Behavioural gap: activity → message landing

Reported not working. The pure layers **are** correct — `revealPolicy.ts:25–29` maps
`intent.requestedMessage` to `{ kind: 'anchor', conversationId, createdAt }`, `entryPoint.ts:9` accepts
`'activity'`, and `resolveSurface.ts:50` branches on it. 338 logic tests pass over exactly this.

So the break is **below the tested layer** — in the wiring, not the policy. The candidates, in the
order they should be checked:

1. **Do the route params reach `parseOpenIntent`?** Activity passes `conversationId` / `createdAt` /
   `messageId`; if the v3 screen reads different param names than the activity surface writes, the
   intent silently classifies as `tail` and the landing is skipped. A tail open with no error is
   exactly "nothing happens".
2. **Does `landingIndex` find the row?** If the anchor row is outside the loaded window, the machine
   should reach `error{anchor-unreachable}` — verify it does rather than sitting in `placing` until
   the 1,500 ms budget forced-reveals at the tail.
3. **Is `initialScrollIndex` actually passed?** Check `legendListProps.ts` emits it for
   `target.kind === 'anchor'` and that `ConversationList` forwards it.
4. **Is `landingConfirmed` ever dispatched?** `useLandingMetrics` must report the target row's
   position; if it never fires, `placing → ready` happens only via the timeout, at the wrong place.

**This is the F2 gap from the code review, made concrete.** Every one of those four is a wiring
question, and v3 has 338 logic tests and — until this week — zero render tests. The policy is proven;
the plumbing is not. Every open path (tap, notification, deeplink, activity, search, share, restore)
needs an end-to-end test that asserts the *rendered* landing position, not the computed target.

---

## P1 — DONE and verified (2026-08-24)

Verified against the code, not the report:

| Claim | Evidence |
|---|---|
| `ChatRenderTokens` in a shared home | `src/theme/chatRenderTokens.ts` exists; `v2/.../message-row.tsx:53-56` imports **and re-exports** it — v2 and v3 now share one contract |
| v3 resolves once at the list | `ConversationList.tsx:86` — `useResolvedChatRenderTokens(windowWidth)`, provided via `ChatRenderProvider` |
| Rows read from context, not CSS vars | `MessageRowBody`, `MessageRowFooter`, `InlineRichText`, `useSenderColor` all call `useChatRenderTokens()`. `useCSSVariable` survives only in two **overlay** files (sheets, not per-row) — acceptable, off the hot path |
| Own bubble uses the token | `MessageRow.tsx:87` — `style={mine ? { backgroundColor: tokens.currentUserBubbleBg } : undefined}` |
| Tests | 348 pass; lint clean |

**Two type errors shipped with P1 and were fixed during this review** — `useDataFacts.ts:20`
(`exactOptionalPropertyTypes` on the unread hints) and `MessageRowBody.tsx:45`
(`mentionsYou?: boolean` passed to a `boolean` param). Same pattern as F1: **green tests, red types.**
`npx tsc --noEmit` must be part of the definition of done, not an afterthought.

**Note on `chatRenderTokens.wiring.test.ts`:** it asserts by regex over *source text*
(`/currentUserBubbleBg/.test(row)`). That guards the regression, but it would also pass if the token
appeared only in a comment. Treat it as a tripwire, not a test — the real guard is P3.

---

## P2 — DONE (2026-08-24): v2 row anatomy + pinned height constants

`MessageRow.tsx` now matches v2 topology:

```
Pressable[py-1 flex-row items-end gap-2 · justify]
  ├─ MessageRowAvatar          sibling, bottom-aligned, AVATAR_SIZE = 24, h-6 w-6 spacer
  └─ View[max-w-[78%] · fixedBubbleStyle]
       ├─ View[rounded-xl px-2 py-1.5 · bubbleBg]
       │    ├─ SenderNameLabel     inside the bubble
       │    └─ content + MessageRowMeta
       └─ MessageRowReactions      outside the bubble, inside the column
```

`MessageRowHeader.tsx` is gone. Reaction rows lift the avatar with `REACTION_ROW_HEIGHT`.
`SystemMessageRow` reads `tokens.mutedForeground`. Production v3 still must not import `v2/**`.

Height constants are pinned to v2 `chatPaintSizing` in
`src/features/chat/v3/__tests__/paintSizingParity.test.ts` (test-only v2 import). `measureRowHeight`
numbers already matched (72 / 36 / 30 / 56 / 52 / 228 / 220 / 176 / 86 / 26 / 24 / 300 / 8.8 / 3200).

---

## Remediation plan — do these in order

### ~~P1. Adopt the token layer verbatim~~ ✅ DONE — see above
- [x] Move `ChatRenderTokens` (the type) out of `v2/components/chat/message-row.tsx` into a shared,
      non-`v2` home — e.g. `src/theme/chatRenderTokens.ts`. **Type + constants only, no behaviour
      change.** v2 imports it from the new location; this is the one sanctioned v2 edit and it is a
      pure move.
- [x] Adopt `chat-render-tokens.ts` **unchanged** into `v3/theme/` (or import it from the shared home).
- [x] Wire `useSelectedChatBubbleContentTokens` so user-selected chat themes work in v3.
- [x] Resolve tokens **once at the list** and pass them down, exactly as v2 does — the comment in the
      type ("read once at the list and indexed per sender so rows pay zero per-row CSS-variable
      subscriptions") is a performance contract, not a note. Per-row `useCSSVariable` calls, which
      `useSenderColor.ts` currently does, are the pattern v2 deliberately avoided.
- [x] Replace every generic utility class in `v3/rows/**` that stands in for a token with the token.

### ~~P2. Bubble geometry~~ ✅ DONE — see above
- [x] Replace `w-[86%]` with `inlineContentMaxWidth` / `windowWidth`-derived width.
- [x] Reconcile paddings, radii, gaps and avatar/spacer sizes against v2 by measurement, not by eye.
- [x] Characterisation test pins v3 height exports to v2 `chatPaintSizing` (no production v2 import).

### P3. Row catalog / screenshot harness *(partial — JSON tripwire, not pixel G10)*
- [x] Catalog every row kind as `ConversationInput` in `v3/parity/rowCatalog.ts`: text, long/collapsed,
      emoji-only, media ×4, ticket, ticket-activity, flow-json, forwarded, system, call-transcript,
      bot, deleted, with/without reactions/replies/parent-preview, pinned, bookmarked, edited —
      × own/other × DM/channel.
- [x] Node test: catalog → `buildRows` → expected `rowKind` / `rowType` + `measureRowHeight` finite.
- [ ] **Still open:** pixel screenshot diff of the same fixtures in v2 and v3 (light/dark). This repo
      has no Maestro/Detox harness; a JSON/height catalog is **not** G10. Do not ship a production
      gallery screen.

### P4. Wiring tests for every open path
- [x] tap · notification (channel/thread) · deeplink · activity · search · share · restore catalogued
      in `v3/parity/openPathCatalog.ts`.
- [x] Each path: `parseOpenIntent` → `classifyOpen` → `landingIndex` → `legendListProps`
      (`openPathLanding.test.ts`). Missing-anchor activity opens emit no `initialScrollIndex`.
- [x] Render-level: `tests/unit/features/chat/v3/landing-render.test.tsx` mocks LegendList and asserts
      it **receives** `initialScrollIndex` / `initialScrollAtEnd` (same mock pattern as list-chrome).
- [ ] Device confirmation that `landingConfirmed` fires before the 1,500 ms placing timeout.

### P5. Re-audit §9 for other presentation-layer features living outside `features/chat/v2/`
- [x] chat-theme settings — `app/(protected)/settings/chat-theme/` (`index`, `chat-bubble`,
      `chat-bubble-preview`, `_layout`). Already in design §9. Wired through
      `useSelectedChatBubbleContentTokens` → `src/theme/useChatRenderTokens` → list
      `ChatRenderProvider`. v3 rows consume the selected bubble.
- [x] Other chat presentation outside `v2/**` (shared by v2 and v3, not a v3-only gap):
      - `src/components/chat/chat-header-v3` / `thread-header-v3` — v3 screens already mount these
        with the same collapsed-height spacer as v2.
      - `src/theme/chatBubbleTheme.ts`, `chatBubbleContentTokens.ts`, `BubbleAccentProvider.tsx` —
        bubble preference + tab/composer accent. Not list-row chrome.
      - `join-channel-card`, composer "also send to channel", empty-state illustration, Call prejoin —
        selected-bubble tokens, off the message-row hot path.
- [x] In-row forwarded quote — v3 now paints the v2 quote card (coloured left border, original
      sender + time, original body, "Posted in" + channel/DM icon) from `parseForwardedMessageXml`,
      with the outer bubble body using `optionalText` instead of the raw XML. Navigation uses
      `useForwardedMessageNavigation`.
- [x] In-row parent/thread preview — v2 "Replied to thread:" quoted card; tap opens the parent
      thread with `from: 'channel_thread'`.
- [x] Scroll-to-bottom pill — v3 list hosts the same 32px chevron control (glass on iOS 26, `bg-muted`
      fallback) when the user has scrolled away from the tail. Composer "also send to channel" was
      already on the shared `ConversationInput` via `threadId`.
- [x] Join-channel card — v3 always mounts `ChatComposerDock` and puts the shared
      `JoinChannelCard` inside it (same sticky keyboard geometry as v2). Long-press is a no-op
      while the join card is showing.
- [x] Pinned / links / files headers — files now uses the same glass `HeaderPill` + channel
      subtitle + gradient fade as pinned and links (`FilesHeaderV3`).
- [x] Message-actions sheet — transparent floating sheet, 42×42 accent quick-react circles,
      shadowed 28px action panel. SmilePlus opens the shared emoji picker (not who-reacted).
- [x] Who-reacted sheet — `{n} reaction(s)` title, All + per-emoji chips, 32px avatars, `You`,
      `ReactionEmojiDisplay`. Row pills open this sheet; the actions rail still toggles.
- [x] Ticket-thread parent card — v3 injects `parentTicketMd` / `parentTicketId` onto the first
      thread row (same as v2) and tapping that card returns to Overview.
- [x] Thread parent vs replies — after the first message, v3 paints the v2 `N replies` + hairline
      divider. In-bubble reply chrome stays stripped. The thread list shell no longer uses
      `overflow-hidden`, so tall ticket/Flow cards are not clipped.
- [x] Thread composer — placeholder is `Reply to thread`; opening a thread/tab dismisses the
      keyboard instead of auto-focusing. Markdown lists use the native list-end guard.
- [ ] G10 screenshots still need a device with the flag on (side-by-side vs v2).

---

## Answering "how is v3 better then?"

Fairly: **right now, it isn't** — and the reason is worth stating precisely, because it is not that the
architecture is wrong.

What v3 has actually achieved is real and measured: 110 refs → 15, ~73 effects → ~27, 2,669-line files
→ 302 max, 4 test files → 35 with 338 passing, zero `useState` in the data layer, a total reducer with
`assertNever`, and B4 closed. That is the *structural* win the doc promised, and it is genuinely there.

What it has not achieved is the thing users actually experience. The design doc asked for feature
parity and got feature parity; it never asked for **fidelity**, so v3 rebuilt the presentation layer
from scratch and it diverged. A chat that behaves correctly but looks wrong is not an improvement —
it is a regression with better internals.

The fix is not architectural. P1–P2 are adoption work against a token contract that already exists and
already works. The state machine, the row model, the single-pass paint and the test discipline all
stay exactly as they are — they were never the problem.

**Nothing in v3 should ship until the P3 screenshot diff is clean and P4's landing tests pass.**
