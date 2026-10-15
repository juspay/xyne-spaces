/**
 * Chat v3 vs v2 switch.
 *
 * Owner: Vinit Khandal
 * Expires: 2026-12-31
 *
 * A regular registry flag (`chat.v3`): CAC decides who sees the switch on
 * Settings → Beta, and the user's choice is stored by the flag runtime. Default
 * OFF for the safe rollout. See `src/flags/registry.ts`.
 *
 * The value is pinned for the process and re-read when the Beta screen applies
 * a change, so call `isChatV3Enabled()` once per screen mount (store in a ref).
 * Never inside `v3/` itself — call sites are the three chat-screen entry files
 * (design §3.2) plus `TicketDetailsScreen` (Phase 9a).
 */
import { isFlagOn } from '@/src/flags';

export const isChatV3Enabled = (): boolean => isFlagOn('chat.v3');
