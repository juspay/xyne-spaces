import type { BuiltinTriggerType } from './known-types.js';

/**
 * Trigger type identifier.
 *
 * SDK ships `BuiltinTriggerType` (EVENT, WEBHOOK, CRON, MANUAL).
 * Host adds domain-specific triggers as plain strings (e.g. 'TICKET_CREATED').
 *
 * The `(string & {})` trick preserves IDE autocomplete for known types
 * while still accepting arbitrary host strings.
 */
export type TriggerType = BuiltinTriggerType | (string & {});
