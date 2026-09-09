/**
 * PostHog Event Taxonomy — PLANNED
 *
 * This PR intentionally ships **autocapture only** for interactions:
 *  - Every click (buttons included) is captured automatically by PostHog.
 *    Button purpose/metadata rides along via `data-ph-capture-attribute-*`
 *    (see `Button` `trackId` / `trackProps`).
 *  - Keyboard-driven actions are the one thing autocapture cannot see, so the
 *    only explicit `capture()` kept in this PR is `shortcut_triggered`
 *    (see `ShortcutsProvider`).
 *
 * All other named/custom domain events were removed here and will be
 * reintroduced in follow-up PRs, one coherent namespace at a time, so each
 * event set can be designed, reviewed and dashboarded on its own.
 *
 * ----------------------------------------------------------------------------
 * PLANNED EVENT NAMESPACES (add in later PRs — do NOT re-scatter ad-hoc):
 *
 *  auth events      — Login, Logout, session refresh, auth errors
 *  message events   — message_send (+ trigger: keyboard|button), message_send_failed,
 *                     edit, thread_reply, direct_message, schedule_message
 *  conversation     — conversation_opened, channel/dm/group_dm dimensions
 *  ticket events    — ticket_created, status_changed, assigned, workflow_metrics
 *  call events      — start_call, end_call (+ duration, callType, initiator)
 *  search events    — search_performed (+ search type: messages|channels|users|files)
 *  navigation       — Navigation (item), app_open (DAU/WAU/MAU), app_refresh
 *  file events      — file_uploaded (+ count, size, types), download_attachment
 *  ai/agent events  — ai_query_submitted, ai_generation_stopped, agent_switched
 *  reaction events  — reaction_added, reaction_removed
 *  ws/health        — ws_connection_closed, frontend_error
 *
 * When implementing a namespace, define its names/properties here as exported
 * consts and capture via `posthogService.capture(...)` at the domain site.
 * ----------------------------------------------------------------------------
 */

export {};
