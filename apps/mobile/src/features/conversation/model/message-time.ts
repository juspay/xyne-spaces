/**
 * The conversation's dates and times, in one way of writing: "9:49 am" and
 * "12 Oct", in the device's zone.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "2:22 PM" -> "2:22 pm". The paint rows format with an upper-case meridiem. */
export function lowerMeridiem(timeLabel: string): string {
  return timeLabel.replace(
    /\s?(AM|PM)$/,
    (_match, meridiem: string) => ` ${meridiem.toLowerCase()}`,
  );
}

/** "9:49 am", as `lowerMeridiem` writes a paint row's time. */
export function clockLabel(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
}

/** "12 Oct". */
export function dayMonthOf(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`;
}
