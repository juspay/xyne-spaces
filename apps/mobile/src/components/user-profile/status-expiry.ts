import { resolveTimeSelection } from '@/src/utils/timeSelection';

/**
 * "Remove status after" options. Order and labels intentionally mirror the desktop
 * app's EXPIRY_OPTIONS so both platforms offer the same choices.
 */
export const EXPIRY_OPTIONS = [
  { value: 'dont-clear', label: "Don't clear" },
  { value: '30min', label: '30 minutes' },
  { value: '1hour', label: '1 hour' },
  { value: '4hours', label: '4 hours' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'custom', label: 'Custom' },
] as const;

export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number]['value'];

export const DEFAULT_EXPIRY_OPTION: ExpiryOption = 'today';

const EXPIRY_OPTION_VALUES: readonly string[] = EXPIRY_OPTIONS.map(option => option.value);

/**
 * Resolves an option to an absolute expiry instant, or null for "never expires".
 * `customDateTime` is only read for the 'custom' option.
 */
export function calculateExpiryTime(option: ExpiryOption, customDateTime: Date): number | null {
  return option === 'dont-clear' ? null : resolveTimeSelection(option, customDateTime);
}

/**
 * Guards the AsyncStorage boundary: recent statuses are persisted as raw JSON, so an id
 * written by a different build could otherwise reach calculateExpiryTime's exhaustive
 * switch and fall through as undefined, which the mutator would treat as "leave unchanged".
 */
export function normalizeExpiryOption(value: unknown): ExpiryOption {
  return typeof value === 'string' && EXPIRY_OPTION_VALUES.includes(value)
    ? (value as ExpiryOption)
    : DEFAULT_EXPIRY_OPTION;
}

/**
 * Inverse of calculateExpiryTime, used to seed the composer from an already-saved status.
 * Any stored instant round-trips as 'custom' at exactly that time — a stored expiry carries
 * no record of which preset produced it, and 'custom' is the only lossless representation.
 */
export function deriveExpiryOption(expiryAt: number | null | undefined): {
  option: ExpiryOption;
  customExpiryAt: Date | null;
} {
  if (expiryAt === null || expiryAt === undefined) {
    return { option: 'dont-clear', customExpiryAt: null };
  }
  return { option: 'custom', customExpiryAt: new Date(expiryAt) };
}
