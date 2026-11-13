import type { BuiltinStepType } from './known-types.js';

/**
 * Step type identifier.
 *
 * SDK ships `BuiltinStepType` (CONDITIONAL, SWITCH, CODE, ...).
 * Host adds domain-specific step types as plain strings (e.g. 'SEND_MESSAGE').
 *
 * The `(string & {})` trick preserves IDE autocomplete for known types
 * while still accepting arbitrary host strings.
 */
export type StepType = BuiltinStepType | (string & {});
