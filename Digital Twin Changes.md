# Digital Twin: Shipped UI to Current Version Mapping

> **Implement / merge reference.** Anyone implementing or merging Digital Twin
> on this branch should read this file first. It is the source of truth for how
> shipped UI maps onto the current experience. When routes, navigation, labels,
> control placement, or taxonomy change, update this document in the same change.

This document maps the Digital Twin experience in the repository's shipped
baseline (`HEAD`) to the current local version. Routes are shown relative to
`/claw-agents/digital-twin`.

## Navigation mapping

| Shipped item | Shipped route | Where it is in the current version                    | Current route | Change                                    |
| ------------ | ------------- | ----------------------------------------------------- | ------------- | ----------------------------------------- |
| Memories     | `/`           | Primary **Memories** tab                              | `/memories`   | Same feature; moved off index so Overview is the default landing |
| Proposals    | `/proposals`  | Primary **Review** tab and header **Review N** button | `/proposals`  | Renamed; route preserved                  |
| Hot          | `/hot`        | **Inspect -> Most recalled**                          | `/hot`        | Renamed and moved into advanced tools     |
| Recall       | `/recall`     | **Inspect -> Recall lab**                             | `/recall`     | Renamed and moved into advanced tools     |
| Graph        | `/graph`      | **Inspect -> Knowledge map**                          | `/graph`      | Renamed and moved into advanced tools     |
| Metrics      | `/metrics`    | **Inspect -> Approval insights**                      | `/metrics`    | Renamed and moved into advanced tools     |
| Settings     | `/settings`   | Header **Settings** action                            | `/settings`   | Same route; removed from the old sidebar  |
| None         | None          | Primary **Overview** tab (first; default landing)     | `/overview` (`/` redirects here) | Twin description, instructions, and capability chips (MCP, Subagent, Built in tools, Skills, Knowledge) |
| None         | None          | Primary **Configuration** tab                         | `/configuration` (`/persona` redirects here) | Model and Credentials as separate sections, Behaviour, Tools and Knowledge (one heading over MCP / Subagent / Built in tools / Skills / Knowledge chip rows in the same #fafafa DetailGroup as the other sections), People. Twin-only type scale: section titles **18px** (`heading='title'`), nested field titles **14px** medium, Behaviour and People group labels (Sandbox, Constant reminders, Autonomy, Verification, Output; Access, Members, Pending Requests) **14px / 450 / 1.35 / tertiary** (`heading='subcategory'`) sit **outside** the grey fill; each group's content uses the same #fafafa DetailGroup as Model / Credentials. Hints **14px** `font-normal` (400). Twin-only **16px** section heading-to-content gap; nested Twin subcategory title-to-content is **8px**. Twin Configuration hairline is **`TWIN_STROKE_CLASS`**: `border-[0.8px] border-foreground/10` (same as capability chips) on DetailGroups, selects, credentials control, reminders field, member filter, and empty search; Library / Overview `#e8e8e8` fields stay. Tools and Knowledge is display-only until **Edit** (pencil) on the heading; Edit reveals + on capability titles and × on pills, **Done** hides them again. Overview chips stay display-only. 16px top padding like Overview. Description and instructions live on Overview. |
| None         | None          | Primary **Activity** tab                              | `/activity`   | New dashboard route                       |

The old Digital Twin sidebar has not disappeared feature by feature. Its
destinations are now divided between:

- Horizontal primary navigation for everyday tasks.
- The **Inspect** menu for diagnostics.
- The header **Settings** action for configuration.

## Header and operational controls

| Shipped control                 | Previous location          | Current-version location                              | Change                                    |
| ------------------------------- | -------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Backfill history                | Icon-only header button    | First-time **Enable** flow, then **Resume** in the active-work strip | Removed from composer **+**; EnableModal is still mounted for additional backfill |
| Upload markdown                 | Icon-only header button    | **+ -> Attach files**                                 | Same upload modal; retargeted from Upload a document          |
| Disable Twin                    | Red power icon in header   | **Settings -> Data controls -> Disable Digital Twin** | Moved away from routine actions           |
| Active/Backfilling/Stalled chip | Header status tooltip      | Plain-language header status and active-work strip    | More detail is visible without hovering   |
| Title "Digital Twin"            | Left-aligned header title  | Centered **"Your Digital Twin"** with 80px landscape portrait | Conversational identity; Inter 24px semibold, not italic serif |
| Add knowledge button            | Coral header dropdown      | **+** in the **Ask your twin something** composer     | Figma + menu: Attach files, Agent, Skill, Knowledge Base, Deep Research Target, Web Search, Deep Research |
| None                            | None                       | **Ask your twin something** pill composer             | Starts an in-page Twin chat overlay from behind the composer. Idle collapsed is a single-row pill with **18px** corners; long or wrapping drafts expand the textarea above `+` / mic / send, still **18px**. Height tweens with the layout motion (300ms ease-out) and snaps under `prefers-reduced-motion`. Overlay card (underlay) is **20px** at all times. Border stays `foreground/10`; idle **top** pill, compact **bottom** session chrome, and expanded overlay card share Figma **1615:43372** elevation on `.dt-ask-composer-shadow` / `.dt-chat-overlay` (`--dt-ask-composer-elevated-shadow`: 0 36px 10px / 0%, 0 23px 9px / 0%, 0 13px 8px / 2%, 0 6px 6px / 3%, 0 1px 3px / 3% black). The shadow node has no fill so height-tween clippers cannot crop it. Docked idle chrome does not paint `bg-background` or a rectangular shadow on the overlay frame. Sending from the **top** origin pill starts the Twin session and **brings in a bottom** chat-in-progress composer (Figma 1615:43372: live session-title dropdown from the first prompt, maximize, close, a second `DigitalTwinAskComposer`); the **top** origin pill **stays** in its default slot (still usable). The thread overlay grows **upward** from that bar so composer Y does not move; width may tween 500→689 while expanded and returns to the default 500px pill when collapsed. Height tween applies only to the thread/header **underlay** (`dt-chat-overlay-underlay`); `DigitalTwinAskComposer` stays mounted **outside** that overflow-hidden clip so the pill never blinks off during expand, collapse, or compact-header close. Idle/inactive pills keep the same Figma shadow on `.dt-ask-composer-shadow` (card shadow is only while `.dt-has-underlay`). There is **no** full-bleed paper underlay (`dt-chat-overlay-underlay` / `background/80`); Configuration/Overview stay visible. Expand, collapse, and compact-header close use the same height/width tween (card radius stays **20px**; entrance duration; **ease-out both ways** — `DIGITAL_TWIN_EASE_OUT`). Clicking the compact composer textarea or pill body expands the thread (same tween as send); **+**, mic, send, history, and maximize keep their own actions. Click-outside or Escape while expanded collapses to the compact bottom chrome without ending the session. Header **X** (compact or expanded) clears the session: compact header height/opacity collapses with the card (reverse of how it appears), then idle empty top pill remains. Maximize sends the thread to the Ask AI side panel and returns idle. |
| Ask composer scroll             | Scrolls away with the header | In-flow under the identity stack while idle **and after send** (top origin pill stays). Active-chat chrome docks separately to `bottom: 1.5rem`. Idle still docks with `t-panel-slide` when the origin leaves the ledger scroller (`div.flex-1.overflow-auto`) | Portrait, **Your Digital Twin**, and tabs scroll away. Overlay `z-30` (docked `z-60`) sits above tab content and below portaled `+` menus (`z-60` / submenus `z-70`). No page scrim. |
| Backfill progress               | Large transient banner     | Compact strip beneath the header                      | Same process, redesigned presentation     |
| Retry stalled backfill          | Backfill modal or banner   | **Resume** in the active-work strip                   | Remapped to an explicit operation         |
| Pause backfill                  | Not exposed                | Active-work strip                                     | New control                               |
| Open job history                | Not exposed                | **View activity** in the active-work strip            | New connection to Activity                |
| Pending proposal count          | Status tooltip and sidebar | Header **Review N** action and Review tab badge       | Promoted to a primary task                |

## Memories mapping

| Shipped element            | Current-version location                                                | Change                                               |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Memory content row         | Title and memory text inside the new card                               | Expanded hierarchy                                   |
| Created date               | `Added [date]` in card metadata                                         | Renamed                                              |
| Recall count               | `[N] uses this week`                                                    | Plain-language rename                                |
| Delete icon                | Three-dot menu -> **Delete memory**                                     | Same function, labeled and confirmed                 |
| Client-side search         | Main Memories search field                                              | Now searches server-side across the complete library |
| Loaded/total counter       | Memories count badge                                                    | Simplified                                           |
| Category guide             | No direct equivalent                                                    | Replaced by knowledge-area categorization            |
| Category badge             | Colored knowledge-area icon and label                                   | Different taxonomy; see the warning below            |
| Curator `why?` information | Expand card -> **See source and history** -> **Why the Twin kept this** | Moved under provenance                               |
| Source references          | Expanded source panel                                                   | Newly exposed                                        |
| Full pipeline event        | **Full history** link to Activity                                       | New deep connection                                  |
| Pagination                 | Infinite loading in 50-record batches                                   | Replaces the previously loaded subset                |

### Taxonomy warning

The old category guide and the new knowledge areas are not the same data.

| Old Hindsight category | Related new knowledge-area examples         |
| ---------------------- | ------------------------------------------- |
| World                  | Context, Projects, Relationships, Documents |
| Experience             | No direct one-to-one mapping                |
| Observation            | No direct one-to-one mapping                |
| Mental model           | Preferences, Decisions, Communication style |

The current version prioritizes the eight curator knowledge areas:

- Communication style
- Expertise
- Projects
- Relationships
- Preferences
- Decisions
- Context
- Documents

This should not be described as merely renaming the old category badge. The
displayed taxonomy is changing from Hindsight categories to curator subsystems.

## Review mapping

| Shipped element                      | Current-version location                              | Change                                         |
| ------------------------------------ | ----------------------------------------------------- | ---------------------------------------------- |
| Proposals page                       | **Review** tab                                        | Renamed                                        |
| Subsystem card groups                | Left **Waiting for review** queue                     | Flattened into one selectable queue            |
| Proposal row                         | Right-side proposal detail                            | Full text and sources get more room            |
| Individual Edit                      | Proposal detail -> **Edit**                           | Preserved and made explicit                    |
| Individual Approve                   | Proposal detail -> **Approve**                        | Preserved and labeled                          |
| Individual Reject                    | Proposal detail -> **Reject**                         | Preserved and labeled                          |
| Source count                         | Queue summary and **Based on** section                | Actual source types and dates are now shown    |
| Confidence                           | Supporting or technical explanation                   | Demoted from being the primary decision signal |
| Group Approve all                    | **Batch actions -> Approve N in [area]**              | Moved and exact count added                    |
| Global Approve all                   | **Batch actions -> Approve all N**                    | Moved and exact count added                    |
| Immediate bulk execution             | Confirmation dialog                                   | New safety step because there is no undo       |
| Failed proposal group shown as empty | Partial-load warning with retry                       | Failure is no longer silent                    |
| Failed optimistic action             | Proposal restored to the queue with a visible outcome | Rollback and retry behavior added              |

## Settings mapping

| Shipped setting                  | Current-version location                  | Change                                         |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| Response suffix                  | **Reply behavior -> Response suffix**     | Preserved                                      |
| Response preview                 | Beneath Response suffix                   | Preserved                                      |
| Manual/automatic memory approval | **Memory approval**                       | Preserved                                      |
| Confidence threshold slider      | **Minimum curator confidence**            | Preserved; numeric input and explanation added |
| Disable Twin                     | **Data controls -> Disable Digital Twin** | Moved from the header                          |
| Delete memories while disabling  | **Data controls -> Delete memories**      | Split into a separate operation                |
| None                             | Always draft vs Follow learned patterns   | New setting                                    |
| None                             | Delete memories by date range             | New dashboard control                          |
| None                             | Persistent deletion-in-progress state     | New status handling                            |

Disabling and deleting are now independent decisions. The shipped flow could
combine them through the Disable modal.

## Inspect-tool mapping

| Shipped tool | Current-version equivalent | Functional change                                                       |
| ------------ | -------------------------- | ----------------------------------------------------------------------- |
| Hot          | Most recalled              | Reuses the same memory-card and provenance pattern                      |
| Recall       | Recall lab                 | Adds Low, Medium, and High budgets plus retryable errors                |
| Graph        | Knowledge map              | Subsystem list or table becomes the default; graph becomes optional     |
| Metrics      | Approval insights          | KPI tiles and charts become narrative summaries, bars, and exact tables |

## Features with no shipped-screen equivalent

| Current-version feature     | Location                               | Backend relationship                            |
| --------------------------- | -------------------------------------- | ----------------------------------------------- |
| Overview                    | `/overview` (**Overview**)             | Description, instructions, and selected MCP / subagent / built-in tool / skill / knowledge chips. Overview inputs use 12px top padding (`pt-3`) and 20px bottom (`pb-5`). Instructions hug content while idle (overflow hidden, no empty 250px well); if text exceeds ~250px, idle caps there with an inside bottom fade into `#fbfbfb`. Focus expands to 400px, enables vertical scroll when needed, and hides the fade. Chips are display-only (no Edit); add and remove live on Configuration after **Edit**. |
| Stacked agent detail        | `/configuration` (**Configuration**; `/persona` still resolves here) | Model and Credentials ungrouped (not one persona stack). Behaviour. Tools and Knowledge as one section: MCP, Subagent, Built in tools, Skills, and Knowledge chip rows are siblings in one #fafafa DetailGroup (not a nested Knowledge group, not per-row cards). Twin-only type scale: section titles **18px**, nested titles **14px** medium, Behaviour and People group labels **14px / 450** subcategory (`text-foreground/60`) sit **outside** the grey fill; each group's content (Sandbox, Constant reminders, Autonomy, Verification, Output; Access, Members, Pending Requests) uses the same #fafafa DetailGroup as Model / Credentials. Nested hints **14px** / 400 (`font-normal`). Twin-only **16px** section heading-to-content gap; nested Twin subcategory title-to-content is **8px**. Twin Configuration stroke is `TWIN_STROKE_CLASS` (`border-[0.8px] border-foreground/10`) on groups, controls, reminders, member filter, and empty search. Tools and Knowledge heading **Edit** (pencil) reveals + / ×; **Done** returns to display-only. Overview chips stay display-only. Stack has **16px** top padding like Overview. Description and instructions are on Overview, not repeated here. Activity is a primary tab, not stacked here. |
| Learning-event timeline     | `/activity`                            | Exposes pipeline-event APIs                     |
| Record and source previews  | Activity details and memory provenance | Exposes stored pipeline records                 |
| Curator outcomes and errors | Activity details                       | Exposes stored traces                           |
| Pause/resume backfill       | Header work strip                      | Exposes existing backfill controls              |
| Ask your twin something composer | Header chrome                        | Send from the top origin pill starts Twin chat and brings in a **bottom** chat-in-progress composer (Figma 1615:43372: first-prompt session title dropdown + the same input). The thread overlay can expand above that bar (Ask AI messages); it grows upward so composer Y stays put. No paper underlay. Clicking the compact composer textarea or pill body expands the thread. Click-outside collapses with the reverse of expand to the compact 500px chrome. Header **X** (compact or expanded) clears the session and returns the idle top pill. Maximize sends the thread to the Ask AI side panel. **+** can attach files, mention agents/skills, attach KB collections, pick a research target, and toggle web/deep research |
| Learned reply policy        | Settings                               | Exposes the existing response-policy capability |
| Date-range deletion         | Settings                               | Exposes the existing deletion capability        |

## Unchanged foundations

- Memories remain user-scoped.
- Private DMs remain excluded.
- Existing Digital Twin URLs continue to resolve.
- Approval writes to the same memory system.
- Existing backfill, upload, recall, graph, and metrics services remain the
  underlying sources.

## Development-only infrastructure in the current version

The populated demo mode and local authentication bypass support development and
review. They are not customer-facing Digital Twin functionality and should be
tracked separately from the product changes above.

## Stakeholder summary

> No existing Digital Twin destination was deleted. Memories and Settings kept
> their routes; Proposals became Review; Hot, Recall, Graph, and Metrics moved
> under Inspect with clearer names. The header is a centered identity stack
> (portrait, **Your Digital Twin**, **Ask your twin something** pill). The
> composer stays in its default slot and docks **bottom sticky** (`1.5rem`)
> after the origin scrolls away; Overview, Configuration, Memories, Review,
> and Activity scroll underneath. Portrait, title, and tabs are not pinned.
> Sending from the top composer starts Twin chat and brings in a bottom
> chat-in-progress composer (session title from the first prompt, same input)
> **without hiding** the top origin pill. The thread overlay grows upward so
> the ask bar does not move; there is no white page scrim. Clicking the compact
> composer expands the thread. Expand and collapse share ease-out. Click-outside
> reverses the expand tween to the compact chrome; header **X** collapses the
> compact header with the card, then restores idle (top pill already visible).
> Composer **+** follows the Figma add menu (Attach
> files, Agent, Skill, Knowledge Base, Deep Research Target, Web Search, Deep
> research); document upload is **Attach files**, while history import stays on
> the Enable flow and Resume. Disable moved into Settings. Overview
> (`/overview`) is the default landing: description, instructions, and
> capability chips. Configuration (`/configuration`; `/persona` redirects here)
> stacks Model, Credentials, Behaviour, Tools and Knowledge, and People from the
> AI Library agent page (Model and Credentials are ungrouped; Tools and Knowledge
> is one heading over MCP, Subagent, Built in tools, Skills, and Knowledge as
> sibling chip rows in the same #fafafa group as the other sections; Twin-only
> type scale is 18px section titles, 14px nested titles, Behaviour and People
> group labels 14px/450 subcategory, 14px/400 hints; Behaviour and People group
> titles (Access, Members, Pending Requests) sit outside the grey fill, with
> content in the same #fafafa DetailGroup; 16px section heading-to-content gap
> and **8px** nested Twin subcategory title-to-content; Tools and Knowledge
> **Edit** reveals add/remove on chips, **Done** hides them; 16px top padding
> like Overview).
> Description and instructions are only on Overview.
> Primary tabs are
> Overview, Configuration, Memories, Review, and Activity (the Figma header
> frame has no tab strip). Overview is first in primary nav.
