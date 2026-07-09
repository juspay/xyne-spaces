import rruleLib from 'rrule';

const { RRule } = rruleLib;

/**
 * If the RRULE contains UNTIL or COUNT, derive the effective end date so that
 * series.endsOn can be populated even when the client did not send endsOn.
 */
export function deriveEndsOnFromRRule(recurrenceRule: string, startsOn: Date): Date | null {
  try {
    const options = RRule.parseString(recurrenceRule);
    options.dtstart = startsOn;
    const rule = new RRule(options);

    if (options.until) {
      return new Date(options.until);
    }

    if (options.count) {
      const all = rule.all();
      return all.length > 0 ? all[all.length - 1]! : null;
    }

    return null;
  } catch {
    return null;
  }
}
