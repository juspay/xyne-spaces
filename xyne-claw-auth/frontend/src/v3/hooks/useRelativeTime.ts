import { useState, useEffect, useCallback } from "react";
import { formatRelativeTime } from "../../lib/time";

/**
 * Returns a relative-time string ("just now", "2m ago", …) that
 * auto-refreshes on a configurable interval without re-fetching data.
 *
 * Default refresh: every 30 seconds.
 */
export function useRelativeTime(
  iso: string | null | undefined | Date,
  refreshIntervalMs: number = 30000,
): string {
  const [relative, setRelative] = useState(() => formatRelativeTime(iso));

  const update = useCallback(() => {
    setRelative(formatRelativeTime(iso));
  }, [iso]);

  useEffect(() => {
    update();
    const id = setInterval(update, refreshIntervalMs);
    return () => clearInterval(id);
  }, [update, refreshIntervalMs]);

  return relative;
}
