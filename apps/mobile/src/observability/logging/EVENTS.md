# Logging events

This is the catalog of events emitted by the mobile structured logger
(`src/observability/logging`). The TypeScript source of truth is
[`events.ts`](./events.ts). Every `logger.info` / `warn` / `error` / `debug`
call must use a name from that map, with the fields declared there.

When you add or change an event, update **both** `events.ts` and this file.

## How to read an event

Each event below has:

- **Purpose** — why it exists and what question it answers
- **Fields** — payload keys (device/session context is attached automatically,
  including `email`, `userId`, and `workspaceId` when a session is persisted)
- **When** — the user-visible or process moment it fires
- **Typical level** — `info`, `warn`, or `error`

Launch duration is native process/activity start (T0) to the default screen
becoming ready (T2). Tab duration is the press of a _different_ tab (T0) to that
tab’s content being ready (T2). Notification-open duration is native T0 only
when this tap still belongs to that launch (startup in progress, or a
notification-caused process/activity start within 20s). Later taps on the same
process are warm: T0 is tap uptime. Native `launchCause` is sticky for the
process lifetime and must not keep those later taps on process-start T0. Android
recents-swipe often destroys `MainActivity` (resetting `activityUptimeMs`) while
keeping the JS process; if `appUptimeMs` is older than 20s the tap is warm even
though the Activity is new.

---

### `app_started`

**Purpose:** The structured logger and device-environment collectors are
running. This is **not** user-perceived startup time; use
`app_startup_completed` for that.

**Fields:** none

**When:** Root layout mounts, after `appDeviceEnvironment.start()` settles.

**Typical level:** `info`

---

### `deep_link_workspace_switch_started`

**Purpose:** A message/call deep link targets a workspace that is not currently
active, so the app is switching workspaces before opening the link.

**Fields:**

| Field               | Meaning                     |
| ------------------- | --------------------------- |
| `targetWorkspaceId` | Workspace the link requires |

**When:** Cross-workspace deep-link handling decides a switch is required.

**Typical level:** `info`

---

### `deep_link_workspace_switch_failed`

**Purpose:** The workspace switch needed by a deep link did not complete.

**Fields:**

| Field               | Meaning                      |
| ------------------- | ---------------------------- |
| `targetWorkspaceId` | Workspace the link required  |
| `error`             | Why `switchWorkspace` failed |

**When:** `switchWorkspace` throws while handling a cross-workspace link.

**Typical level:** `warn`

---

### `deep_link_workspace_switch_not_a_member`

**Purpose:** The link named a workspace the signed-in user is not a member of,
so the link is abandoned rather than opened.

**Fields:**

| Field      | Meaning                                       |
| ---------- | --------------------------------------------- |
| `segments` | Workspace scope segments parsed from the link |

**When:** Deep-link workspace resolution returns `unavailable`.

**Typical level:** `warn`

---

### `deep_link_workspace_switch_member_list_failed`

**Purpose:** The member-workspace list could not be loaded. The switch decision
then falls back to the link’s scope segments alone.

**Fields:**

| Field   | Meaning                           |
| ------- | --------------------------------- |
| `error` | Why `loadMemberWorkspaces` failed |

**When:** Fetching member workspaces rejects during deep-link handling.

**Typical level:** `warn`

---

### `deep_link_copy_link_workspace_missing`

**Purpose:** The user copied a message link while no active workspace id was
available (cold cache). The copied URL omits the workspace segment so it is
still openable in-place, but it is not a full cross-workspace link.

**Fields:**

| Field     | Meaning                                                      |
| --------- | ------------------------------------------------------------ |
| `context` | Where copy happened (for example `'thread'` vs conversation) |

**When:** Copy-link in the message action sheet cannot resolve
`getActiveWorkspaceId()`.

**Typical level:** `warn`

---

### `navigation_tab_changed`

**Purpose:** User-perceived time to switch between bottom tabs: press of a
different tab until that tab’s content is ready (list, empty state, or static
screen — not a spinner).

**Fields:**

| Field        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `fromTab`    | Tab that was active when the user pressed                                  |
| `toTab`      | Tab that became ready (`channels` · `dms` · `calls` · `activity` · `more`) |
| `durationMs` | T0 (tab press) → T2 (destination content ready)                            |

**When:** The destination tab is focused **and** reports content ready via
`useReportTabReady`.

**Typical level:** `info`

---

### `app_startup_completed`

**Purpose:** User-perceived cold start: native T0 until the default screen for
this launch is ready. One event per native activity/app start. A warm resume (no
new native `onCreate`) must not emit. Signed-in T2 is always the DMs list, even
if the user then lands in chat, a call, or share.

**Fields:**

| Field          | Meaning                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `durationMs`   | Native T0 → default screen ready (T2)                                                                  |
| `launchCause`  | Why this process/activity started: `'direct'` · `'notification'` · `'call'` · `'deeplink'` · `'share'` |
| `destination`  | Screen that defined T2: `'dms'` · `'login'` · `'enrollment'`                                           |
| `nativeAnchor` | Clock used for T0: `'activity'` (Android `MainActivity.onCreate`) or `'app'` (iOS app uptime)          |

**When:** Splash is hidden, launch cause has settled, and the destination screen
reports ready (`useReportStartupReady`). Flushed immediately so the event is not
stuck in the remote queue.

**Typical level:** `info`

---

### `app_startup_dropped`

**Purpose:** A cold-start attempt produced an implausible `durationMs` (above 60
s). This usually means the app was suspended in the background between native T0
and the destination becoming ready — common on iOS where `systemUptime` keeps
advancing while the process is frozen. The attempt is not emitted as
`app_startup_completed` so dashboards and histograms are not poisoned.

**Fields:**

| Field          | Meaning                                        |
| -------------- | ---------------------------------------------- |
| `durationMs`   | Raw measured T0 → T2 (not trusted)             |
| `launchCause`  | Same as `app_startup_completed`                |
| `destination`  | Same as `app_startup_completed`                |
| `nativeAnchor` | Same as `app_startup_completed`                |
| `reason`       | Always `'exceeds_max_valid_duration'`          |
| `maxValidMs`   | Upper bound used for the sanity check (60 000) |

**When:** `emitStartupCompleted` receives a completed cold start whose
`durationMs` exceeds the max valid threshold.

**Typical level:** `warn`

---

### `notification_open_completed`

**Purpose:** User-perceived time from a chat-message notification tap until that
message is highlighted in view. One event per journey. T2 always fires: success,
skeleton/highlight timeout, or abandon. Independent of `app_startup_completed`,
which still ends at the DMs list.

**Fields:**

| Field                | Meaning                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `durationMs`         | T0 → T2. Cold T0 is native activity/app start; warm T0 is this tap’s uptime.                                                                    |
| `outcome`            | Why T2 fired: `'highlighted'` · `'skeleton_timeout'` · `'highlight_timeout'` · `'abandoned'`                                                    |
| `surface`            | `'channel'` (main chat) or `'thread'`                                                                                                           |
| `appState`           | `'cold'` (this tap still belongs to the native process launch) or `'warm'` (later tap, or Activity restart on a process already older than 20s) |
| `nativeAnchor`       | Clock used for T0: `'activity'` or `'app'`                                                                                                      |
| `idealPath`          | Expected Expo route templates from DMs to the destination                                                                                       |
| `realPath`           | Templates pushed as each screen actually focused                                                                                                |
| `pathMatched`        | `idealPath === realPath`                                                                                                                        |
| `chatSkeletonShown`  | Chat or thread open placeholder appeared at least once                                                                                          |
| `messageHighlighted` | Target message was visible with highlight painted                                                                                               |
| `channelId`          | Destination channel                                                                                                                             |
| `messageId`          | Target message, or `null` when the payload had none                                                                                             |
| `threadId`           | Thread id for thread opens, otherwise `null`                                                                                                    |

**When:** The journey closes — target row visible and highlighted, skeleton
watchdog (8s after skeleton appears), highlight watchdog (8s after list ready),
journey watchdog (20s from T0), background, or a newer tap. Flushed immediately.

**Typical level:** `info`

### `notification_header_resolved`

**Purpose:** After a chat-message notification tap, whether the conversation
header title resolved to a real name (or a known fallback) instead of showing
`Unknown`. One event per tap. Independent of `notification_open_completed`,
which ends at message highlight.

**Fields:**

| Field                             | Meaning                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `durationMs`                      | T0 (same clock as `notification_open_completed`) → T2                                                                                            |
| `outcome`                         | Why this event fired: `'resolved'` (usable title), `'missing'` (lists published, title still Unknown / Unknown User), `'timeout'`, `'abandoned'` |
| `headerStatus`                    | What the title classifier said at T2: `'pending'` · `'resolved'` · `'unknown'` · `'unknown_user'` · `'group_fallback'`                           |
| `channelPresentInVisibleChannels` | Whether this id is in the visible-channels list the header reads                                                                                 |
| `visibleChannelListPublished`     | Whether `userVisibleChannelsV2` had been written into the state machine by T2                                                                    |
| `userDirectoryPublished`          | Whether `getUsersV2` had been written into the state machine by T2                                                                               |
| `scopeType`                       | Channel scope when known, otherwise `null`                                                                                                       |
| `surface`                         | `'channel'` or `'thread'`                                                                                                                        |
| `nativeAnchor`                    | `'activity'` or `'app'`                                                                                                                          |
| `channelId`                       | Destination channel                                                                                                                              |
| `messageId`                       | Target message, or `null`                                                                                                                        |
| `threadId`                        | Thread id, or `null`                                                                                                                             |
| `notificationId`                  | Server FCM notification id, same as `notification_payload_received`                                                                              |
| `notificationType`                | FCM `type`, e.g. `THREAD_REPLY`                                                                                                                  |
| `metadata`                        | Raw FCM `data.metadata` JSON string (channel/conversation/sender/title)                                                                          |

`outcome` is the journey close reason. `headerStatus` is the title taxonomy.
They often match (`resolved`/`resolved`, `missing`/`unknown`) but not always:
Group Chat is `outcome=resolved` + `headerStatus=group_fallback`; a hung load is
`outcome=timeout` + `headerStatus=pending`.

**When:** The header title is classified as resolved (or Group Chat fallback),
the lists are ready and the title is still Unknown / Unknown User, 60s after the
header first observed a pending title, background, or a newer tap. A
notification open whose channel is missing from the current visible-channel list
stays pending for that 60s window instead of closing as `missing`, so a stale
cache can be replaced by the live list. Flushed immediately.

**Typical level:** `info`

### `chat_open_skeleton_completed`

**Purpose:** How long the chat/thread open placeholder (`ConversationSkeleton`)
stayed on screen. Independent of `notification_open_completed`, which ends at
message highlight and only exists for notification taps.

**Fields:**

| Field        | Meaning                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| `durationMs` | T0 (placeholder shown) → T2 (placeholder hidden, or unmount if abandoned) |
| `outcome`    | `revealed` = list replaced the skeleton; `abandoned` = user left first    |
| `surface`    | `channel` or `thread`                                                     |
| `entry`      | `direct` (in-app open) or `notification`                                  |

**When:** Placeholder becomes hidden, or the chat/thread unmounts while it was
still showing. Cache-hit opens that never show a skeleton do not emit.

**Typical level:** `info`

---

### `chat_date_separator_observed`

**Purpose:** Diagnose whether a chat date separator received a valid timestamp
and complete label, and whether its native badge had usable geometry. This
separates data/formatter failures from Android layout or recycled-row symptoms
without logging message content, scroll frames, or every layout callback.
`formattedLabel` is the JS string passed to the pill, not the pixels on screen.

**Fields:**

| Field                            | Meaning                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface`                        | `channel-inline`, `channel-floating`, `thread-inline`, or `thread-floating`                                                                                                       |
| `phase`                          | `initial-open` before a user drag, otherwise `interaction`                                                                                                                        |
| `reason`                         | `baseline` for the first healthy observation per surface; `long-date-boundary` for a later complete day/month label; `anomaly` for invalid, incomplete, or zero-size observations |
| `channelId` / `conversationId`   | Chat scope; conversation is `null` for channel-level floating/date rows when unavailable                                                                                          |
| `boundaryId`                     | Stable message/date-row boundary id when available                                                                                                                                |
| `createdAtMs`                    | Source timestamp, or `null` when invalid                                                                                                                                          |
| `timestampStatus`                | `valid-ms`, `seconds-like`, or `invalid`                                                                                                                                          |
| `formattedLabel`                 | Exact short label supplied to the pill, not the clipped on-screen text                                                                                                            |
| `labelShape`                     | Relative, complete day/month label, day-only, unavailable, empty, or other                                                                                                        |
| `measurementStatus`              | Whether the badge measured with positive width and height                                                                                                                         |
| `badgeWidthDp` / `badgeHeightDp` | Rounded native badge geometry                                                                                                                                                     |
| `screenWidthDp` / `fontScale`    | Device geometry context                                                                                                                                                           |

**When:** The badge first reports a layout for each surface, or reports an
invalid/incomplete/zero-size observation. After a relative baseline such as
`Yesterday`, the first complete long-date boundary such as
`Sunday, 13 September` is also recorded so the exact problematic label is
represented. Repeated callbacks are deduplicated; long-date observations are
capped at 16 and anomaly events at 8 per mounted chat surface. Anomalies are
flushed immediately.

**Typical level:** `info` for normal observations, `warn` for invalid
timestamps, incomplete labels, or zero-size geometry.

---

### `activity_open_completed`

**Purpose:** User-perceived time from an Activity row tap until the target
message is highlighted. One event per tap. T2 always fires: success, skeleton /
highlight timeout, or abandon. Independent of `notification_open_completed`,
which measures the same shape but for notification taps and includes cold-start
context.

**Fields:**

| Field                | Meaning                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `durationMs`         | T0 (activity row tap) → T2 (highlighted / timeout / abandoned)                       |
| `outcome`            | Why T2 fired: `highlighted` · `skeleton_timeout` · `highlight_timeout` · `abandoned` |
| `surface`            | `channel` (main chat) or `thread`                                                    |
| `chatSkeletonShown`  | Placeholder appeared at least once                                                   |
| `messageHighlighted` | Target message was visible with highlight painted                                    |
| `channelId`          | Destination channel                                                                  |
| `messageId`          | Target message, or `null` when the row had none                                      |
| `threadId`           | Thread id for thread taps, otherwise `null`                                          |

**Typical level:** `info`

---

### `notification_payload_received`

**Purpose:** A notification payload reached a delivery process. This is the
funnel start. Device/session context is attached automatically, including
`email` from the persisted session cache so headless Android and the iOS
Notification Service Extension still attribute the event.

**Fields:**

| Field                    | Meaning                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `notificationId`         | Backend notification id, or `null` when missing                                                    |
| `notificationType`       | Raw FCM `type` / `category`, or `null`                                                             |
| `category`               | Closed class: `chat` · `sos` · `reminder` · `control` · `call` · `prefetch` · `ticket` · `unknown` |
| `metadata`               | Backend metadata string, or `null`                                                                 |
| `fcmMessageId`           | Firebase message id, or `null`                                                                     |
| `deliveryContext`        | `foreground` or `background`                                                                       |
| `hasNotificationPayload` | FCM/APNS included an OS alert block                                                                |
| `fcmSentTime`            | FCM `sentTime`, or `null`                                                                          |

**When:**

- Android (any state) and iOS foreground: first line of JS
  `NotificationService.handleMessage`
- iOS background / killed with an APNS alert: the Notification Service Extension
  (`didReceive`). iOS shows the banner in that native process; JS
  `setBackgroundMessageHandler` usually never runs, so JS cannot log it.

**Typical level:** `info`

---

### `notification_displayed`

**Purpose:** This payload resulted in a visible banner — either the app drew it
or iOS APNS already showed it. Count OS-owned banners as displayed, not skipped.

**Fields:** Same identity fields as `notification_payload_received`, plus:

| Field                | Meaning                                |
| -------------------- | -------------------------------------- |
| `category`           | `chat` · `sos` · `reminder` · `ticket` |
| `presentationOwner`  | `app` or `operating_system`            |
| `trayNotificationId` | Notifee / grouping id, or `null`       |

**When:** After a successful app draw (JS), when the iOS Notification Service
Extension delivers an APNS-owned banner
(`presentationOwner: "operating_system"`), or when a standalone ticket push
includes an OS alert block.

**Typical level:** `info`

---

### `notification_display_skipped`

**Purpose:** The payload was received and intentionally not presented. Required
for the identity `received = displayed + skipped + failed`.

**Fields:** Same identity fields as `notification_payload_received`, plus:

| Field    | Meaning                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reason` | `silent_control_signal` · `prefetch_only` · `conversation_already_visible` · `native_call_pipeline` · `os_presented_ticket` · `notifications_paused` · `unsupported_or_invalid_payload` |

**When:** Control / prefetch / already-visible / call / pause / unparseable
paths.

**Typical level:** `info`

---

### `notification_display_failed`

**Purpose:** We intended to present a banner and the draw failed.

**Fields:** Same identity fields as `notification_payload_received`, plus:

| Field      | Meaning                                |
| ---------- | -------------------------------------- |
| `category` | `chat` · `sos` · `reminder` · `ticket` |
| `error`    | Why presentation failed                |

**When:** `presentNotification` / SOS display throws, or reminder draw returns
failed.

**Typical level:** `error`

---

### `notification_handler_failed`

**Purpose:** The background FCM handler threw before the delivery funnel closed
(typically an import-time failure). Leak bucket beside the main identity.

**Fields:** Same identity fields as `notification_payload_received`, plus
`error`.

**When:** `index.js` background handler catch, after `handleMessage` never
completed.

**Typical level:** `error`

---

Zero query / mutation / run names are imported from `@xyne/shared/logger`
(`Event.ZERO_QUERY_COMPLETE`, etc.) so they match the web dashboard.

### `zero_query_called`

**Purpose:** A Zero `useQuery` / `useRawQuery` subscription started (or its args
changed).

**Fields:**

| Field   | Meaning                                        |
| ------- | ---------------------------------------------- |
| `query` | Shared query name (`defineQueries` object key) |

**When:** Shared `useQuery` effect runs while the query is enabled.

**Typical level:** `info`

---

### `zero_query_complete`

**Purpose:** First time that subscription reports `details.type === 'complete'`.
`durationMs` is time from start to that complete — local cache or server. Shared
hooks send this as `latency`; the adapter maps it to `durationMs` so mobile logs
stay consistent with other app events.

**Fields:**

| Field        | Meaning                                                                           |
| ------------ | --------------------------------------------------------------------------------- |
| `query`      | Shared query name                                                                 |
| `durationMs` | Start → first complete (ms). Query VictoriaLogs with `quantile(0.50, durationMs)` |
| `skewed`     | True if the app was backgrounded or Zero was not connected                        |
| `rowCount`   | Rows in the first complete payload                                                |

**When:** Shared `useQuery` sees `complete` for the first time this cycle.

**Typical level:** `info`

**Histogram:** `zero_query_latency` is recorded only when `skewed` is false
(shared hooks skip `recordLatency` for skewed samples). Counters always fire.

---

### `zero_query_failed`

**Purpose:** The subscription reported `details.type === 'error'`.

**Fields:**

| Field   | Meaning            |
| ------- | ------------------ |
| `query` | Shared query name  |
| `error` | Zero error payload |

**When:** Shared `useQuery` sees an error detail.

**Typical level:** `error`

---

### Zero socket connection events

These events use the structured remote logger, so they share the standard
`serviceName`, `email`, `sessionId`, app, and device fields with Zero mutation
events.

#### `zero_socket_connecting`

**Purpose:** A Zero connection attempt started.

**Fields:** `reason`, `zeroReconnectionAttempts`, `currentState`, and
`previousState`.

#### `zero_socket_connected`

**Purpose:** Zero reached the connected state.

**Fields:** `latencyMs`, `totalLatencyMs`, `currentState`, `previousState`, and
`connectionAttempts`.

#### `zero_socket_disconnected`

**Purpose:** Zero left the connected state.

**Fields:** `reason`, `currentState`, `previousState`, and `sessionDurationMs`.

#### `zero_socket_auth_required`

**Purpose:** Zero requires authentication, or an auth refresh is scheduled,
exhausted, or throws.

**Fields:** Depending on the stage, `stage`, `reason`, `attempt`, `delayMs`,
`error`, `currentState`, and `previousState`.

#### `zero_socket_connection_error`

**Purpose:** Zero entered its error state.

**Fields:** `reason`, `currentState`, and `previousState`.

---

### `zero_mutation_called`

**Purpose:** `zero.mutate(...)` was invoked.

**Fields:**

| Field      | Meaning                            |
| ---------- | ---------------------------------- |
| `mutation` | Mutator name from the Zero request |

**When:** Shared `useZero` mutate proxy starts the mutation.

**Typical level:** `info`

---

### `zero_mutation_complete`

**Purpose:** The client and server mutation promises settled, and the observed
server result was not an error.

**Fields:**

| Field      | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| `mutation` | Mutator name                                         |
| `duration` | Start → both promises settled (ms). Same name as web |
| `skewed`   | True if interrupted during that window               |

**Typical level:** `info`

**Interpretation limit:** This generic event has no message identifiers, and the
current shared instrumentation does not inspect a resolved client result whose
`type` is `error`. Do not use it by itself as proof that a specific message
retry succeeded. Use `chat_pending_retry_mutation_result` for V2 retry outcomes.

---

### `zero_mutation_error`

**Purpose:** The mutation’s server result was an error, or a mutation promise
rejected.

**Fields:**

| Field      | Meaning                                |
| ---------- | -------------------------------------- |
| `mutation` | Mutator name                           |
| `error`    | Error message                          |
| `duration` | Present when the timer was available   |
| `skewed`   | Present when interruption was measured |

**Typical level:** `error`

**Interpretation limit:** A resolved client result with `type=error` is not
currently surfaced by this generic event. For per-message V2 retry outcomes, use
`chat_pending_retry_mutation_result`.

---

### `chat_pending_retry_tapped`

**Purpose:** A V2 user action requested a retry for a failed pending message.

**Fields:** `retryAttemptId`, `surface`, `messageId`, `conversationId`,
`channelId`, `sendKind`, `mutation`, `failureReason`, `zeroStateAtSend`, and
`zeroStateNow`. This event contains identifiers and state, never message
content. `retryAttemptId` links the tap to the client and server mutation
results below.

`failureReason` is one of `previous_session`, `mutator_app_error`, or
`zero_state_at_send_failed`; `unknown` means the pending entry did not match
those cases at the time of the action.

**When:** A V2 conversation message row, thread message row, or message-actions
retry is handled, immediately before calling the shared retry function.

**Typical level:** `info`

---

### `chat_pending_retry_mutation_result`

**Purpose:** Records whether a specific V2 retry reached Zero and what Zero
reported for its local (`client`) and server (`server`) mutation promises.

**Fields:** `retryAttemptId`, `surface`, `messageId`, `conversationId`,
`channelId`, `sendKind`, `mutation`, `phase`, `outcome`, `durationMs`,
`zeroMutateCalled`, and optional `errorType` and `error`. The mutation result is
observed by the mobile V2 caller; the shared retry implementation is unchanged.

`phase=dispatch` with `outcome=started` means the retry called `zero.mutate`.
`zeroMutateCalled=false` on a dispatch error means the retry handler failed
before it called `zero.mutate`; `true` means Zero was called, including when
that call threw synchronously. `phase=client` describes Zero's local apply
result. `phase=server` describes Zero's server result. A client success alone is
not server confirmation. `outcome=unknown` means the promise resolved with an
unrecognized result shape; it is deliberately not reported as success.
`durationMs` is elapsed time for the dispatch or promise result, measured from
the retry handler or `zero.mutate` call as applicable.

**Typical level:** `info` for started/success/unknown, `error` for failures.

---

### `zero_run_called`

**Purpose:** A one-shot `zero.run(...)` fetch started.

**Fields:**

| Field   | Meaning           |
| ------- | ----------------- |
| `query` | Shared query name |

**Typical level:** `info`

---

### `zero_run_complete`

**Purpose:** `zero.run(...)` resolved. Also marks the chat-open profiler when
`query` is `channelConversationsPaginatedV3`.

**Fields:**

| Field      | Meaning                                |
| ---------- | -------------------------------------- |
| `query`    | Shared query name                      |
| `duration` | Start → resolve (ms). Same name as web |
| `skewed`   | True if interrupted during that window |

**Typical level:** `info`

---

### `zero_run_error`

**Purpose:** `zero.run(...)` threw.

**Fields:**

| Field    | Meaning                                |
| -------- | -------------------------------------- |
| `query`  | Shared query name                      |
| `error`  | Error message                          |
| `skewed` | True if interrupted during that window |

**Typical level:** `error`

---

### `mmkv_handoff_last_op`

**Purpose:** On cold start, publish the last **suspend-eligible App Group** MMKV
operation from the prior session so `0xdead10cc` kills can be correlated with
the JS caller, app state, and runtime role. This is not emitted on a normal
foreground launch.

**Fields:**

| Field      | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `caller`   | Coarse tag: `notification`, `heartbeat`, `import`, or `app`       |
| `op`       | Last App Group operation: `get` · `set` · `remove` · `getAllKeys` |
| `appState` | `AppState` when the op started                                    |
| `runtime`  | `main` or `headless`                                              |
| `ageMs`    | Milliseconds since that last op                                   |
| `keyHash`  | Hash of the key (not the raw key)                                 |

**When:** Root layout initializes Crashlytics, then reads sandbox `lotus-diag`.
Publish only when the last op is suspend-eligible **and** ≤120s old. Custom keys
on this launch do **not** attach to the previous SIGKILL; join the native
`0xdead10cc` report with this event by user and time.

**Typical level:** `info`
