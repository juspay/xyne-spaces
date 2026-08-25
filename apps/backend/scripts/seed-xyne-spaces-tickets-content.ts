/**
 * Ticket content for seed-xyne-spaces-tickets.ts.
 *
 * t = title, d = description, s = statusV2, p = priority, th = thread replies.
 * Kept separate from the seeding logic so the copy can be rewritten without
 * touching the write path.
 */

export type TicketSpec = {
  t: string;
  d: string;
  s: 'TODO' | 'STARTED' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
  p: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  th?: string[];
};

export const TICKET_SPECS: TicketSpec[] = [
  // ---- Messaging & channels -------------------------------------------------
  { t: 'Unread divider jumps when a thread reply lands', d: 'Scrolling a channel with an open thread makes the "New messages" divider re-anchor to the wrong message. Reproduces reliably when the reply arrives while the viewport is mid-scroll.', s: 'STARTED', p: 'HIGH', th: ['Only reproduces if the thread panel is open at the same time.', 'The divider index is recomputed on every Zero delta instead of being pinned on first read.', 'Pinning it on channel entry and only clearing on explicit mark-read.'] },
  { t: 'Emoji autocomplete selects the wrong entry on fast typing', d: 'Typing `:smi` then Enter quickly picks the second suggestion rather than the highlighted first one. The filter result arrives after the keydown handler has already read the old list.', s: 'COMPLETED', p: 'MEDIUM', th: ['Classic stale-closure over the suggestion array.', 'Fixed by reading the list from a ref inside the handler.'] },
  { t: 'Draft text lost when switching channels mid-compose', d: 'Draft persistence writes on blur, but a channel switch unmounts the composer before blur fires, so anything typed since the last keystroke flush is dropped.', s: 'COMPLETED', p: 'HIGH', th: ['Lost a long message to this yesterday.', 'Flushing the draft in a cleanup effect on unmount.'] },
  { t: 'Message edit history is not visible to anyone but the author', d: 'Edited messages show the "(edited)" marker but there is no way for other members to see what changed. Comes up constantly in incident channels.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Pinned messages panel does not update without a refresh', d: 'Pinning from the message context menu writes the row but the panel query is not invalidated, so the list is stale until remount.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'Long code blocks overflow the message bubble on narrow windows', d: 'Code fences wider than the bubble push the timestamp column off-screen instead of scrolling inside their own container.', s: 'TODO', p: 'LOW' },
  { t: 'Cannot mention a user who is not yet in the channel', d: 'Typing @ only searches current members. Mentioning someone outside the channel should offer to invite them inline.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Reaction picker steals focus from the composer', d: 'Opening the reaction picker with the keyboard moves focus and does not return it, so the next keystroke goes nowhere.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Channel list re-sorts while you are clicking', d: 'A message arriving in another channel re-sorts the sidebar by activity mid-click, so you land in the wrong channel.', s: 'STARTED', p: 'HIGH', th: ['This one is genuinely infuriating.', 'Freezing sort order while the pointer is over the list.'] },
  { t: 'Support message scheduling in a channel', d: 'People in other timezones want to write now and deliver during the recipient\'s working hours. delayed_messages already exists; needs UI and a delivery worker.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Bulk mark-all-read is O(n) round trips', d: 'Marking a busy workspace read fires one mutation per channel. Should be a single batched mutator.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Deleted messages leave a gap in the thread reply count', d: 'replyCount is not decremented on delete, so threads advertise replies that are not there.', s: 'STARTED', p: 'LOW' },
  { t: 'Link previews render for internal URLs that 404 for the viewer', d: 'The preview is generated with the author\'s permissions, so a viewer without access sees a title they should not.', s: 'TODO', p: 'CRITICAL', th: ['This is an access-control leak, raising priority.', 'Agreed — preview generation has to run per-viewer or be stripped.'] },
  { t: 'Typing indicator persists after the sender disconnects', d: 'No timeout on the indicator, so a dropped socket leaves "X is typing…" on screen indefinitely.', s: 'COMPLETED', p: 'LOW' },
  { t: 'Channel description does not support links', d: 'Descriptions are rendered as plain text. Teams keep pasting runbook URLs that are not clickable.', s: 'TODO', p: 'LOW' },

  // ---- Threads & conversations ---------------------------------------------
  { t: 'Thread panel scroll position resets on every new reply', d: 'Reading history in a busy thread is impossible because each incoming reply snaps you to the bottom regardless of scroll position.', s: 'STARTED', p: 'HIGH' },
  { t: 'Cannot move a thread to another channel', d: 'Conversations started in the wrong channel have to be manually copy-pasted. Needs a move action that rewrites channelId and notifies participants.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Thread participants are not notified when converted to a ticket', d: 'Converting a thread to a ticket silently changes its semantics; the people already in it get no signal.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Follow/unfollow state on threads is not persisted', d: 'Unfollowing a noisy thread lasts until reload. The subscription row is written but never read back on hydrate.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Thread deep links open the channel but not the thread', d: 'Pasted permalinks scroll to the root message and stop; the panel has to be opened manually.', s: 'STARTED', p: 'MEDIUM' },

  // ---- Tickets & boards -----------------------------------------------------
  { t: 'Kanban drag drops the card back when the mutation is slow', d: 'The optimistic move is reverted before the server ack lands on slower connections, so cards visibly snap back and then move again.', s: 'STARTED', p: 'HIGH', th: ['Very visible on the shared staging box.', 'kanbanPosition is being recomputed from server state instead of held optimistically.'] },
  { t: 'Ticket numbers can collide after a restore', d: 'project.ticketSequence is not advanced by bulk paths, so a restore can hand out an xyneId that already exists.', s: 'TODO', p: 'CRITICAL', th: ['Hit this restoring a staging snapshot.', 'The unique index catches it, but the write fails at the user rather than being prevented.'] },
  { t: 'Archived tickets still appear in board counts', d: 'Stage headers count on projectId without filtering isArchived, so totals disagree with what is rendered.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Bulk stage change on a filtered board applies to hidden rows', d: 'Select-all selects the whole query rather than the visible page, so filtered-out tickets move too.', s: 'TODO', p: 'HIGH' },
  { t: 'ETA field accepts dates in the past without warning', d: 'No validation on the eta input; people set an ETA to last month by mistyping the year and nothing flags it.', s: 'TODO', p: 'LOW' },
  { t: 'Ticket card does not show which channel it came from', d: 'On the board there is no way to tell whether a ticket originated in #incidents or #general without opening it.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'Reassigning a ticket does not notify the previous assignee', d: 'The new assignee is notified; the person losing the work is not, so handoffs get missed.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Add saved views for board filters', d: 'People rebuild the same three filters daily. Persist named filter sets per user, shareable per channel.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Stage rename breaks tickets pinned to the old name', d: 'stageName is denormalized onto the ticket row, so renaming a stage strands every ticket referencing the old string.', s: 'STARTED', p: 'HIGH', th: ['Found this after renaming "In Review" to "Review".', 'Either backfill on rename or key off stage id.'] },
  { t: 'Ticket description loses formatting when edited twice', d: 'Round-tripping the description through the editor strips nested lists on the second save.', s: 'TODO', p: 'MEDIUM' },
  { t: 'No keyboard shortcut to create a ticket from a message', d: 'The action exists in the context menu only. Power users want a chord from the message row.', s: 'TODO', p: 'LOW' },
  { t: 'Ticket search ignores the description field', d: 'Only titles are matched, so searching a known error string in a description returns nothing.', s: 'STARTED', p: 'HIGH' },
  { t: 'Priority sort puts CRITICAL below LOW', d: 'Priority is sorted as a string, so alphabetical order wins over severity.', s: 'COMPLETED', p: 'MEDIUM', th: ['CRITICAL < HIGH < LOW < MEDIUM alphabetically. Needs an explicit rank.'] },
  { t: 'Closing a ticket does not close its conversation', d: 'The thread stays active after close, so discussion continues somewhere nobody is watching.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Add per-stage SLA warnings on the board', d: 'board_sla_policies exists but nothing surfaces a breach. Cards should age visibly once past the stage ETA.', s: 'TODO', p: 'MEDIUM' },

  // ---- Zero sync ------------------------------------------------------------
  { t: 'Zero client errors after pulling a migration without db push', d: 'Schema drift between the generated Zero schema and the local database drops the socket into a SchemaVersionNotSupported retry loop with no actionable message in the UI.', s: 'STARTED', p: 'HIGH', th: ['Cost me an hour before I found it in the console.', 'Should be a banner: "your local DB is behind, run db:push".'] },
  { t: 'query-fallback returns 500 instead of a typed error', d: 'The REST fallback surfaces a raw 500 on schema mismatch. The client cannot distinguish it from a transient failure and retries forever.', s: 'TODO', p: 'HIGH' },
  { t: 'Nested related() subqueries are not ACL filtered', d: 'Only the root query is filtered plus the workspace backstop; nested relations rely on the parent being scoped correctly.', s: 'STARTED', p: 'CRITICAL', th: ['We log a warning for each of these at startup already.', 'Need per-relation ACL rather than trusting the root.'] },
  { t: 'Hydration discards caches on any query hash change', d: 'Changing a query invalidates the whole persisted cache, so a one-line query edit costs every user a cold start.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Zero socket reconnect storm after a deploy', d: 'Every client reconnects simultaneously when zero-cache restarts. Needs jittered backoff.', s: 'COMPLETED', p: 'HIGH' },
  { t: 'Mutator errors are swallowed in the UI', d: 'A rejected mutation rolls back optimistically with no toast, so the write silently vanishes.', s: 'STARTED', p: 'HIGH' },
  { t: 'Replica lag is invisible to the client', d: 'No signal when zero-cache is behind upstream, so stale reads look like bugs.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Document the local schema-drift recovery steps', d: 'The db push → zero DDL pickup → reload sequence is tribal knowledge. Put it in the troubleshooting doc.', s: 'TODO', p: 'MEDIUM' },

  // ---- Search ---------------------------------------------------------------
  { t: 'Cmd-K full screen search loses the query on Escape', d: 'Escape closes the overlay and clears state, so reopening starts from an empty box.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Search results do not respect channel permissions', d: 'Vespa returns documents from private channels the searcher cannot open; clicking through 403s.', s: 'STARTED', p: 'CRITICAL', th: ['Titles alone leak enough to matter.', 'ACL filter has to be applied in the Vespa query, not after.'] },
  { t: 'Newly created tickets are not searchable for several minutes', d: 'Indexing is queued through Bull; if the worker is down the backlog is invisible with no operator signal.', s: 'STARTED', p: 'HIGH' },
  { t: 'Search ranks old messages above recent ones', d: 'No recency component in the ranking profile, so a three-year-old message outranks yesterday\'s.', s: 'TODO', p: 'MEDIUM' },
  { t: 'No way to scope a search to one channel', d: 'Search is workspace-wide only. Needs an in:#channel operator.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Search highlights break on multi-byte characters', d: 'Offsets are computed in bytes rather than code points, so highlights land mid-character on non-Latin text.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Reindex job has no progress reporting', d: 'A full reindex runs blind — no count, no ETA, no way to tell if it stalled.', s: 'TODO', p: 'LOW' },

  // ---- Calls ----------------------------------------------------------------
  { t: 'Call recording stops when the organizer leaves', d: 'Egress is bound to the organizer participant, so the recording ends early if they drop off before the meeting does.', s: 'STARTED', p: 'HIGH' },
  { t: 'Transcription drops the first few seconds of every call', d: 'The agent joins after the room is live, so opening words are lost.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Calendar-managed calls lose their link on event edit', d: 'Editing the event in Google Calendar strips the injected conference link unless xyneManaged is respected.', s: 'STARTED', p: 'HIGH', th: ['This is what xyneManaged was added for.', 'Patcher needs to re-inject rather than bail when the flag is set.'] },
  { t: 'Screen share is letterboxed on ultrawide displays', d: 'Aspect ratio is hardcoded to 16:9 so 21:9 shares get pillarboxed and lose detail.', s: 'TODO', p: 'LOW' },
  { t: 'No way to rejoin a call from the channel after leaving', d: 'Once you leave, the join affordance disappears from the channel even while the call is still running.', s: 'TODO', p: 'MEDIUM' },
  { t: 'AI call summary omits action items raised in chat', d: 'Only the audio transcript feeds the summary; in-call chat is ignored even though decisions land there.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Recurring call series shows every instance in the sidebar', d: 'A daily standup floods the calls list with 30 rows instead of collapsing to the series.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'Participant count is wrong after a reconnect', d: 'Reconnecting increments the count without releasing the stale participant row.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Call quality metrics are not retained past 24h', d: 'Debugging a complaint from last week is impossible because the metrics have already rolled off.', s: 'TODO', p: 'LOW' },

  // ---- Canvases & docs ------------------------------------------------------
  { t: 'Canvas archive flag is not respected in the sidebar', d: 'isArchived was added on the canvases table but the sidebar query does not filter on it, so archived docs still show.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'Concurrent canvas edits drop the last few keystrokes', d: 'The y-sweet snapshot lands before the final update is flushed, so the tail of a fast edit is lost.', s: 'STARTED', p: 'HIGH' },
  { t: 'Canvas export to PDF loses embedded diagrams', d: 'SVG nodes are dropped by the export pipeline and come out as blank boxes.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Cannot link a canvas to a ticket', d: 'Design docs and their tickets live separately with no first-class relation between them.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Canvas permissions do not inherit from the channel', d: 'A canvas created in a private channel defaults to workspace-visible.', s: 'STARTED', p: 'CRITICAL', th: ['Confirmed on staging — created in a private channel and it was readable workspace-wide.', 'Defaulting visibility from the parent channel.'] },
  { t: 'Slash commands inside a canvas conflict with the composer', d: 'Typing / in a canvas opens the channel composer command menu behind the editor.', s: 'COMPLETED', p: 'LOW' },
  { t: 'Canvas version history has no restore action', d: 'Versions are recorded and viewable but there is no way to roll back to one.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Blocknote upgrade broke nested list indentation', d: 'After the 0.51 → 0.54 upgrade, nested lists render one level shallower than stored.', s: 'STARTED', p: 'MEDIUM' },

  // ---- AI / Claw ------------------------------------------------------------
  { t: 'Ask-AI answers from channels the asker cannot read', d: 'Retrieval is not ACL-filtered, so answers can quote private channels.', s: 'STARTED', p: 'CRITICAL', th: ['Blocking the AI rollout on this.', 'Filter has to be applied at retrieval, not on the generated answer.'] },
  { t: 'Streamed AI responses duplicate the final chunk', d: 'The last delta is re-emitted on stream close, so the closing sentence appears twice.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Agent runs have no cost attribution', d: 'Token spend is not tagged per workspace, so there is no way to see who is driving cost.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Classifier fires on questions that are not requests', d: '"Who is on call this week?" triggers the start-call intent. Needs anti-prototypes and a threshold review.', s: 'STARTED', p: 'HIGH', th: ['Score is 0.71 against the start-call prototype.', 'Adding anti-prototypes for on-call and rota questions.'] },
  { t: 'Action cards render before the agent finishes proposing', d: 'A partial FlowJSON is rendered mid-stream, so the card flickers through invalid states.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'AI summaries are regenerated on every open', d: 'No caching on the summary, so each viewer pays full inference for identical output.', s: 'TODO', p: 'HIGH' },
  { t: 'Agent tool errors are shown as raw stack traces', d: 'A failing tool call surfaces the internal error verbatim in the chat bubble.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'No way to disable AI features per channel', d: 'Compliance-sensitive channels need an opt-out; the toggle is workspace-wide only.', s: 'TODO', p: 'HIGH' },
  { t: 'Citation panel links to the wrong message on rerender', d: 'Citation indices are positional and go stale when the answer is re-streamed.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'React artifact sandbox can reach the parent origin', d: 'The Sandpack frame is not fully isolated; a generated component can read parent window state.', s: 'STARTED', p: 'CRITICAL', th: ['Needs a hard sandbox attribute plus a separate origin.', 'Blocking the artifact feature on this.'] },
  { t: 'Keep ask-ai evals manual until the rubric settles', d: 'Automating the eval sweep now would lock in a rubric we are still changing weekly.', s: 'PAUSED', p: 'LOW' },
  { t: 'Agent test accounts should not have admin', d: 'Seeded agent users are created with workspace admin, which is more than any of them need.', s: 'TODO', p: 'HIGH' },

  // ---- Notifications --------------------------------------------------------
  { t: 'Desktop notifications fire for your own messages', d: 'Sending from mobile notifies the desktop client because the sender check compares session rather than user.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Mention notifications ignore Do Not Disturb', d: 'DND is checked on the client after delivery rather than on the server before sending.', s: 'STARTED', p: 'HIGH' },
  { t: 'Notification badge count drifts from actual unreads', d: 'The badge is incremented locally and never reconciled against the server count.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'No digest for channels you have muted', d: 'Muting is all-or-nothing. People want a daily digest instead of silence.', s: 'TODO', p: 'LOW' },
  { t: 'Push notifications do not deep link to the thread', d: 'Tapping a reply notification opens the channel root instead of the thread.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Notification socket does not reconnect after sleep', d: 'Waking a laptop leaves the socket disconnected until a manual reload.', s: 'STARTED', p: 'HIGH' },

  // ---- Desktop / Electron ---------------------------------------------------
  { t: 'Electron request interceptor breaks streamed responses', d: 'The interceptor buffers the whole body, so SSE endpoints deliver nothing until the stream closes.', s: 'STARTED', p: 'HIGH' },
  { t: 'Deep links do not focus an existing window', d: 'Opening an xyne:// link spawns a second window rather than focusing the running one.', s: 'TODO', p: 'MEDIUM' },
  { t: 'App does not remember window position across restarts', d: 'Multi-monitor users reposition the window on every launch.', s: 'COMPLETED', p: 'LOW' },
  { t: 'Auto-update silently fails behind a corporate proxy', d: 'The updater has no proxy support and reports "up to date" when it cannot reach the feed.', s: 'TODO', p: 'HIGH' },
  { t: 'Memory grows unbounded with many open threads', d: 'Thread panels are mounted and never released, so a long session climbs past 2GB.', s: 'STARTED', p: 'HIGH', th: ['Heap snapshot shows retained message arrays per closed panel.', 'Panels are cached by id with no eviction.'] },

  // ---- Integrations ---------------------------------------------------------
  { t: 'Slack import drops threaded replies', d: 'The importer maps top-level messages only; replies are flattened into the channel.', s: 'STARTED', p: 'HIGH' },
  { t: 'Google Calendar sync duplicates recurring events', d: 'Each sync run re-creates instances instead of matching on recurringSeriesId.', s: 'STARTED', p: 'HIGH' },
  { t: 'Confluence migration preview times out on large spaces', d: 'The preview walks every page synchronously; spaces over ~2k pages exceed the request timeout.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Jira ticket links do not unfurl', d: 'No unfurl handler registered for Jira URLs, so links stay bare.', s: 'TODO', p: 'LOW' },
  { t: 'GitHub PR status is not reflected on the linked ticket', d: 'stage_pr_status_mappings exists but nothing consumes the webhook to advance the stage.', s: 'TODO', p: 'MEDIUM' },
  { t: 'OAuth token refresh fails silently for disconnected sources', d: 'A revoked grant leaves the source looking connected while every sync 401s.', s: 'STARTED', p: 'HIGH' },
  { t: 'Vespa ingestion drops flowJson payloads', d: 'flowJson fields are not in the ingestion schema, so action cards are unsearchable.', s: 'COMPLETED', p: 'MEDIUM' },

  // ---- Performance ----------------------------------------------------------
  { t: 'Channel switch takes over a second on large workspaces', d: 'Every switch re-runs the member query rather than reading the already-synced client store.', s: 'STARTED', p: 'HIGH' },
  { t: 'Initial hydration blocks first paint for ~500ms', d: 'Hydration is synchronous on the main thread; the shell could paint before it completes.', s: 'STARTED', p: 'HIGH' },
  { t: 'Message list re-renders every row on a single new message', d: 'The list is not virtualized and rows are not memoized, so one arrival re-renders the visible history.', s: 'TODO', p: 'HIGH', th: ['Profiler shows 400+ component updates for one message.', 'Memoizing the row and keying off messageId.'] },
  { t: 'Avatar images are not cached across sessions', d: 'Avatars are refetched on every load; no cache headers on the storage responses.', s: 'COMPLETED', p: 'LOW' },
  { t: 'Board with 500+ tickets drops frames while dragging', d: 'Every pointer move recalculates positions for all cards rather than the dragged one.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Bundle size regressed 400KB after the editor upgrade', d: 'The new editor pulls its full language pack; needs to be code split behind the canvas route.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'Search-as-you-type fires a request per keystroke', d: 'No debounce on the search input, so a ten-character query costs ten round trips.', s: 'COMPLETED', p: 'MEDIUM' },

  // ---- Permissions & admin --------------------------------------------------
  { t: 'Guests can see the full member directory', d: 'Guest accounts should be scoped to the channels they are in, not the whole workspace roster.', s: 'STARTED', p: 'CRITICAL' },
  { t: 'Removing a user from a channel does not revoke their canvas access', d: 'Canvas ACLs are granted at share time and not re-evaluated on membership change.', s: 'TODO', p: 'HIGH' },
  { t: 'Workspace admins cannot audit permission changes', d: 'No audit trail for role and ACL changes, which blocks the compliance review.', s: 'TODO', p: 'HIGH' },
  { t: 'User group membership changes take effect only after re-login', d: 'Group mappings are read once at session start and cached for the session lifetime.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'Deactivated users still appear in assignee pickers', d: 'The picker queries all users rather than filtering on active status.', s: 'COMPLETED', p: 'MEDIUM' },
  { t: 'Private channel names leak through search suggestions', d: 'The channel switcher autocompletes private channels the user is not a member of.', s: 'STARTED', p: 'CRITICAL' },

  // ---- Onboarding & UX ------------------------------------------------------
  { t: 'Onboarding asks for too much before showing value', d: 'Six questions before the user sees a single channel. Most drop off at step three.', s: 'STARTED', p: 'HIGH', th: ['Funnel data: 38% never finish.', 'Cutting to two questions and deferring the rest.'] },
  { t: 'Empty states do not explain what to do next', d: 'A new workspace shows blank panels with no call to action anywhere.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Keyboard shortcuts are undiscoverable', d: 'No shortcut cheatsheet anywhere in the product.', s: 'TODO', p: 'LOW' },
  { t: 'Dark mode has insufficient contrast on secondary text', d: 'Secondary text sits at 3.1:1 against the surface, below the 4.5:1 requirement.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'Timestamps do not respect the user locale', d: 'Everything renders as US format regardless of browser locale.', s: 'COMPLETED', p: 'LOW' },
  { t: 'No confirmation when leaving a channel you own', d: 'Leaving as the last admin orphans the channel with no warning.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Focus outline is missing on the composer', d: 'Keyboard users get no visible focus ring when tabbing into the message box.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Screen reader announces message count instead of content', d: 'The live region is bound to the wrong node, so new messages are announced as a number.', s: 'TODO', p: 'HIGH' },

  // ---- Ops & observability --------------------------------------------------
  { t: 'OTel collector restart loop on local dev', d: 'The collector crash-loops when no backend is reachable and floods logs with ECONNREFUSED.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'No alert when the Vespa indexing queue backs up', d: 'The queue can grow for hours before anyone notices search is stale.', s: 'TODO', p: 'HIGH' },
  { t: 'Structured logs lose the request id across async boundaries', d: 'Context is not propagated through the queue worker, so a request cannot be traced end to end.', s: 'STARTED', p: 'MEDIUM' },
  { t: 'Staging and production share a feature flag namespace', d: 'A staging flag flip has changed production behaviour at least once.', s: 'TODO', p: 'CRITICAL' },
  { t: 'Local setup fails when the DB is behind the Prisma schema', d: 'The dev script does not check for drift, so people hit confusing Zero errors instead of a clear "run db:push".', s: 'TODO', p: 'HIGH', th: ['Third person this month.', 'Adding a drift check to the dev bootstrap.'] },
  { t: 'Dry-run mode for automations', d: 'There is no way to see what an automation would do before enabling it on a live board.', s: 'TODO', p: 'MEDIUM' },
  { t: 'Two automations can ping-pong the same ticket', d: 'Two rules with opposing stage conditions will move a ticket back and forth indefinitely.', s: 'STARTED', p: 'HIGH', th: ['Saw a ticket move 60 times in an hour.', 'Needs loop detection and a per-ticket rate limit.'] },
  { t: 'Warn when renaming a stage that automations reference', d: 'Renaming silently breaks every rule matching on the old name.', s: 'TODO', p: 'HIGH' },
  { t: 'Backup restore procedure is untested', d: 'Restores have never been exercised against a production-sized snapshot.', s: 'TODO', p: 'CRITICAL' },
  { t: 'Health check reports healthy while replication is stalled', d: 'The check only pings the process, not the replication slot lag.', s: 'STARTED', p: 'HIGH' },
];
