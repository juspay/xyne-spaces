# PRD: DL Member Sync — Backfill Older Distribution List Emails

**Status**: Implemented
**Date**: 2026-06-08
**Scope**: Xyne Desk DL desks — one-time backfill of historical DL emails via a member's mailbox.

---

## 1. Problem

DL desks use a workspace-level shared mailbox to receive emails. When the shared mailbox is added as a DL member, only **new** emails (sent after membership) arrive. Historical emails sent to the DL before the shared mailbox joined are inaccessible. Teams lose visibility into pre-existing conversations.

## 2. Solution

**"Sync older emails"** — allows a DL member (who was on the DL before the shared mailbox) to temporarily connect their mailbox via OAuth. The system performs a one-time fetch of older DL emails from their mailbox, creating tickets for threads not already tracked and appending missing messages to existing tickets when a cross-mailbox match is found.

After backfill, ongoing sync continues via the existing shared mailbox webhook — no persistent connection to the member's mailbox is maintained.

## 3. User Flow

1. User opens a DL desk channel in `/support`
2. Clicks the sync dropdown (refresh icon) in the channel header toolbar
3. Selects **"Sync older emails"** from the dropdown menu
4. **Step 1 — Date Range**: Modal appears with preset options (Last 30 days, Last 3 months, Last 6 months, Custom range). User selects the desired range.
5. **Step 2 — Provider**: Modal shows available provider buttons (Google / Microsoft), based on configured OAuth providers. User clicks their email provider.
6. **OAuth Redirect**: Browser redirects to Google/Microsoft OAuth consent screen. User grants the mailbox permissions requested by the existing desk OAuth scopes.
7. **Background Sync**: After consent, user is redirected back to the desk with a toast: *"Syncing older emails in background. We'll notify you when this finishes."*
8. **Completion**: In-app notification appears with the count of synced emails. New tickets appear in the desk's ticket list, and missing older emails may appear inside existing tickets.

## 4. Data Flow

```
User clicks "Sync older emails"
  │
  ▼
POST /api/integrations/desk/:channelId/dl-member-sync-init
  { startDate, endDate, provider }
  │
  ▼
Backend validates DL desk and permissions, stores OAuth state in Redis
  → Returns { authUrl }
  │
  ▼
Browser redirects → OAuth consent → Callback
  │
  ▼
Callback upserts temporary ExternalSource (no webhook)
  → Enqueues EmailFetchQueue job with isDlMemberSync: true
  → Redirects to frontend with ?dlMemberSyncStarted=true
  │
  ▼
EmailFetchWorker processes job:
  1. Fetch mails from member's mailbox in date range
  2. Filter by DL email in From/To/Cc
  3. Group by thread
  4. Cross-source dedup/remap: attach missing emails to an existing ticket when the fetched thread contains an email already in the channel
  5. Ingest remaining new threads as new tickets
  6. Deactivate temporary ExternalSource and clear credentials
  7. Send completion notification
```

## 5. API Contracts

### 5.1 Initiate Member Sync

```
POST /api/integrations/desk/:channelId/dl-member-sync-init
Authorization: Bearer <token>
Body: {
  startDate: string (ISO 8601),
  endDate: string (ISO 8601),
  provider: 'google' | 'microsoft',
  platform?: 'electron' | 'web'
}
Response 200: { authUrl: string }
Response 400: { error: string } — invalid date range or not a DL desk
Response 403: { error: string } — not authorized to manage this desk integration
Response 409: { error: string } — sync already in progress
```

Authorization: channel creator, email-channel owner, or channel participant with `ADMIN` role.

### 5.2 Sync Status

```
GET /api/integrations/desk/:channelId/dl-member-sync-status
Authorization: Bearer <token>
Response 200, inactive: { active: false }
Response 200, active: {
  active: true,
  memberEmail: string,
  provider: 'google' | 'microsoft',
  startedAt: string
}
```

The UI polls this endpoint every 5 seconds for DL desks and disables the older-email sync action while an active temporary source exists.

### 5.3 OAuth Callbacks (existing routes, extended)

- Microsoft: `GET /api/integrations/microsoft/callback` — new `dl-member-sync` mode
- Google: `GET /api/integrations/google/auth/callback` — new `dl-member-sync` mode

Both callbacks upsert a temporary `ExternalSource`, enqueue an `email-fetch` `refetch` job with `isDlMemberSync: true`, and redirect to the support desk.

### 5.4 Frontend Redirect Params

After OAuth callback, frontend receives:

- `?dlMemberSyncStarted=true&provider=google|microsoft` — success, sync started
- `?emailError=<message>` — OAuth failed

## 6. Thread Dedup Logic

**Rule**: If ANY email in a fetched thread already exists in the DL desk channel, reuse that existing conversation/ticket and ingest only missing emails from the fetched thread.

This supports repeat backfills. The member can reconnect for a new or overlapping date range; already-ingested messages are skipped by unique `externalMessageId`, while missing older messages are added to the existing ticket when the existing descendant email is present in the fetched batch.

### Microsoft

- Microsoft `conversationId` can differ across mailboxes, so matching cannot rely only on provider thread id.
- Check: query `Email` table for `externalMessageId IN [thread's internetMessageIds] AND channelId = target`
- If any match is found, get the channel's existing `externalThreadId`, remap the fetched member thread to that id, then ingest the missing messages into the existing conversation.
- The transformer also extracts RFC `References` / `In-Reply-To` from `internetMessageHeaders`, giving `ingestEmailThread` a secondary cross-mailbox match path.

### Google

- Gmail `threadId` is mailbox-specific — can't match directly
- Backfill extracts RFC `References` / `In-Reply-To` values and passes them as `referencedMessageIds`.
- `ingestEmailThread` checks those references against existing channel emails and attaches to the matched conversation when possible.
- Refetch also does an exact in-channel subject + sender check for fetched DL messages, reuses the matched channel thread id, and skips exact duplicates.
- Fallback: Vespa duplicate merge by channel/from/subject when `emailMergeMode: ENABLED`.
- Known trade-off: exact subject + sender matching can still false-match recurring or templated emails from the same sender.

## 7. Thread Continuity

After backfill, new mails arriving via the shared mailbox webhook should correctly append to backfilled conversations as replies (not create duplicates).

Thread matching is evaluated in tiers:

1. Provider thread id / `externalThreadId + channelId`.
2. RFC `References` / `In-Reply-To` lookup against existing channel `externalMessageId`.
3. Vespa duplicate search by channel/from/subject when `emailMergeMode: ENABLED`.

For a typical chain `A -> B -> C`, if `C` already exists and the member backfill fetch includes `A`, `B`, and `C`, the fetched thread attaches to `C`'s existing ticket and inserts missing `A/B`. Future replies arriving through the shared mailbox then attach by provider thread id or RFC references to the existing ticket.

Known caveat: if the backfill fetch includes only older ancestors (`A/B`) and excludes the already-ingested descendant (`C`), those older emails may create a separate ticket. RFC references point backward from replies to parents, so older messages cannot discover newer descendants unless the descendant is included in the batch or reverse-reference indexes are added.

## 8. Constraints

| Constraint      | Detail                                                                            |
| --------------- | --------------------------------------------------------------------------------- |
| Single member   | Only one member sync at a time per DL desk                                        |
| Repeatable      | The same member can run backfill repeatedly; temp source is reused by stable name |
| One-time access | Member's OAuth tokens are cleared after the sync job finishes or fails            |
| Date range      | Max 365 days                                                                      |
| Access control  | Channel creator, email-channel owner, or channel admin can initiate               |
| No webhook      | No persistent subscription on member's mailbox                                    |
| Progress        | Current UI exposes active/inactive state only, not per-message progress           |

## 9. Schema Changes

None. Reuses existing `ExternalSource` model with a temporary instance (naming: `{provider}-dl-sync--{email}--{channelId-prefix}`). OAuth callback uses `upsert` by `name`, so repeat runs refresh credentials and reactivate the same temp source instead of creating duplicates. Active temporary sources are also used as the in-progress marker for the status endpoint and 409 conflict check.

## 10. Future Enhancements

1. **Multi-member sync**: Allow multiple members to sync for the same DL desk
2. **Reverse reference index**: Store/query child-to-parent RFC references both directions so older-only backfills can attach to already-ingested descendants even when the descendant is outside the selected range
3. **Sync history UI**: Show past sync records (who synced, when, how many emails)
4. **Progress tracking**: Real-time progress bar during sync (processed/total)
