import cronstrue from "cronstrue";

/**
 * Convert a 5-field cron expression into a plain-English sentence.
 *
 * Returns null for empty / invalid input so callers can fall back to the
 * raw expression without showing an error to the user.
 */
export function humanizeCron(expr: string | null | undefined): string | null {
  if (!expr || !expr.trim()) return null;

  try {
    const desc = cronstrue.toString(expr.trim(), {
      throwExceptionOnParseError: true,
      use24HourTimeFormat: false,
    });
    return desc || null;
  } catch {
    return null;
  }
}
