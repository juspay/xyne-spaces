# Channel Tickets: per-channel tickets table on mobile

Status: phase 1 implemented (`src/features/channel-tickets/`); phases 2-3
pending

Related: `src/features/xyne-desks/tickets/` (desk tickets list, the structural
template), web
`apps/dashboard/src/components/Chat/ConversationPannel/ConversationPannel.utils.tsx`
(`useConversationTabs`), web `KanbanBoardScreen.tsx` table layout, web
`TicketTable.tsx`.

## Scope

Add a **Tickets** entry to a channel that opens a read-only, paginated table of
the tickets belonging to that channel, with server-side filters and tap-to-open
into the existing ticket detail screen.

Decisions already taken:

| Decision                    | Choice                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Entry point                 | Row in the channel **Info** screen (with About / Members / Files / Pins / Canvas / Links)    |
| Columns (v1)                | Ticket (xyneId + title), Board, Status, Priority, Assignee, Due date, Stage, Created at, Age |
| Filters (v1)                | Server-side: assignee, priority, stage. Client-side: board. No client sort. Newest first.    |
| Search                      | Inline bar: local window match + channel-scoped Vespa, hydrated via `ticketsByIds`           |
| Table engine                | `@tanstack/react-table` (headless) for the column model; `LegendList` for virtualised rows   |
| Count badge on the Info row | No                                                                                           |
| Ticket creation             | Out of scope                                                                                 |
| Inline edits                | Out of scope                                                                                 |
| Labels column               | Out of scope (needs the unpaginated query)                                                   |
| `shared/` bump              | **Not allowed.** Everything below uses the pinned snapshot as-is.                            |

## What the web does (reference)

- **Gate** (`useConversationTabs`): Tickets tab shows only when
  `useCanReadTicket()` is true (TICKETS resource, READ/WRITE/ADMIN) **and** the
  channel is not DM / GROUP_DM.
- **Render**: `<KanbanBoardScreen channelId={channelId} />` in
  `viewMode='project'`, with `projectId = channel.projectId`. Table layout uses
  `ticketsQueryV2({ channelId, projectId, excludeFlowSteps })` (unpaginated) and
  hands rows to ag-grid `TicketTable`.
- **Query semantics**: `channelId = X`, `ticketType != 'Support'`,
  `rootId IS NULL`, `createdAt desc`.
- **Row click** (non-desk channels):
  `/chat/dir/:channelId?tab=tickets&ticketId=&conversationId=`.
- **Status pill colours**: TODO orange, STARTED blue, PAUSED teal, CANCELLED
  red, COMPLETED green. **Priority**: signal bars (Low 1 / Medium 2 / High 3) or
  alert (Critical).

## Constraints from the pinned `shared/` snapshot

`@xyne/shared` is the workspace package `packages/shared`. Relevant differences from web:

| Capability                                                                                                   | Web shared          | Mobile snapshot | Consequence                                                             |
| ------------------------------------------------------------------------------------------------------------ | ------------------- | --------------- | ----------------------------------------------------------------------- |
| `channelId` arg on `ticketsQueryV2` / `kanbanTicketsPageV3`                                                  | yes                 | **no**          | Cannot use the web's exact query                                        |
| `tickets.rootId` (flow-step tickets)                                                                         | yes                 | **no**          | Cannot exclude flow steps; they show as rows                            |
| `supportTicketsPageV3` (channelId, isMember, assignedTo, priority, stageName, aiCategory, limit, start, dir) | yes (superset args) | yes             | **Use this.** Paginated, ACL-gated, already proven by the desks feature |
| `stagesByBoards({ projectId })`                                                                              | yes                 | yes             | Stage filter options for a chat channel                                 |
| `useCanReadTicket`                                                                                           | yes                 | yes             | Gate works (permissions are dispatched in `InitialStateLoader.tsx`)     |
| `isDeskChannelType` (`@xyne/shared`)                                                                         | yes                 | yes             | Exclude desk channels (they have xyne-desks)                            |

Notes on `supportTicketsPageV3`:

- It is `zql.tickets.where('channelId')` with no ticket-type or archive filter.
  It works for any channel; the "support" in the name is historical.
- Order is `(lastEmailAt desc, id desc)`. Non-desk tickets are created with
  `lastEmailAt = createdAt` (web backend `ticketRepository.ts`), so for chat
  channels this is createdAt-desc in practice.
- It relates only `emailDrafts` and `emailReads` (cheap; no project/tags
  payload).
- ACL needs `channelId` + `isMember`. `isMember` comes from
  `useUserChannelStatuses()`.
- Server-side the registered query accepts a superset of these args, so sending
  the mobile subset is compatible.

Rows dropped client-side after the page arrives: `isArchived === true`,
`ticketType === 'Support'`. A page may therefore come back short; that is
accepted.

## Architecture

New feature module, same layout as `src/features/xyne-desks/tickets/`:

```
src/features/channel-tickets/
  load.ts                        deferred entry: lazy screen, warm-up hook (see Load-on-Info)
  gate.ts                        canShowChannelTickets (pure; the only eager import besides load.ts)
  types.ts                       ChannelTicketRow, ChannelTicketsFilters, column key type
  constants.ts                   PAGE_SIZE, MAX_PAGES, ROW_HEIGHT, HEADER_HEIGHT
  columns.ts                     TanStack ColumnDef<ChannelTicketRow>[] with widths + meta
  utils/
    map-channel-ticket-row.ts    Zero row -> ChannelTicketRow (drops archived / Support)
    format-ticket-age.ts         createdAt -> "12d"
    format-ticket-date.ts        ms -> "Sep 4, 2026"
    ticket-status-style.ts       statusV2 -> { label, colorVar, softBgVar }
    parse-assignee-ref.ts        'user:<id>' | 'group:<id>' | '<id>' -> { kind, id }
    channel-tickets-paint-cache.ts  session+channel keyed last-good rows
    index.ts
  hooks/
    use-channel-tickets-data.ts  query + membership + paging + paint cache
    use-channel-tickets-filters.ts  filter state + chip labels
    use-channel-stage-filter-options.ts  stagesByBoards({ projectId }) / stagesByBoard when one board is picked
    use-channel-board-filter-options.ts  boardsListByProject({ projectId })
    index.ts
  components/
    channel-tickets-screen.tsx   header + filters + table; owns overlays
    channel-tickets-header.tsx   back + channel name (reuses HeaderBackButton)
    channel-tickets-table.tsx    horizontal ScrollView > [header row, LegendList]
    channel-tickets-header-row.tsx
    channel-tickets-row.tsx      memo'd, fixed height, Pressable
    cells/
      ticket-title-cell.tsx      mono xyneId + title (2 lines max)
      status-cell.tsx            pill
      priority-cell.tsx          TicketsPriorityIcon + label
      assignee-cell.tsx          Avatar + name (useUser), or group name, or "—"
      date-cell.tsx              due / created
      text-cell.tsx              stage, age
    channel-tickets-skeleton.tsx   standalone; also the Suspense fallback (no table imports)
    channel-tickets-empty-state.tsx  ListEmptyState wrapper
```

There is deliberately **no barrel `index.ts`**: a barrel would let a single
import drag the whole feature onto a caller's graph (the same reason `info.tsx`
deep-imports the profile sheets today).

Route and entry:

```
app/(protected)/chat/[channelId]/tickets.tsx     -> <Suspense fallback={<ChannelTicketsSkeleton/>}><LazyChannelTicketsScreen/></Suspense>
app/(protected)/chat/[channelId]/info.tsx        + gate + useChannelTicketsWarmup + <InfoRow icon={Ticket} label='Tickets' />
```

Reused as-is from `xyne-desks/tickets`:

- `TicketsPriorityIcon`
- `TicketsPriorityFilterSheet`
- `TicketsAssigneeFilterOverlay` + `useTicketsAssigneeFilterOverlay`
- `TicketsMultiSelectFilterOverlay` + `useTicketsFilterOverlay` (for Stage)
- `TicketsFiltersBar` / `TicketsFilterChip`
- `formatAssigneeFilterLabel`, `formatPriorityFilterLabel`,
  `formatMultiSelectFilterLabel`

Reused from the app: `HeaderBackButton`, `ListEmptyState`, `useHeaderHeight`,
`Avatar`, `useUser`, `getUserDisplayName`, `haptics`, `useCachedQuery`,
`useUserChannelStatuses`, `useChannelById`.

### Gate (`gate.ts`)

```
canShowChannelTickets({ scopeType, type }, canReadTicket) =
  canReadTicket
  && scopeType !== DM && scopeType !== GROUP_DM
  && !isDeskChannelType(type)
```

Desk channels are excluded because their tickets already live in `xyne-desks`,
and the web routes desk tickets to `/support/...`, not the chat tickets tab.

`info.tsx` calls `useCanReadTicket()` (already a cheap `useSelector` on the
state machine) and `useChannelById(channelId)` (already in scope via
`useConversationHeaderData`), then renders the row when the gate passes.

### Data hook (`use-channel-tickets-data.ts`)

Signature:

```
useChannelTicketsData(channelId, filters) -> {
  rows: ChannelTicketRow[]; isEmpty; isInitialLoading; isMember;
  hasMore; isLoadingMore; loadMore(); }
```

- `isMember = useUserChannelStatuses().some(s => s.channelId === channelId)`.
- One live
  `useCachedQuery(queries.supportTicketsPageV3({ channelId, isMember, assignedTo?, priority?, stageName?, limit, start: null, dir: 'forward' }), { enabled, ttl: '10m' })`.
- **Paging model: growing window, single query.**
  `limit = PAGE_SIZE * pages + 1`. `loadMore()` increments `pages` while the
  previous page was full (the `+1` sentinel row says whether more exists).
  Capped at `MAX_PAGES` (10 → 500 rows). One live query means no page stitching,
  no cursor bookkeeping, no duplicate rows when Zero pushes updates mid-list.
  Zero only transfers rows the client does not already have when the window
  grows.
- Filters change the query args; a filter change resets `pages` to 1.
- Mapping is a single `useMemo` over the page (`map-channel-ticket-row.ts`):
  drops archived and Support rows, dedupes by id, and builds display strings
  once (age, dates, status label) so row renders do no formatting work.
- Paint cache: keyed by `workspaceSessionKey + channelId`, **unfiltered list
  only**, same policy as `tickets-list-paint-cache.ts` (seed on mount, write on
  non-empty live, clear on confirmed empty). Filtered views never touch it.
- Stable arg keys: sort-and-join the filter arrays before building args so equal
  selections produce identical query keys (copy `stableStringListKey` from the
  desks hook into a shared util rather than duplicating it).

### Boards

Two different things are meant by "change the board":

**1. Viewing a specific board's tickets (web parity).** In channel mode the web
shows a Boards filter (`showBoardsFilter={!!channelId}`) defaulting to "All
boards" across the channel's project. On mobile this is offered as a **Board
chip**:

- Options:
  `useCachedQuery(queries.boardsListByProject({ projectId: channel.projectId }))`
  (scalar rows only, cheap), rendered with the existing
  `TicketsMultiSelectFilterOverlay`.
- Scoping: the snapshot's `supportTicketsPageV3` has **no board argument**, so
  the board filter is applied **client-side** on the loaded window
  (`row.boardId`). Server-side board scoping needs the shared bump.
  Consequences:
  - Selecting a board does not reduce what is fetched; it hides rows from the
    current window. With the 500-row cap a board that has few tickets in a very
    busy channel can look empty until more pages load. The hook auto-grows the
    window while the filtered result is short (same "adaptive fetch" idea the
    web `TicketListView` uses), up to the cap.
  - Because it is client-side, the board chip does not participate in the
    paint-cache key; only the unfiltered list is cached.
- A **Board column** is added to the table (board name resolved from the boards
  list) so the mixed "All boards" view is readable. Column order becomes: Ticket
  · Board · Status · Priority · Assignee · Due · Stage · Created · Age.
- Stage options are per project, not per board; when one board is selected the
  Stage chip options are narrowed to that board's stages (`stagesByBoard`).

**2. Moving a ticket to a different board.** That is a write
(`mutators.ticket.update` with `boardId`, and on web it is routed through
`routeStageChange` because stage forms and approvals can apply). It is out of
scope for v1 along with every other inline edit. The ticket detail screen is the
place for it later.

### Filters (`use-channel-tickets-filters.ts`, `use-channel-stage-filter-options.ts`)

- State: `assigneeIds`, `priorities`, `stageNames` are query args, so paging
  stays server-side. `boardIds` is client-side (see Boards).
- Stage options:
  `useCachedQuery(queries.stagesByBoards({ projectId: channel.projectId }))`,
  deduped by stage name. (`useTicketStageFilterOptions` from desks is desk-only
  because it resolves the board through `email_channel_preferences`; do not
  reuse it.)
- Chip labels via the existing desk formatters.
- Overlays are mounted only while open (they already support that via
  `isMounted`).

### Table library: `@tanstack/react-table` (headless) + `LegendList`

Evaluation of the React Native options against the requirements (lightweight,
virtualised, fully styleable, maintained):

| Option                                              | Virtualised                      | Styling         | Maintenance                                                               | Verdict                                                          |
| --------------------------------------------------- | -------------------------------- | --------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `react-native-table-component`                      | no, renders every row into Views | own style props | dormant                                                                   | rejected: no recycling, so a 500-row window would mount 500 rows |
| `react-native-reanimated-table` (fork of the above) | no                               | own             | low activity                                                              | rejected, same reason                                            |
| `react-native-datatable-component`                  | no                               | own             | single maintainer                                                         | rejected                                                         |
| `react-native-paper` DataTable                      | no                               | Paper theme     | maintained, but pulls in Paper                                            | rejected: heavy, styling fights uniwind                          |
| **`@tanstack/react-table`**                         | headless, we render rows         | 100% ours       | actively maintained, framework-agnostic, explicitly supports React Native | **chosen**                                                       |

`@tanstack/react-table` is a headless core with no DOM or RN dependency: it owns
the column model and table state (column defs, visibility, sorting, filtering,
row selection) and we own every pixel. It is roughly 15 kB, tree-shakes to the
features used, and already sits in the same ecosystem as
`@tanstack/react-query`, which the app depends on. Because it renders nothing
itself, virtualisation stays with `LegendList`.

How it is used here:

- `constants.ts` becomes `columns.ts`: a `ColumnDef<ChannelTicketRow>[]` with
  `accessorKey`, `header`, `size` (our fixed width),
  `meta: { align, cellKind }`. Column definitions are typed against the row
  model, so a schema change fails at compile time.
- `useReactTable({ data: rows, columns, getCoreRowModel, state: { columnVisibility } })`
  is created once in `channel-tickets-table.tsx`. `getSortedRowModel` /
  `getFilteredRowModel` are **not** wired in v1 (server-side filters, server
  order) so they are not bundled.
- Header row renders `table.getHeaderGroups()`; each `LegendList` item renders
  `row.getVisibleCells()` through `flexRender`, so cell components are plain RN
  components receiving `cell.getValue()`.
- Column visibility state is the future hook for a "Customize columns" sheet
  without touching the row renderer.
- The dependency is added to `apps/mobile/package.json` only; no native code, no
  config plugin, no shared change.

If in review the team decides the abstraction is not earning its keep for eight
fixed read-only columns, the fallback is a hand-rolled column-def array with the
same shape; the row and cell components do not change.

### Table layout (`channel-tickets-table.tsx`)

React Native has no table primitive. Layout:

```
<ScrollView horizontal style={{flex:1}} contentContainerStyle={{ minWidth: tableWidth, flexGrow: 1 }}
            nestedScrollEnabled showsHorizontalScrollIndicator={false}>
  <View style={{ width: tableWidth, flex: 1 }}>
    <ChannelTicketsHeaderRow />          // fixed HEADER_HEIGHT
    <LegendList data={rows} ... />       // vertical, fixed ROW_HEIGHT
  </View>
</ScrollView>
```

- Header is outside the vertical list, so it stays at the top and scrolls
  horizontally in lock-step with the rows.
- Column widths come from each `ColumnDef.size` (no measuring). Order, tuned so
  the first viewport is useful without scrolling: Ticket (220) · Board (120) ·
  Status (120) · Priority (110) · Assignee (150) · Due (110) · Stage (130) ·
  Created (120) · Age (64).
- `LegendList` props: `estimatedItemSize={ROW_HEIGHT}`, `getFixedItemSize`,
  `drawDistance` matching desks, `recycleItems`, `onEndReached={loadMore}`,
  `onEndReachedThreshold={0.5}`, `keyExtractor={row => row.id}`,
  `extraData={rows.length}` only (rows are immutable objects; no selection
  state).
- Row is `memo` with props limited to the pre-formatted `ChannelTicketRow`;
  colours are read once in the table and passed down, not per row via
  `useCSSVariable`.
- Row press → haptic →
  `router.push({ pathname: '/ticket/[ticketId]', params: { ticketId, channelId, threadId: conversationId } })`
  — identical to how `ChatChannelScreen` opens tickets today, so
  `TicketDetailsScreen` needs no changes.
- Frozen first column is deliberately **not** in v1 (needs two synchronised
  lists). Revisit after review if horizontal scroll of the title feels bad.

### Load-on-Info: nothing loads before the Info screen is opened

Requirement: no channel-tickets **code** is evaluated and no channel-tickets
**query** is issued until the user opens a channel's Info screen. Once Info is
open, both are warmed so the Tickets row opens instantly.

Mechanism (mirrors `src/contexts/ProfileModalContext.tsx` and
`DashboardWebViewShell.tsx`, the app's existing deferred-module pattern):

```
src/features/channel-tickets/
  load.ts          the ONLY file anything outside the feature imports eagerly
    loadChannelTicketsScreen()   memoised `import('./components/channel-tickets-screen')`
                                 (promise cached; reset on rejection, like loadProfileModal)
    LazyChannelTicketsScreen     React.lazy(loadChannelTicketsScreen)
    prefetchChannelTickets(zero, channelId, isMember)
                                 fires the first-page supportTicketsPageV3 query via
                                 zero.preload / the shared cached-query warm path so
                                 rows are in Zero's local store before the screen mounts
  gate.ts          canShowChannelTickets (pure, tiny; safe to import from info.tsx)
```

Import discipline, enforced by what each file imports:

| File                                           | Imports from the feature                                                                                | When it evaluates                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `app/(protected)/chat/[channelId]/info.tsx`    | `gate.ts`, `load.ts` only                                                                               | when Info opens (already lazy per route) |
| `app/(protected)/chat/[channelId]/tickets.tsx` | `LazyChannelTicketsScreen` from `load.ts`, wrapped in `<Suspense fallback={<ChannelTicketsSkeleton/>}>` | when the Tickets route opens             |
| chat screen, tab bar, providers, `_layout.tsx` | **nothing**                                                                                             | never                                    |

`load.ts` must not import `components/`, `hooks/`, or `utils/` statically. The
dynamic `import()` is the only edge from `load.ts` into the rest of the feature,
so the table, cells, filter overlays and their transitive imports (`LegendList`
row config, reanimated overlays, date-fns formatters) stay off the startup graph
and off the chat screen's graph. The skeleton lives in its own small file so the
Suspense fallback does not pull the table in.

Warm-up in `info.tsx`, run only when the gate passes:

```
const showTickets = canShowChannelTickets(channel, canReadTicket);
useChannelTicketsWarmup(channelId, showTickets);   // exported from load.ts
```

`useChannelTicketsWarmup` does two things in one effect, once per channel:

1. `void loadChannelTicketsScreen()` so the module is evaluated while the user
   is still reading the Info screen.
2. Subscribes the first page (`limit: PAGE_SIZE + 1`, no filters) through
   `useCachedQuery(queries.supportTicketsPageV3(...), { enabled: showTickets, ttl: '10m' })`.
   The `ttl` keeps the rows in Zero's client store after Info unmounts, so the
   Tickets screen's identical first-page query resolves from local data with no
   network wait. Stage options (`stagesByBoards`) are **not** warmed: they are
   only needed when a filter overlay opens.

Cost on the Info screen: one small query (rows for one channel, first page) and
one module evaluation, both only for channels where the Tickets row is actually
shown. Nothing runs for DMs, group DMs, desk channels, or users without ticket
read access.

Why not warm from the chat screen: the chat screen is the hottest surface in the
app and already defers its own participants query behind paint. Warming tickets
there would add a query to every channel open for a feature most opens never
touch.

### Theme tokens

Add to `global.css`, next to `--color-ticket-priority-*`:

```
--color-ticket-status-todo / -started / -paused / -cancelled / -completed
--color-ticket-status-todo-soft / ... (pill backgrounds)
```

Light and dark values chosen to match the web pills (orange / blue / teal / red
/ green).

## Performance budget and how each item is protected

| Concern                                    | Mitigation                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App startup                                | No feature code is evaluated at startup. Only `gate.ts` and `load.ts` are statically imported anywhere, and only by the two `[channelId]` route files, which Expo Router loads on first navigation. |
| Chat screen render cost                    | Nothing is added to the chat screen. The gate runs only on the Info screen, using hooks that are already subscribed there.                                                                          |
| Time-to-interactive for the Tickets screen | Module evaluation and the first-page query both start when Info opens, so the Tickets route mounts with code and rows already local.                                                                |
| Query fan-out                              | One live query per open screen. No per-row queries. Assignee names come from the already-loaded users store (`useUser`).                                                                            |
| Payload size                               | `supportTicketsPageV3` relates only `emailDrafts`/`emailReads` (per-user, tiny). No project/tag/entity joins.                                                                                       |
| Large channels                             | Windowed at 50, grows on demand, hard cap 500. Beyond the cap, filters are the way to narrow.                                                                                                       |
| Row render                                 | Fixed height, recycled, memoised, pre-formatted strings, no `useCSSVariable` per row.                                                                                                               |
| Cold open                                  | Paint cache paints last-good rows before Zero resolves (same as desks). Skeleton for true first open.                                                                                               |
| Overlays                                   | Filter overlays mount only while open.                                                                                                                                                              |
| Import graph                               | No barrel. `info.tsx` imports `gate.ts` + `load.ts`; `tickets.tsx` imports `load.ts`. The screen and everything under it is reachable only through the memoised `import()` in `load.ts`.            |

## Behavioural parity gaps (accepted for v1, revisit after a shared bump)

1. **Flow-step tickets appear as rows** (no `rootId` in the snapshot). Web hides
   them.
2. **Ordering is `lastEmailAt`, not `createdAt`.** Equal at creation for chat
   tickets; can differ if a ticket later receives email activity.
3. **No Labels column**, no inline edits, no sort, no create.
4. **Private channel, non-member**: ACL returns nothing; shown as the empty
   state.

## Implementation order

1. `gate.ts`, `utils/`, `types.ts`, `constants.ts` with unit tests (pure, no
   RN).
2. `load.ts` (lazy screen + warm-up hook) and the `tickets.tsx` route with the
   Suspense skeleton; wire the Info row and warm-up. At this point the route
   renders the skeleton and the query is proven to fire only after Info opens
   (verify with Zero debug logging / network tab: opening a channel issues no
   `supportTicketsPageV3`; opening Info does).
3. `use-channel-tickets-data.ts` + paint cache; verify against a real channel.
4. Table + cells + empty state.
5. Filters hook + stage options + overlays wiring.
6. Android device pass for nested horizontal/vertical scroll; iOS pass for
   back-swipe (the horizontal ScrollView must not eat the edge gesture — keep
   `fullScreenGestureEnabled` default and verify).
7. Bundle check: confirm no channel-tickets module is in the startup require
   trace (Metro `--dump` / `require` timing log used for the profile-modal work)
   and that the chat screen's graph is unchanged.

## Tests (`tests/unit/features/channel-tickets/`)

- `gate.test.ts`: DM, GROUP_DM, desk types (EMAIL/SLACK/APP), no permission,
  happy path.
- `load.test.ts`: `loadChannelTicketsScreen` memoises the promise, resets it on
  rejection, and `load.ts` has no static import of `components/`, `hooks/`, or
  `utils/` (assert via a small import-graph check on the source file, so the
  discipline cannot regress silently).
- `map-channel-ticket-row.test.ts`: drops archived, drops Support, dedupes ids,
  maps labels, handles null assignee / eta / stage.
- `format-ticket-age.test.ts`, `format-ticket-date.test.ts`.
- `ticket-status-style.test.ts`: every `TicketStatusV2` value mapped, unknown →
  fallback.
- `parse-assignee-ref.test.ts`: `user:` / `group:` / bare id.
- `use-channel-tickets-data` paging logic extracted into a pure reducer
  (`next-page-state.ts`) and tested: sentinel row → hasMore, cap, filter-change
  reset.

Rendering tests (jest-expo + RNTL) for `channel-tickets-row` and `status-cell`
if the existing component test layer is in use for the release.

## Phase 1 implementation notes (what shipped vs. the layout above)

- `components/cells/` was folded into one `channel-ticket-cell.tsx` that
  switches on the column `meta.key`; every cell is still a plain RN subtree, and
  the switch keeps `columns.ts` free of RN imports so it stays testable under
  node.
- `query-args.ts` sits at the feature root next to `gate.ts`: it is the one pure
  module `load.ts` may import, so the Info-screen warm-up and the data hook
  build byte-identical first-page args (asserted in
  `paging-and-query-args.test.ts`).
- `utils/index.ts` and `hooks/index.ts` exist as _internal_ barrels only;
  nothing outside the feature imports them, and `load-import-discipline.test.ts`
  fails if `load.ts` or `gate.ts` ever does.
- Filter chips reuse the desk overlays unchanged; the Board chip is client-side
  with auto-grow (`shouldAutoGrowForClientFilter`), and selecting one board
  narrows Stage options to that board.
- Filters UI (revised during phase 1 review): no chips bar. The header carries
  one Filters button (top right, accent dot when any filter is applied) that
  opens a bottom-sheet drawer (`channel-tickets-filter-drawer.tsx`, built on
  `AppBottomSheet`) listing Board / Assignee / Priority / Stage with their
  current values. Tapping a row closes the drawer and then opens that filter's
  existing value picker; "Clear all" lives in the drawer header. The table sits
  in a rounded card with a 12px inset on all sides and the same gap under the
  header.
- Bottom-sheet sizing (RCA from device testing): the Filters drawer did not
  appear. In `mode='dynamic'` gorhom v5 derives its only snap point from the
  content height that `BottomSheetView` / `BottomSheetScrollView` report through
  onLayout; plain children report nothing, so the snap point stays at zero and
  the sheet never engages. Even with `BottomSheetView`, the first measurement
  can lose the race against `snapToIndex(0)` (documented in
  `category-filter-sheet.tsx`), and behind `AppBottomSheet`'s portal that leaves
  a touch layer stuck over the screen. Rule for every sheet in the tickets flow:
  fixed-height rows, `mode='snap'` / `enableDynamicSizing={false}` with a
  computed snap point, content inside `BottomSheetView`. Applied to the drawer
  and to the reused desk priority sheet; enforced by
  `sheet-sizing-discipline.test.ts`.
- Pure views + container (test-driven refactor): every component under
  `components/` is now props-in / callbacks-out with no theme, layout, router or
  data hooks. `ChannelTicketsView` composes header, table card and drawer; the
  container `channel-tickets-screen.tsx` owns the hooks and the value-picker
  overlays. Three hooks feed the views: `useChannelTicketsPalette` (every
  colour, resolved once), `useChannelTicketsLookups` (board / group / user id →
  name maps) and `useChannelTicketsPickers` (drawer ↔ picker orchestration; one
  surface at a time). Test coverage: logic tests for utils / paging / query args
  / gate / import & sheet discipline (node:test), and jest rendering + hook
  tests per view, per hook, plus a feature-level
  `channel-tickets-screen.test.tsx` that drives load → table → drawer → picker →
  query args → detail navigation over a mocked Zero layer. Rendering tests map
  `@xyne/shared` to `tests/mocks/xyne-shared.ts` (the real barrel loads
  `@rocicorp/zero`, which is ESM-only) and rely on the test-env Babel plugin in
  `babel.config.cjs` that rewrites `import()` to `require()` so `load.ts` is
  testable.
- Search (web parity, phase 1.5): a Search button in the header toggles an
  inline bar under it (`channel-tickets-search-bar.tsx`, pure) that filters the
  same table in place, like the dashboard's table search box.
  `useChannelTicketSearch` layers three sources: (1) an instant local substring
  match over the loaded window on title / human id / stage / status / priority
  (`filter-rows-by-query.ts`, the dashboard's table filter fields); (2) a 300
  ms-debounced Vespa search (`type: 'tickets'`, `apps: 'ticket'`,
  `in: channelId`, the same call the global search Tickets tab makes) with a
  client-side channel check on each hit; (3) hits outside the window hydrated
  through the snapshot's `ticketsByIds` so they render with the full column set.
  Order is stable: local matches first, then server-only hits in ranked order.
  Server errors keep the local matches and show on the bar's status line. Back /
  hardware back leaves search mode before leaving the screen. No shared change
  was needed.
- Typed routes: the new route is picked up by Expo's generator on the next
  `expo start`; it was regenerated manually for this change.

## Open items to confirm during implementation

- `LegendList` nested inside a horizontal `ScrollView` on Android: confirm
  `nestedScrollEnabled` is sufficient on the current version.
- Whether `channel.projectId` is always populated for non-desk channels in this
  workspace (it drives the Stage filter options). If empty, hide the Stage chip.
- `TicketDetailsScreen` back navigation returns to the table (it should, via the
  stack), and the table keeps its scroll position and filter state on return.
