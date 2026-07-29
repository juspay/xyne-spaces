/** Indian Standard Time — for display labels only (aggregation stays on DB timestamps). */
export const IST_TIMEZONE = "Asia/Kolkata";

/** Format a timestamp as YYYY-MM-DD on the IST calendar (chart axis labels). */
export function formatDayIST(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
