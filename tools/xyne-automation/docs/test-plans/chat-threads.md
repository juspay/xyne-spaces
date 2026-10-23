# Chat Threads: Test Cases

Source: feature inventory of `apps/dashboard` + `apps/backend` (2026-10-15).
Thread = a `conversation`; parent = `conversation.initialMessageId`; replies share `conversationId`.
Writes go through Zero mutators (`messages.send/update/delete/react`, `conversations.*`), not REST.

## Legend

- **P0** must-have regression, **P1** important, **P2** nice-to-have / edge.
- **Auto**:
  - **Ready**: doable with existing steps/selectors (`messaging.steps.ts`, `browser.steps.ts`, `tickets.cpt`).
  - **Step**: needs a small new step (mostly *thread-panel-scoped* input/send/assert).
  - **Fixture**: needs fixture/API support (seeded thread, archived channel, private channel, prefs).
  - **Manual**: keep manual (Electron, push, mobile, AI output quality).
- Users/data: baseline `channel-1`, `admin-1`, `user-1`, `user-2`, baseline DM. Use net-new message text per scenario (`generating net-new message details ...`) so scenarios stay parallel-safe.

## Prerequisite: thread-scoped steps (blocker for most cases)

`message-input` and `send-message-button` exist in **both** the channel and thread composer, and the shared
`clicking on "[data-testid='send-message-button']"` uses `.first()` (channel composer). Before automating, add:

1. A `data-testid="thread-panel"` on the `ThreadPannel.tsx` root (or scope via `[data-component='ThreadList']`'s container).
2. Steps / concept:
   - `opening thread for stored user <u> message <m>` → hover `hover-action-reply-in-thread`, wait for `thread-more-options-button`.
   - `sending stored user <u> reply <r> in open thread` → type + send inside thread panel.
   - `verifying stored user <u> reply <r> is visible in open thread`
   - `verifying reply count <n> on stored user <u> message <m>` → `aria-label="View thread (<n> replies)"`.
   - `closing thread panel` → `aria-label="Close thread panel"`.
3. Export `clickHoverActionOnMessage` from `messaging.steps.ts` and allow scoping it to the thread panel.

---

## 1. Opening & closing a thread

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-01 | Open thread via hover "Reply in thread" | admin-1 posts message in channel-1 → hover → `hover-action-reply-in-thread` | Thread panel opens; header "Thread message"; parent shown as first bubble; composer placeholder "Reply to this thread..." and focused | P0 | Ready |
| TH-02 | Open thread via reply-count row | Message with ≥1 reply → click `View thread (N replies)` | Same thread opens with all replies | P0 | Step |
| TH-03 | Close thread panel | Open thread → click `Close thread panel` | Panel closes, channel view remains, URL drops `/:conversationId` | P1 | Ready |
| TH-04 | Close via keyboard `mod+.` | Open thread → press shortcut | Panel toggles closed | P2 | Step |
| TH-05 | Deeplink opens thread | Navigate to `/chat/dir/:channelId/:conversationId` | Thread panel open on that conversation | P1 | Step |
| TH-06 | Copy link of a reply → navigate | Copy link on reply (`hover-action-copy-link`) → open URL | Thread opens and scrolls/highlights that reply (`#origin=…&messageId=…`) | P1 | Step |
| TH-07 | Switching threads | Open thread A → open thread B from channel | Panel shows B; A's content not shown | P1 | Step |
| TH-08 | Thread survives reload | Open thread → reload page | Same thread open after reload | P2 | Step |

## 2. Replying

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-10 | Send a reply | Open thread → type reply → send in thread composer | Reply appears in thread under parent; NOT as a top-level message in channel | P0 | Step |
| TH-11 | Reply count increments | Send 2 replies | Channel row shows "2 replies"; divider in thread shows "2 replies" | P0 | Step |
| TH-12 | Replier avatars + last activity | user-1 and user-2 reply | Channel row shows both avatars (max 3) and "Last activity …" (hover → "View thread") | P2 | Step |
| TH-13 | Other member receives reply realtime | admin-1 and user-1 both have thread open; admin-1 replies | Reply appears for user-1 without reload | P0 | Step |
| TH-14 | Empty reply blocked | Open thread → send with empty / whitespace input | Nothing sent; reply count unchanged | P1 | Step |
| TH-15 | Rich text / code block in reply | Send reply with bold + code block | Formatting rendered in thread | P2 | Step |
| TH-16 | Reply with attachment | Attach file in thread composer → send | Reply shows file; Files visible | P1 | Step |
| TH-17 | Send blocked while upload in flight | Attach large file → send immediately | Toast "Attachment is still uploading"; not sent | P2 | Step |
| TH-18 | Reply in DM thread | Baseline DM → open thread → reply | Reply visible to both DM users | P1 | Step |
| TH-19 | Reply in group DM thread | Group DM → reply in thread | All members see reply | P2 | Step |
| TH-20 | Long reply (40,000 char limit) | Send reply > 40,000 visible chars | **Known gap**: Zero mutator doesn't enforce limit. Assert expected behavior with product (reject vs accept) | P2 | Step |
| TH-21 | No nested threads | Hover a reply inside thread | No "Reply in thread" action on replies | P1 | Step |

## 3. "Send to channel"

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-30 | Reply with "Send to channel" checked | Check "Send to channel" → send | Thread copy shows "Also sent to channel"; channel shows copy with "replied to a thread: <preview>" | P0 | Step |
| TH-31 | Channel copy opens parent thread | Click "replied to a thread" on channel copy | Parent thread opens | P1 | Step |
| TH-32 | DM label | Open DM thread | Checkbox label is "Send as direct message" | P2 | Step |
| TH-33 | Send to channel after the fact | Own reply → More → "Send to channel" | Copy appears in channel; option disappears afterwards | P1 | Step |
| TH-34 | Not available on others' replies | user-1 opens More on admin-1's reply | "Send to channel" not shown | P2 | Step |
| TH-35 | Checkbox hidden while editing | Edit own reply | No "Send to channel" checkbox | P2 | Step |
| TH-36 | Deleting reply removes channel copy | Reply sent to channel → delete reply | Channel copy also removed | P1 | Step |

## 4. Actions on replies (clone of `04_message-actions.spec` for thread context)

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-40 | Edit own reply | `hover-action-edit-message` → change text → save | Text updated, "(edited)" marker; other user sees update | P0 | Step |
| TH-41 | Edit to empty rejected | Clear text → save | Rejected ("Message content cannot be empty"); original kept | P2 | Step |
| TH-42 | Delete own reply | `hover-action-delete-message` → `confirm-delete-message` | Reply removed; reply count decrements | P0 | Step |
| TH-43 | Cannot edit/delete others' replies | user-1 hovers admin-1's reply | No edit/delete actions | P1 | Step |
| TH-44 | React to a reply | `hover-action-add-reaction` → pick emoji | Reaction shown with count 1; other user sees it | P1 | Step |
| TH-45 | Remove own reaction | Click own reaction | Reaction removed | P2 | Step |
| TH-46 | Bookmark reply | `hover-action-add-bookmark` | Reply bookmarked; then `remove-bookmark` available | P2 | Step |
| TH-47 | Mark reply unread | `hover-action-mark-unread` | Toast "Marked as unread"; "New Messages" divider at that reply | P1 | Step |
| TH-48 | Copy reply text | `hover-action-copy-message` | Clipboard = reply text | P2 | Step |
| TH-49 | Forward a reply | `hover-action-forward-message` → pick user-1 DM | Forwarded message appears in target DM | P2 | Step |
| TH-50 | Pin only on root | Hover root in thread vs hover reply | Pin action present on root only | P2 | Step |
| TH-51 | Remind me on reply | `hover-action-remind-me` → preset | Reminder set confirmation | P2 | Step |

## 5. Parent message rules

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-60 | Edit parent | Edit root inside thread | Updated in thread and in channel row | P1 | Step |
| TH-61 | Delete parent with replies | Delete root that has replies | Root shows "This message was deleted"; replies remain accessible | P0 | Step |
| TH-62 | Delete parent without replies | Delete root with 0 replies | Message fully gone from channel | P1 | Ready (`04_message-actions`) |
| TH-63 | Delete last reply under deleted parent | TH-61 state → delete all replies | Ghost root and thread removed from channel | P2 | Step |
| TH-64 | Delete hidden when thread has ticket | Create ticket from thread (`tickets.cpt`) → hover root | No delete action | P2 | Ready-ish |

## 6. Mentions

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-70 | @mention member in reply | Reply "@user-1 …" | Mention rendered; user-1 gets mention activity; Threads sidebar badge increments | P0 | Step |
| TH-71 | @channel / @here blocked | Reply with "@channel" | Toast "Not allowed in threads — @channel and @here are disabled in thread replies." | P1 | Step |
| TH-72 | @channel allowed with preference | Enable `allow-thread-broadcast-mentions` → reply "@channel" | Sent | P2 | Fixture |
| TH-73 | @mention non-member | Mention user not in channel | System message visible only to sender with Add / Ignore; Add adds user to channel | P2 | Fixture |

## 7. Subscription & notifications

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-80 | Replying auto-subscribes | user-1 replies to admin-1's thread; admin-1 replies again | user-1 gets `replied` activity | P0 | Step |
| TH-81 | Parent author notified of reply | user-1 replies to admin-1's message | admin-1's Activity shows reply notification; click opens thread at that reply | P0 | Step |
| TH-82 | Sender not notified of own reply | admin-1 replies to own thread | No activity for admin-1 | P1 | Step |
| TH-83 | Unsubscribe stops notifications | More → "Unsubscribe from notifications" → other user replies | No new activity | P1 | Step |
| TH-84 | Re-subscribe on reply | After TH-83, reply in thread | Subscribed again (menu shows "Unsubscribe…") | P2 | Step |
| TH-85 | Manual subscribe without replying | user-2 → More → "Subscribe to notifications" → user-1 replies | user-2 notified; thread in user-2 Threads page | P1 | Step |
| TH-86 | Mention not double-notified | Reply mentioning subscribed user | Exactly one activity (mention) | P2 | Step |
| TH-87 | Channel "Thread replies" toggle off | Disable `channel-thread-reply-toggle` → reply | No reply notification for that channel | P2 | Step |
| TH-88 | Global thread reply pref off | Disable `threadReplyNotificationsEnabled` | No reply notifications | P2 | Fixture |
| TH-89 | Push / Slack delivery | — | — | P2 | Manual |

## 8. Threads page (`/chat/dir/threads`)

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-90 | Open Threads page from sidebar | Click "Threads" | URL `/chat/dir/threads`; list renders | P0 | Ready |
| TH-91 | Followed thread with reply appears | user-1 replies to admin-1 thread | Thread card visible on both users' Threads page | P0 | Step |
| TH-92 | Thread with no replies not listed | Post message, no reply | Not on Threads page | P1 | Step |
| TH-93 | Unread first + "You're up-to-date" | One unread, one read thread | Unread above divider, read below | P1 | Step |
| TH-94 | Sort "Most recent" persists | Switch sort → reload | Choice persists | P2 | Step |
| TH-95 | Reply from Threads page card | Type in card composer → send | Reply appears in thread & channel reply count updates | P1 | Step |
| TH-96 | Show older / collapse | Thread with >3 replies | "Show N older replies" expands, "Collapse thread" collapses | P2 | Fixture |
| TH-97 | Click channel name opens thread in channel | Click card channel name | Navigates to channel with thread open | P2 | Step |
| TH-98 | Unread state on sidebar | Other user replies in followed thread | "Threads" bold; mention count badge for @mentions | P1 | Step |
| TH-99 | Opening thread clears unread | Open unread thread | Sidebar no longer bold; "New Messages" divider shown once | P1 | Step |
| TH-100 | Empty state | Fresh user with no threads | "No threads yet" | P2 | Fixture |
| TH-101 | Removed member loses thread | Remove user-2 from channel | Thread gone from user-2's Threads page; no more notifications | P2 | Fixture |

## 9. Permissions & channel states

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-110 | Non-member in public channel | Non-member opens thread deeplink | Join prompt instead of composer | P1 | Fixture |
| TH-111 | Private channel non-member | Non-member opens deeplink | No access; server rejects send ("You need to be a participant…") | P1 | Fixture |
| TH-112 | Archived channel thread | Open thread in archived channel | Banner "You are viewing a thread from an archived channel"; no composer, no edit, no call/ticket actions | P1 | Fixture |
| TH-113 | Archived channel via API (**gap**) | Send reply via Zero push to archived channel | Should be rejected; server currently doesn't check `isArchived` | P2 | Fixture (API) |
| TH-114 | Deactivated DM thread | Open thread in DM with deactivated user | Read-only, no composer/header actions | P2 | Fixture |
| TH-115 | Non-member cannot react | Non-member reacts via API | Rejected "Only member of the channel can react…" | P2 | Fixture (API) |

## 10. Drafts, typing, offline

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-120 | Per-thread draft saved | Type in thread composer → close thread | Channel row shows "1 draft"; reopen → text restored | P1 | Step |
| TH-121 | Drafts isolated per thread | Draft in thread A, open thread B | B's composer empty | P2 | Step |
| TH-122 | Typing indicator in thread | user-1 types in thread; admin-1 has it open | admin-1 sees typing indicator | P2 | Step |
| TH-123 | Offline send queued | Go offline → send reply → go online | Offline banner; reply pending then sent (retry/discard available) | P2 | Step (`context.setOffline`) |

## 11. Thread header actions, tickets, AI

| ID | Title | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-130 | Create ticket from thread | Already covered | Ticket created | P0 | Ready (`03_ticket-from-message.spec`) |
| TH-131 | Thread tags | More → "Thread tags" → choose tag | Tag chip in header | P2 | Step |
| TH-132 | Add to stream | More → "Add to stream" | Thread appears in stream | P2 | Step |
| TH-133 | @bot in thread replies | Reply "@<chat bot> question" | Bot replies in same thread; agent progress pill shown | P2 | Manual/Fixture |
| TH-134 | Bot-started thread auto-routes | Reply without mention in bot thread | Bot responds | P2 | Manual |
| TH-135 | Catch-up summary | ≥10 unread replies from others → open | "Show thread summary" card; dismissable | P2 | Fixture |
| TH-136 | Start call / Take notes from thread | Header call / recording | Call starts; "Recording" pill on channel row | P2 | Manual |
| TH-137 | Open in new window | More → "Open in new window" | Electron only | P2 | Manual |

## 12. API-level (tests/01_api)

| ID | Title | Request | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TH-140 | List user threads | `GET /api/conversations/threads?limit=10` | 200; only subscribed threads with ≥1 reply | P1 | Step |
| TH-141 | Limit bounds | `limit=0` / `limit=51` | 400 | P2 | Step |
| TH-142 | Cursor pagination | Page with `cursor` | No duplicates across pages | P2 | Fixture |
| TH-143 | REST reply | `POST /api/conversations/:id/messages` | 201; reply count increments | P1 | Step |
| TH-144 | REST reply errors | Unknown conv / no access / empty body | 404 / 403 / 400 | P1 | Step |
| TH-145 | Conversation by message | `GET /api/conversations/by-message/:messageId` | Returns parent conversation | P2 | Step |

## 13. Multi-user scenarios (3+ users, concurrent sessions)

Catalog users: `admin-1`, `admin-2`, `user-1`…`user-4`. Each user runs in its own temp browser
(`Logging in user "user-2" on temp browser "user2-browser-1"` → `switching to temp browser …`), same pattern
as `02_group-chat.spec`. Unless noted, all users are members of baseline `channel-1`.

### 13a. Conversation flow

| ID | Title | Users | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|---|
| TH-150 | Round-robin conversation in a channel thread | admin-1, user-1, user-2, user-3 | admin-1 posts root; user-1 → user-2 → user-3 → admin-1 each reply in turn | Every user sees all 4 replies **in send order** with correct sender names; reply count = 4; channel row shows 3 avatars + overflow | P0 | Step |
| TH-151 | Live delivery to every open session | admin-1, user-1, user-2 | All 3 keep the thread open; each sends one reply | Each reply appears in the other two sessions without reload | P0 | Step |
| TH-152 | Simultaneous replies | user-1, user-2, user-3 | All three send a reply at nearly the same time | No reply lost or duplicated; all sessions show the same 3 replies in the same order; count = 3 | P1 | Step |
| TH-153 | Reply count consistent across viewers | admin-1, user-1, user-2 | user-1 and user-2 reply; admin-1 watches channel view (thread closed) | admin-1's channel row updates to "2 replies" live; avatars of user-1 and user-2 | P1 | Step |
| TH-154 | Group DM thread, 4 members | user-1, user-2, user-3, user-4 | user-1 creates group DM with the other 3, posts root; user-2 and user-4 reply | All 4 members see the thread and both replies; user-3 (not replied) still sees reply count | P0 | Step |
| TH-155 | 1:1 DM thread, both users reply | user-1, user-2 | user-1 opens thread on own DM message, both reply | Both see both replies; other participant auto-added to the thread | P1 | Step |
| TH-156 | Long multi-user thread (seeded) | 4 users | Seed root + 20 replies alternating across 4 users | Order preserved, scroll to top/bottom works, "Scroll to bottom" FAB shown when scrolled up | P2 | Fixture |

### 13b. Concurrent edits / deletes / reactions

| ID | Title | Users | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|---|
| TH-160 | Edit seen by all viewers | admin-1, user-1, user-2 | admin-1 edits own reply while others have thread open | Updated text + "(edited)" in all sessions | P1 | Step |
| TH-161 | Delete seen by all viewers | admin-1, user-1, user-2 | user-1 deletes own reply | Reply disappears for all; count decrements everywhere | P1 | Step |
| TH-162 | Parent deleted while others are replying | admin-1, user-1 | user-1 has thread open & typing; admin-1 deletes root (has replies) | user-1 sees "This message was deleted" on root; user-1 can still send reply | P1 | Step |
| TH-163 | Multiple users react with same emoji | user-1, user-2, user-3 | All three add 👍 to the same reply | Single 👍 chip with count 3; hover lists all 3 names | P1 | Step |
| TH-164 | Users react with different emojis | user-1, user-2 | user-1 👍, user-2 🎉 on same reply | Two chips, count 1 each, visible to both | P2 | Step |
| TH-165 | Cannot remove another user's reaction | user-1, user-2 | user-1 reacts 👍; user-2 clicks the 👍 chip | user-2's click adds their own reaction (count 2), doesn't remove user-1's | P2 | Step |
| TH-166 | Typing indicator with multiple typers | admin-1, user-1, user-2 | user-1 and user-2 type in thread; admin-1 watches | admin-1 sees both users typing; indicator clears after they stop / send | P2 | Step |

### 13c. Notifications & Threads page fan-out

| ID | Title | Users | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|---|
| TH-170 | Reply notifies all participants except sender | admin-1, user-1, user-2, user-3 | admin-1 root; user-1 & user-2 reply; user-3 replies | admin-1, user-1, user-2 each get a reply activity for user-3's reply; user-3 gets none | P0 | Step |
| TH-171 | Non-participant member not notified | admin-1, user-1, user-4 | user-1 replies to admin-1; user-4 is channel member but never replied/subscribed | user-4 gets no activity; thread not on user-4's Threads page | P0 | Step |
| TH-172 | One participant unsubscribes | admin-1, user-1, user-2 | user-2 unsubscribes; user-1 replies | admin-1 notified, user-2 not | P1 | Step |
| TH-173 | Mention brings a new user in | admin-1, user-1, user-3 | user-1 replies "@user-3 …" in admin-1's thread | user-3 gets a **mention** activity (not a duplicate reply activity); later replies notify user-3 too (MENTIONED participant) | P1 | Step |
| TH-174 | Mention removed via edit | user-1, user-3 | user-1 edits reply to remove @user-3; someone replies again | user-3 no longer notified of new replies | P2 | Step |
| TH-175 | Threads page shows thread for every participant | admin-1, user-1, user-2 | Round-robin reply | Thread card on all 3 users' Threads page; unread for those who didn't send the latest reply | P1 | Step |
| TH-176 | Unread state independent per user | admin-1, user-1, user-2 | user-2 replies; admin-1 opens thread, user-1 doesn't | admin-1: read / sidebar not bold; user-1: still unread | P1 | Step |
| TH-177 | Mark unread is per user | user-1, user-2 | user-1 marks a reply unread | Only user-1 sees "New Messages" divider; user-2 unaffected | P2 | Step |
| TH-178 | Catch-up summary needs replies from others | 4 users | 3 users post ≥10 replies total; 4th opens | 4th sees "Show thread summary"; a user who sent the latest reply doesn't | P2 | Fixture |

### 13d. Membership changes mid-thread

| ID | Title | Users | Steps | Expected | Pri | Auto |
|---|---|---|---|---|---|---|
| TH-180 | Member removed during an active thread | admin-1, user-1, user-2 (net-new channel) | user-2 replies; admin-1 removes user-2 from channel; user-1 replies | user-2 not notified; thread drops off user-2's Threads page | P1 | Fixture (net-new channel) |
| TH-181 | New member joins and reads history | admin-1, user-1, user-3 (net-new channel) | Thread with replies exists; admin-1 adds user-3 | user-3 sees full thread history and can reply | P1 | Fixture (net-new channel) |
| TH-182 | Channel archived while a user has the thread open | admin-1, user-1 (net-new channel) | user-1 has thread open; admin-1 archives channel | user-1 composer replaced by archived banner (live or on reopen) | P2 | Fixture (net-new channel) |
| TH-183 | Send to channel seen by non-participants | admin-1, user-1, user-4 | user-1 replies with "Send to channel" | user-4 (not in thread) sees channel copy "replied to a thread"; clicking opens thread | P1 | Step |

> 13d mutates membership, so it **must** use a net-new channel per scenario (`channel-<suffix>` via the
> channel creation flow), never baseline `channel-1`.

### Example spec shape (TH-150)

```
## Four users reply in turn and everyone sees the same thread
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-th150"
* Logging in user "user-2" on temp browser "user2-browser-th150"
* Logging in user "user-3" on temp browser "user3-browser-th150"
* Ensuring user "admin-1" is logged in
* generating net-new message details "thread-root" with text "Thread root" in channel "channel-1" for user "admin-1"
* Sending stored message "thread-root" in channel "channel-1" for user "admin-1"
* switching to temp browser "user1-browser-th150"
* Opening thread for stored user "admin-1" message "thread-root"            // new concept
* Sending reply "reply-u1" in open thread for user "user-1"                 // new concept
* switching to temp browser "user2-browser-th150"
* Opening thread for stored user "admin-1" message "thread-root"
* Sending reply "reply-u2" in open thread for user "user-2"
* switching to temp browser "user3-browser-th150"
* Opening thread for stored user "admin-1" message "thread-root"
* Sending reply "reply-u3" in open thread for user "user-3"
* switching to main browser
* Opening thread for stored user "admin-1" message "thread-root"
* verifying open thread replies are "reply-u1, reply-u2, reply-u3" in order  // new step
* verifying reply count "3" on stored user "admin-1" message "thread-root"   // new step
```

Multi-user notes:
- Use unique temp browser names per scenario (`<user>-browser-<caseId>`), so parallel runs don't collide.
- After switching browsers, wait on the specific reply text (`waiting for message with text … to appear`), not a fixed sleep.
- For "simultaneous" cases (TH-152), send from each page without awaiting the sync in between, then `waiting for zero sync to settle` and assert on all pages.
- Users not involved in a scenario may still be posting into `channel-1` from other scenarios: assert presence/order of *your* replies, never total counts in the channel.

---

## Suggested first automation batch

New spec folder `tests/03_e2e/05_messaging/` → `05_thread-replies.spec`, `06_thread-actions.spec`, `07_thread-notifications.spec`, `08_threads-page.spec`, `09_thread-multi-user.spec`.

1. **Build prerequisites** (thread-panel testid + 4–5 scoped steps + `thread.cpt`).
2. **P0 batch**: TH-01, TH-10, TH-11, TH-13, TH-30, TH-40, TH-42, TH-61, TH-70, TH-80, TH-81, TH-90, TH-91,
   plus multi-user TH-150, TH-151, TH-154, TH-170, TH-171.
3. **P1 batch**: remaining Step-only P1s.
4. **Fixture work** (archived/private channel, seeded thread with N replies, prefs) unlocks section 9 and TH-96/TH-135.

Parallel-safety notes:
- Every scenario creates its own net-new root message in baseline `channel-1`; never reuse another scenario's thread.
- Notification assertions should match on the scenario's unique message text, not on counts (other scenarios post into the same channel).
- Threads-page assertions: look for the specific card, don't assert list order/length.
