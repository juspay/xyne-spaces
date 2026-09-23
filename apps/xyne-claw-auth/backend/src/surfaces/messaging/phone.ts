/**
 * Turning a number a human typed into the digits a messenger uses.
 *
 * Messengers address people by full international digits with no punctuation
 * and no leading "+". People type neither: they write "98765 43210", or
 * "09876543210", or paste "+91 98765-43210". Getting this wrong is silent —
 * the identity row is keyed on the wrong digits, the sender never matches, and
 * the person is told to register a number they already registered.
 */

/** Assumed when the typed number carries no country code of its own. */
const DEFAULT_COUNTRY_CODE = "91";
/** A national number without its country code, e.g. Indian mobiles. */
const NATIONAL_LENGTH = 10;

/**
 * Full international digits, or null when the input is not a phone number.
 *
 * A leading "+" is taken at its word — that person told us the country. Without
 * one we drop a domestic trunk "0" and, if what remains is a bare national
 * number, assume DEFAULT_COUNTRY_CODE. Anything already longer is left alone,
 * since it must already carry a country code.
 */
export function normalizePhoneDigits(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const explicit = trimmed.startsWith("+");
  const digits = trimmed.replace(/[\s()+\-.]/g, "");
  if (!/^\d{6,20}$/.test(digits)) return null;
  if (explicit) return digits;

  const national = digits.replace(/^0+/, "");
  if (national.length === NATIONAL_LENGTH) return `${DEFAULT_COUNTRY_CODE}${national}`;
  return digits;
}
