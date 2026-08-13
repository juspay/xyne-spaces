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
| Memories     | `/`           | Primary **Memories** tab                              | `/memories`   | Same feature; moved off index so Details is the default landing |
| Proposals    | `/proposals`  | Primary **Review** tab and header **Review N** button | `/proposals`  | Renamed; route preserved                  |
| Hot          | `/hot`        | **Inspect -> Most recalled**                          | `/hot`        | Renamed and moved into advanced tools     |
| Recall       | `/recall`     | **Inspect -> Recall lab**                             | `/recall`     | Renamed and moved into advanced tools     |
| Graph        | `/graph`      | **Inspect -> Knowledge map**                          | `/graph`      | Renamed and moved into advanced tools     |
| Metrics      | `/metrics`    | **Inspect -> Approval insights**                      | `/metrics`    | Renamed and moved into advanced tools     |
| Settings     | `/settings`   | Header **Settings** action                            | `/settings`   | Same route; removed from the old sidebar  |
| None         | None          | Primary **Details** tab (first; default landing)      | `/persona` (`/` redirects here) | Stacked agent Digital Twin detail surfaces (Persona, Behaviour, Tools, Knowledge, People) |
| None         | None          | Primary **Activity** tab                              | `/activity`   | New dashboard route                       |

The old Digital Twin sidebar has not disappeared feature by feature. Its
destinations are now divided between:

- Horizontal primary navigation for everyday tasks.
- The **Inspect** menu for diagnostics.
- The header **Settings** action for configuration.

## Header and operational controls

| Shipped control                 | Previous location          | Current-version location                              | Change                                    |
| ------------------------------- | -------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Backfill history                | Icon-only header button    | **Add knowledge -> Import past work**                 | Renamed and labeled                       |
| Upload markdown                 | Icon-only header button    | **Add knowledge -> Upload a document**                | Renamed and grouped with knowledge intake |
| Disable Twin                    | Red power icon in header   | **Settings -> Data controls -> Disable Digital Twin** | Moved away from routine actions           |
| Active/Backfilling/Stalled chip | Header status tooltip      | Plain-language header status and active-work strip    | More detail is visible without hovering   |
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
| Stacked agent detail        | `/persona` (**Details**)               | Same surfaces as `/ai/library/agent/digital-twin` (Persona, Behaviour, Tools, Knowledge, People, Activity) |
| Learning-event timeline     | `/activity`                            | Exposes pipeline-event APIs                     |
| Record and source previews  | Activity details and memory provenance | Exposes stored pipeline records                 |
| Curator outcomes and errors | Activity details                       | Exposes stored traces                           |
| Pause/resume backfill       | Header work strip                      | Exposes existing backfill controls              |
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
> under Inspect with clearer names. Backfill and Upload moved into Add
> knowledge, while Disable moved into Settings. Details (`/persona`) stacks the
> same agent Digital Twin detail surfaces as the AI Library agent page (Persona,
> Behaviour, Tools, Knowledge, People, Activity). Activity exposes pipeline-event
> APIs that previously had no corresponding Spaces UI. Details is first in primary
> nav.
