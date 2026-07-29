/**
 * Build a cron pattern from user-provided scheduling options.
 *
 * @param scheduledTime  "HH:mm" 24h string (in UTC)
 * @param daysOfWeek     "0,1,2,3,4,5,6" string where 0=Sunday, 1=Monday ... 6=Saturday
 *                       "0,1,2,3,4,5,6" = every day
 *                       "1,2,3,4,5" = weekdays (Mon-Fri)
 * @returns cron pattern "MM HH * * D,D,D"
 */
export function buildCronPattern(
  scheduledTime: string,
  daysOfWeek: string,
): string {
  const [hh, mm] = scheduledTime.split(':');

  console.log(`[CRON-UTILS] Building cron from UTC time ${scheduledTime}, days=${daysOfWeek}`);

  const pattern = `${mm} ${hh} * * ${daysOfWeek}`;
  console.log(`[CRON-UTILS] Generated cron: ${pattern}`);
  return pattern;
}
