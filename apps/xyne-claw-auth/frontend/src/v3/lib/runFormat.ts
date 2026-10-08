/**
 * Formatting helpers shared by every surface that lists agent runs.
 *
 * These started life module-private inside RunHistoryTab. They live here now
 * because two surfaces (the agent Activity tab and the admin Runs page) render
 * the same rows: if each kept its own copy, a user or a trigger would slowly
 * start reading differently depending on which page you opened it from.
 */

/**
 * Human label for a run's owner — real name/email when the elevated
 * (scope=all) listing hydrated it, else a short id.
 *
 * The parameter is structural rather than a named row type so it accepts both
 * `AgentRunListItem` (paged listing) and `AgentRun` (full row) without either
 * module importing the other's shape.
 */
export function runOwnerLabel(run: { userId: string; userName?: string | null; userEmail?: string | null }): string {
  return run.userName || run.userEmail || `user ${run.userId.slice(0, 8)}`;
}

/**
 * `source` is typed `string`, not the frontend's triggerSource union, on
 * purpose: the Prisma schema documents values the union omits (e.g. "slack"),
 * and narrowing here would make a real row fail to compile. The chain already
 * falls through to "API" for anything unrecognised.
 */
export function triggerLabel(source: string): string {
  return source === "spaces"
    ? "Spaces"
    : source === "scheduled"
      ? "Scheduled"
      : source === "chat"
        ? "Chat"
        : source === "automation"
          ? "Automation"
          : "API";
}

/**
 * Display form of a session id: the first segment of the UUID.
 *
 * Short enough to sit in a row without crowding the task text, and long enough
 * to be unambiguous in practice (8 hex chars). The paged listing accepts a
 * sessionId PREFIX of 4+ chars, so whatever the user copies off the row is
 * directly pasteable into the search box and will resolve.
 */
export function shortSessionId(sessionId: string): string {
  const head = sessionId.split("-")[0] ?? sessionId;
  return head.slice(0, 8);
}

/**
 * Does this query read as someone hunting a session id rather than words?
 *
 * Used to decide whether the search box asks the SERVER (an id names one run,
 * which may be on any page or outside the date window) or filters the loaded
 * rows client-side. Hex-and-dashes only, 4+ chars — "refund" and "8 failed
 * runs" stay on the client path, "479eb839" and a full UUID go to the server.
 */
export function looksLikeSessionId(query: string): boolean {
  const q = query.trim();
  return q.length >= 4 && /^[0-9a-fA-F-]+$/.test(q) && /[0-9a-fA-F]/.test(q);
}

export type RunRangePreset = "7d" | "30d" | "90d" | "365d" | "custom";

export const RUN_RANGE_PRESETS: Array<{ id: RunRangePreset; label: string; days: number }> = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
  { id: "365d", label: "1y", days: 365 },
];

/** Format a Date as the YYYY-MM-DD an `<input type="date">` expects, in the
 *  viewer's LOCAL calendar — `toISOString().slice(0,10)` would show yesterday
 *  for anyone west of UTC in the evening. */
export function dateInputValue(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Widest custom window the two date inputs may span, in whole calendar days.
 *
 * 365 and not 366, even though the server's cap is 366 days: `dateInputToIso`
 * snaps the `to` side to 23:59:59.999, so two dates N days apart become a span
 * of N days PLUS almost a full day. At N=366 that is over the cap and every
 * refetch 400s; at N=365 it lands just under it.
 */
export const RUN_CUSTOM_RANGE_MAX_DAYS = 365;

/**
 * Shift a `<input type="date">` value by `days` and return it in the same
 * format, staying in the viewer's LOCAL calendar — day arithmetic via the
 * Date constructor, not `+ n * 86400000`, so a DST transition inside the range
 * doesn't slide the result onto the neighbouring day.
 */
export function shiftDateInputValue(v: string, days: number): string | null {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d + days);
  return Number.isNaN(dt.getTime()) ? null : dateInputValue(dt);
}

/**
 * Parse an `<input type="date">` value (YYYY-MM-DD) as LOCAL time and return an
 * ISO string for the API. `end=true` snaps to the last millisecond of the day
 * so picking a single date is inclusive of that whole day.
 *
 * The local-time construction matters: `new Date("2026-09-03")` is parsed as
 * UTC midnight, which shifts the window by up to a day for anyone east or west
 * of UTC — the user picks "the 3rd" and gets the 2nd's runs.
 */
export function dateInputToIso(v: string, end = false): string | null {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  const t = dt.getTime();
  return Number.isNaN(t) ? null : dt.toISOString();
}

/**
 * Resolve a preset (or a custom pair) to the `{ from, to }` ISO window the
 * /runs/paged endpoint takes. A custom side that is blank or unparseable falls
 * back to the 30-day default rather than sending garbage the server would 400
 * — the date inputs are partially filled for as long as the user is typing.
 */
export function rangeToIso(preset: RunRangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (preset === "custom") {
    const from = dateInputToIso(customFrom) ?? new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const to = dateInputToIso(customTo, true) ?? now.toISOString();
    return { from, to };
  }
  const days = RUN_RANGE_PRESETS.find((p) => p.id === preset)?.days ?? 30;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
}
