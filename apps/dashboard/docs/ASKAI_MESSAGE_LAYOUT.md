# Ask AI sidebar — message layout

Both directions are rendered by `MessageItem` in
`dashboard/src/components/Chat/XyneAISidebar/components/MessageItem.tsx`,
branching on `message.type`. The answer body lives in `MessageContent`, a second
component in the same file.

Line numbers below are marked in the source with a `debug` class.

---

## Layout

```
        |<--------------- column: flex-1, full width --------------->|


         ___________________________________________
        |  ACTIVITY BLOCK                           |   thinking + tool calls,
        |  "Thinking…" 8-bit loader while live,     |   collapsed into one panel.
        |  click to expand reasoning + tool calls   |   Collapses to 0 height when
        |___________________________________________|   idle with no tools.
                       |  16px  (space-y-4)
         ___________________________________________
        |  PENDING ACTIONS       [Approve][Decline] |   human-in-the-loop, only
        |___________________________________________|   when the agent asks
                       |  16px
         ___________________________________________
        |  TOOL OUTPUTS                             |   charts / tables the
        |   [ chart ]  [ table ]                    |   tools produced
        |___________________________________________|
                       |  16px

         THE ANSWER          <-- no box: the bubble is bg-transparent,
         Lorem ipsum dolor sit amet, consectetur       so markdown text sits
         adipiscing elit sed do eiusmod tempor         bare on the background
         incididunt ut labore [1] et dolore.
         - bullet
         - bullet
                       |  16px
         ___________________________________________
        |  KEY POINTS  /  SUMMARIZER                |   whichever agentType
        |  • point one [2]                          |   selects (mutually
        |  • point two [3]                          |   exclusive)
        |___________________________________________|
                       |  16px
         ___________________________________________
        |  [file.pdf]  [chart.png]                  |   attachments the agent
        |___________________________________________|   generated
                       |  16px
         ___________________________________________
        |  INLINE CITATIONS   [1] [2] [3]           |   parsed out of the
        |___________________________________________|   <citation> block

        ===========================================
         everything ABOVE is inside the bubble
         everything BELOW is a sibling of it
        ===========================================

         ___________________________________________
        |  ! error title (CODE)                     |   only when the turn
        |    message / help text / >technical       |   failed
        |___________________________________________|
                       |  mt-3
         ___________________________________________
        | [Bug]Debug  12:04  Stopped   [<1/2>][⧉♡↻] |   meta row,
        |  left: muted            right: actions    |   justify-between
        |___________________________________________|
                       |  mt-3
         ___________________________________________
        |  (chip)  (chip)  (chip)                   |   follow-up prompts,
        |___________________________________________|   latest reply only
```

The user message is the mirror image — right-aligned, capped at `max-w-[80%]`,
and it _does_ draw a filled bubble:

```
                          ______________________________________
                    [✎]  |  Summarize this channel              |
                         |______________________________________/
                          ^ hover-only edit button        ^ 4px notch,
                            (gap-3 from the bubble)         bottom-right
```

### Notes

- **No left gutter.** The assistant avatar and its `gap-3` were removed, so a
  bot response starts at the column's left edge. `gap-3` now applies only to
  user messages, where the hover edit button needs to clear the bubble.
- **The bot bubble is invisible** — `bg-transparent`, no radius. The answer
  reads as bare markdown while the panels around it look like cards.
- **Vertical rhythm** — uniform `space-y-4` (16px) inside the bubble; each
  sibling below it carries its own `mt-3` (12px).
- **Almost everything is conditional.** A plain text answer with no tools
  renders only ACTIVITY BLOCK → ANSWER → meta row; the rest collapse to nothing.

---

## DOM tree

```
MessageItem  (bot / response path)

<div> .debug  group/message  flex  justify-start                          :1169
│      ← the message row. gap-3 only on user messages.
│
└── <div> .debug  flex-1  max-w-full  overflow-hidden                     :1198
    │      ← the column. (user: max-w-[80%], or max-w-[90%] w-full editing)
    │
    ├── <div> .debug  bg-transparent  text-foreground  max-w-full         :1212
    │   │      ← the "bubble" — INVISIBLE for bots (no bg, no radius)
    │   │
    │   └── MessageContent
    │       └── <div> .debug  space-y-4  max-w-full                       :1780
    │           │      ← vertical stack, 16px gaps, every child conditional
    │           │
    │           ├── <ActivityBlock>          thinking + tool calls
    │           ├── <PendingActionBlock>     approve / decline
    │           ├── <ToolOutputsSection>     charts / tables
    │           │
    │           ├── <div> .debug  bot-markdown-content  xyne-ai-markdown  :1812
    │           │   │      text-sm  leading-6  font-normal
    │           │   │      (+ streaming-answer-fade if it ever streamed)
    │           │   │      ← ★ THE ANSWER TEXT
    │           │   └── StreamingMarkdownBlocks  ─or─  renderAnswerBlock
    │           │       (per-block, once streamed)  (single parse for history)
    │           │
    │           ├── <SummarizerContent> ─or─ <GeniusKeyPoints>   (by agentType)
    │           ├── <div> .debug  space-y-2  → AttachmentPreview[]        :1849
    │           └── <InlineCitations>       from the <citation> block
    │
    ├── <div> .debug  mt-3  border-destructive/20  bg-destructive/5  p-3  :1373
    │         ← error panel, only if message.errorInfo
    │
    ├── <div> .debug  mt-3  flex  items-center  justify-between           :1443
    │   │     ← meta row. Hidden mid-stream unless onDebug exists, so it
    │   │       isn't an empty mt-3 gap while streaming.
    │   ├── <div> .debug  flex items-center gap-2 text-muted-foreground   :1444
    │   │         [Debug] [timestamp] [Stopped]
    │   └── <div>  flex items-center gap-2
    │             [BranchNavigator] [MessageActions: copy/feedback/regen]
    │
    └── <div> .debug  mt-3  flex flex-wrap gap-2                          :1498
              ← follow-up suggestion chips


MessageItem  (user path — differences only)

<div> .debug  group/message  flex  justify-end  gap-3                     :1169
├── <button>  hover-only edit pencil (opacity-0 → group-hover)
└── <div> .debug  max-w-[80%] overflow-hidden                             :1197
    └── <div> .debug  px-5 py-3  [border-radius:16px_16px_4px_16px]       :1211
              bg-accent  text-foreground  md:block md:w-fit
              ← the filled bubble; 4px notch at bottom-right
              (editing swaps to :1210 — rounded-2xl bg-accent p-3)
```

---

# Ask AI input box — feature audit (pre-redesign)

Captured before the composer UI rework, so behaviour can be diffed afterwards.

**Files**

- `components/XyneAIInputSection.tsx` (81 lines) — thin wrapper; pairs the input
  with the `ContextPickerPanel` overlay. Forwards every prop and the ref.
- `components/XyneAIInputBox.tsx` (~2270 lines) — everything below.
- `components/ContextPickerPanel.tsx` — the ⌘/ modal.
- Shared: `ui/InputBox/VoiceInput`, `ui/Selectors/MentionSelector`,
  `ui/TipTapExtensions` (`MentionExtension`, `ChannelMentionExtension`,
  `LinkSyncPlugin`).

## Shape

```
 ______________________________________________________________
| (thread…) (#channel) (file) (📎doc.pdf) (3 activities)        |  row 1: pills
|                                                               |
|  Ask Xyne AI                                                  |  row 2: editor
|                                                               |
|[/] [▤] [+] | [🌐] | [🔬] | [🗎] [agent ▾] [model ▾]  [🎤] [ ↑ ]|  row 3: toolbar
|______________________________________________________________|
```

Container:
`bg-card border border-input focus-within:border-ring rounded-2xl py-2 px-2 flex flex-col gap-3`.
Wrapped in `.xyne-voice-border-wrap` while recording. Rows 1 and 3 are both
hidden when `isOnboarding`.

## Row 1 — context pills

Horizontally scrollable (`overflow-x-auto flex-nowrap`), thin scrollbar. Holds
**only pills** — the `/` and collection buttons live in the toolbar — so the
whole row is gated on `hasContextPills`. An empty flex row would still
contribute its `pb-2` as a phantom gap above the editor.

One pill per attached context. Every pill is `h-7 rounded-lg border`, and every
one has an `X` to remove it.

| Pill            | Icon          | Click does                                                     | Notes                                                                                                                 |
| --------------- | ------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Thread          | —             | Navigates to `/chat/dir/{channelId}/{conversationId}`          | Shows `sender • preview`                                                                                              |
| Canvas          | `FileText`    | Navigates to `/chat/canvas/{id}`                               | Removing it **cascades**: also drops every selection for that canvas and sends `REMOVE_CANVAS_CONTEXT` to the machine |
| Selection       | `FileText`    | Navigates to the canvas                                        | One pill per selection; removal sends `REMOVE_SELECTION` with the per-canvas index                                    |
| Browser         | `Globe`       | Opens the URL (`electronAPI.openExternal`, else `window.open`) | Fed by the `xyne-ai-browser-context-ready` event / sessionStorage; text capped at 5000 chars                          |
| Channel         | `Lock` or `#` | —                                                              | **Max 5**; duplicate or over-limit shows a toast                                                                      |
| File scope      | `FileText`    | —                                                              | Narrows retrieval to specific files                                                                                   |
| Collection      | `BookOpen`    | —                                                              | Auto-added when opened from /knowledge-base; re-added on `kbOpenNonce` bump                                           |
| Attachment      | `FileText`    | —                                                              | Local, base64-encoded                                                                                                 |
| Ticket          | `Ticket`      | —                                                              | Shows `xyneId` or title                                                                                               |
| Canvas (picker) | `FileText`    | —                                                              | From the context modal                                                                                                |
| Transcript      | `Phone`       | —                                                              | From the context modal                                                                                                |
| Recording       | `Mic`         | —                                                              | From the context modal                                                                                                |
| Activities      | —             | —                                                              | **Aggregated**: one pill reading "N activities"; X clears all                                                         |

On mobile the pills switch to `rounded-full` with tighter padding.

## Row 2 — editor

TipTap (`useEditor`), `min-height: 20px; max-height: 140px; overflow-y: auto`.

- **Extensions**: `StarterKit` (default config — lists, code blocks and
  blockquote are all live), `Placeholder` (hard-coded **"Ask Xyne AI"**),
  `Link` + `LinkSyncPlugin`, `MentionExtension`, `ChannelMentionExtension`,
  `VoiceShimmerMark`.
- **Value is plain text.** `onUpdate` emits `editor.getText()` — undebounced,
  every keystroke. Mentions survive only via a parallel `userTags` map built by
  walking the doc for `mention` nodes.
- **`@`** opens the user `MentionSelector` (`useMentionSearch`).
- **`#`** opens the channel `MentionSelector`; picking adds a channel pill.
- **Autofocus** once on mount via `requestAnimationFrame`, skipped if another
  input/textarea already has focus.
- While recording, the editor is hidden and replaced by an animated 5-bar
  waveform + "Listening…".

## Row 3 — toolbar

Left group — each button renders **only if its callback prop is passed**:

| Button          | Icon         | Does                                 | Disabled state                                                               |
| --------------- | ------------ | ------------------------------------ | ---------------------------------------------------------------------------- |
| Add context     | `/` glyph    | Opens `ContextPickerPanel` (⌘/)      | — carries the `-ml` offset so the first glyph aligns with the container edge |
| Collections     | `BookOpen`   | Opens the KB dropdown (see Overlays) | —                                                                            |
| Attach files    | `Plus`       | Opens the hidden file input          | —                                                                            |
| Web search      | `Globe`      | Toggles web search                   | `!webSearchAccessible` → 50% opacity, not-allowed, "You don't have access"   |
| Deep research   | `Microscope` | Toggles deep research                | same pattern via `deepResearchAccessible`                                    |
| Create canvas   | `File`       | Toggles canvas creation for the turn | —                                                                            |
| `AgentSelector` | —            | Picks the claw agent                 | `compact`                                                                    |
| `ModelThinkingSelector` | —    | Pins a model + per-message thinking  | Shared with the /ai composer; Recommended row, search, Thinking flyout       |

Enabled toggles go `bg-muted` + a status colour (`text-status-success` for web
search, `text-status-pending` for deep research, `text-primary` for canvas).
Thin `h-4 w-px` dividers sit between them.

Right group:

| Button         | Icon                   | Does                                                                                                                                                                |
| -------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice          | `VoiceInput` (mic)     | Dictates into the editor. Disabled while streaming                                                                                                                  |
| Submit / Abort | `ArrowUp` / `StopIcon` | `onSubmit()`, or `onAbort()` while streaming. `rounded-full`. **Disabled when `!isStreaming && !inputValue.trim()`** — so an attachment-only message cannot be sent |

## Overlays

- **`ContextPickerPanel`** — the ⌘/ modal, owned by `XyneAIInputSection`.
  Categories: channels, tickets, canvases, calls (transcripts + recordings are
  both mapped to `call`), activity. Position is `top` or `bottom` per
  `contextPanelPosition`.
- **Collection / KB dropdown** — absolutely positioned above the composer
  (`bottom-full left-4 right-4`). Two modes:
  - _Collections list_ — click to select (multi), **double-click to open**.
  - _Folder view_ — breadcrumb + back arrow, double-click a folder to descend,
    click a file to toggle it into `fileScopes`. Search box filters either mode.
  - When the active agent has `agentKbGrants`, the drill-down is filtered to
    only what that agent can read (whole-collection grants cascade to children).
  - Closes on outside mousedown; resets nav stack and query on close.

## Keyboard

| Key                         | Behaviour                                                                     |
| --------------------------- | ----------------------------------------------------------------------------- |
| `Enter`                     | Submits. Yields to the mention menus if open; blocked when streaming or empty |
| `Shift+Enter`               | Newline (TipTap default)                                                      |
| `⌘/` `Ctrl+/`               | Opens the context modal                                                       |
| `Escape`                    | Closes the context modal (when open)                                          |
| any printable / `Backspace` | Closes the context modal, keystroke still lands in the editor                 |

Not supported: the global `enterSendsMessage` preference, ⌘⇧V plain paste,
Escape-to-cancel, and any `useScope`/`useShortcutById` registration.

## Paste, files, drag & drop

- **Paste**: files are attached; text over **11500 chars** becomes a `.txt` or
  `.json` attachment (JSON detected by `JSON.parse`). No table/TSV handling.
- **Drag & drop**: via the `addFiles` imperative handle, wired by the sidebar's
  `useDragAndDropAreaRef`.
- **Limits**: 10 MiB per file, 25 MiB total, 20 files — deliberately aligned
  with claw-auth's run-stream rehydration caps.
- **Blocklist**: `DANGEROUS_EXTENSIONS` from `@xyne/shared`.
- Files are read via `FileReader.readAsDataURL` and held **base64 in component
  state**, then handed up through `onAttachmentsChange`.

## Imperative API (`XyneAIInputBoxHandle`)

`addFiles(files)` · `clearContent()` · `insertContent(html)` ·
`isSuggestionOpen()` · `focus()`

## Props that change the UI

| Prop             | Effect                                                        |
| ---------------- | ------------------------------------------------------------- |
| `isOnboarding`   | Hides the context bar **and** the whole toolbar — editor only |
| `compactToolbar` | Toolbar wraps (`flex-wrap`) instead of `justify-between`      |
| `tightToolbar`   | Smaller button padding (`p-1` vs `p-1.5`)                     |
| `isStreaming`    | Submit becomes Abort; voice disabled                          |
| `isMobile`       | `rounded-full` pills, `rounded-[26px]` container              |

---

# Context modal (⌘/) — positioning, contents, data

## Positioning — `XyneAIInputSection.tsx`

Not a portal and not a dialog. It's an absolutely-positioned **sibling of the
input**, anchored to a `relative` wrapper (`:38`) that wraps both:

```jsx
contextPanelPosition === 'top'
  ? 'absolute top-full left-0 right-0 z-20 pt-2' // hangs BELOW the input
  : 'absolute bottom-full left-0 right-0 z-20 px-4 pb-2'; // sits ABOVE it (default)
```

Two things that read backwards:

- **The prop names the panel's side, not the direction it opens.** `'bottom'`
  (default) = "panel at the bottom of the composer stack", which renders it
  _above_ the input via `bottom-full`. The sidebar passes `'bottom'`; the
  fullscreen landing hero passes `'top'` because its composer sits mid-screen.
- **Only the bottom variant has `px-4`** — inset 16px each side when above the
  input, edge-to-edge when below. Likely a leftover from when the input itself
  carried `px-4`.

**Backdrop** (`:42-52`) — a `fixed inset-0 z-10` transparent `<button>` (a
button, not a div, so it's keyboard-reachable). Click or Escape closes; it sits
below the panel's `z-20`. Note there is a **second** Escape handler in the
editor's `handleKeyDown`, plus the "any printable key closes it" rule — closing
is handled in two places depending on where focus is.

## What it renders — `ContextPickerPanel.tsx`

A fixed `h-[420px]` column, `rounded-2xl bg-popover border shadow-xl`:

1. **Body (`flex-1`)** — just `GlobalCommandMenu`, the app's ⌘K menu reused via
   `contextSelectionMode` + `inline` + `disableAutoFocus`. The search box, tab
   strip and result rows are all ⌘K's; the picker contributes no UI there. Tabs
   (`:116`): Channels · Tickets · Canvas · Call · Recording.
2. **Confirm footer** — `border-t bg-muted/50`, live count on the left ("N items
   selected"), Cancel + **Add to context** on the right (disabled at zero).

**Selection model** — five `Map`s (`:141-155`) seeded from `initialSelections`.
Selections are **staged**: nothing reaches the composer until confirm, which
calls `saveRecents` per category then `onConfirm`. `handleTabChange` (`:337`)
exists because transcripts and recordings both arrive as `type: 'call'` — the
toggle handler reads the active tab to know which Map to write to.
`toAttachedContext` (`:62`) later collapses them back to `'call'`, so the tab
distinction is UI-only.

## Rebuilding this UI — is the data available?

**Yes.** `ChannelCommandMenu` is a 4354-line _renderer_ that fetches almost
nothing; everything comes from one hook call (`:435`):

```js
const { searchResults, isSearching, searchError, paginationState, isLoadingMore,
        loadMoreRef, setScrollContainer, text, setText, activeTab, setActiveTab,
        filteredLocalUsers, filteredLocalChannels, ... } = useSearchMetrics({ ... })
```

`hooks/useSearchMetrics.ts` (1670 lines) owns the Vespa query, debouncing,
pagination, tab state, filter parsing (`in:`/`from:`/`type:`), local
channel/user filtering and analytics. It is **already proven reusable** — four
independent consumers render it differently today: `ChannelCommandMenu` (⌘K),
`SearchResults.tsx` (full page), `CallHistoryScreen`, and
`TicketFiltersDropdown`. A new picker would be a fifth.

Results arrive as `DisplaySearchResult[]` —
`{ type, id, title, subtitle, context?, avatar?, metadata{channelName,timestamp,status,fileSize,unreadCount}, searchContext, relevanceScore }`.
`SearchResultItem.tsx` (425 lines) is the row renderer, reusable or replaceable.

**What is NOT in the hook** and would need reimplementing (all small, all in
`ChannelCommandMenu`):

1. **Grouping** (`:1811-1837`) — ~25 lines. Non-obvious: `attachment` results
   are re-bucketed by `searchContext.subApp`, and `subApp === 'transcript'`
   splits into `transcript` vs `recording` **purely off `activeTab`** — the
   backend doesn't distinguish them.
2. **Tab→group filtering** (`:2049-2060`).
3. **Tab strip definitions** (`:1883-1888`) — labels + icons.

## `contextSelectionMode` has two consumers — don't strip it

|            | Ask AI (`ContextPickerPanel:411`) | Thread panel (`ThreadPannel:1458`)             |
| ---------- | --------------------------------- | ---------------------------------------------- |
| Mode       | `inline`, in a 420px box          | **not** inline — full ⌘K dialog                |
| Confirm UI | its own footer                    | `ThreadContextPanel` right-side tray (`:4109`) |
| Tabs       | `enabledTabs` = 5                 | default set                                    |
| Focus      | `disableAutoFocus`                | autofocuses                                    |

The mode does five things inside `ChannelCommandMenu`; only two are non-inline
only (`:4109` tray, `:4335` wider dialog). The rest — disabled queries (`:289`,
`:310`), click interception (`:1640`, `:1681`), and ~9 `isSelected` checks
(`:2037`–`:2512`, `:3943`) — are shared.

Selection is matched on the composite id `` `${type}-${id}` ``. A new UI must
keep producing that shape if it reuses `SearchResultItem`, or own selection
state entirely.

**Net: replacing the Ask AI picker is contained** — nothing outside it breaks,
and the thread panel keeps working untouched.
