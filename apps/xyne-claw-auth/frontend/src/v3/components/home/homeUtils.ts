export function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function formatDuration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

/**
 * Smart label for the runs window.
 *   - Before 11am: "Last 24h" (covers yesterday so the morning has context).
 *   - 11am or later: "Today" (calendar-day semantics).
 */
export function getRunsWindowLabel(): "Last 24h" | "Today" {
  return new Date().getHours() < 11 ? "Last 24h" : "Today";
}

/** Whether `getRunsWindowLabel()` is currently in calendar-day mode. */
export function isCalendarDayMode(): boolean {
  return new Date().getHours() >= 11;
}

/** Human time-until string for a future ISO timestamp. */
export function formatTimeUntil(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return "due now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "in <1m";
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) {
    if (remMins === 0) return `in ${hrs}h`;
    return `in ${hrs}h ${remMins}m`;
  }
  const days = Math.floor(hrs / 24);
  return days === 1 ? "in 1d" : `in ${days}d`;
}
