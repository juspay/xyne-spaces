/** "2:22 PM" -> "2:22 pm". The paint rows format with an upper-case meridiem. */
export function lowerMeridiem(timeLabel: string): string {
  return timeLabel.replace(
    /\s?(AM|PM)$/,
    (_match, meridiem: string) => ` ${meridiem.toLowerCase()}`,
  );
}
