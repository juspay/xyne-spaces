import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getDigitalTwinStatus } from "../../lib/api";
import type { DigitalTwinStatus } from "../../lib/api";

interface UseDigitalTwinReturn {
  status: DigitalTwinStatus | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /**
   * True when the backfill has been in progress for at least 3 consecutive
   * polls (~30 s) with no cursor movement on any non-complete source.
   * Consumers can surface a "Stalled" warning in the UI.
   */
  backfillStalled: boolean;
}

/**
 * Stringify just the cursor values for non-complete backfill sources so we
 * can detect whether they've moved between polls.
 */
function cursorSnapshot(status: DigitalTwinStatus | null): string {
  if (!status?.backfillState) return "";
  return Object.entries(status.backfillState)
    .filter(([, entry]) => !entry.complete)
    .map(([key, entry]) => `${key}:${entry.cursor ?? ""}`)
    .sort()
    .join("|");
}

export function useDigitalTwin(userId: string): UseDigitalTwinReturn {
  const [status, setStatus] = useState<DigitalTwinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stall detection — count consecutive polls where the cursor snapshot
  // hasn't changed. Ref so it doesn't re-trigger effects.
  const stalledPollsRef   = useRef(0);
  const lastSnapshotRef   = useRef("");
  // Only start counting stalled polls AFTER a cursor has moved at least once.
  // This prevents false-positives when the backend is still queueing the job
  // and hasn't made any progress yet.
  const hasSeenMovementRef = useRef(false);
  const [backfillStalled, setBackfillStalled] = useState(false);

  /**
   * Internal fetcher. `silent=true` suppresses the loading spinner so background
   * polling doesn't replace the banner with the "Loading…" skeleton every 10s.
   * Errors are still surfaced either way.
   */
  const fetchStatus = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      try {
        const s = await getDigitalTwinStatus(userId);
        setStatus(s);
        setError(null);

        // Stall detection: compare the new cursor snapshot to the previous one.
        const snap = cursorSnapshot(s);
        const hasNonComplete = s.backfillState
          ? Object.values(s.backfillState).some((e) => !e.complete)
          : false;

        if (!hasNonComplete) {
          // Backfill finished — reset everything.
          stalledPollsRef.current    = 0;
          lastSnapshotRef.current    = "";
          hasSeenMovementRef.current = false;
          setBackfillStalled(false);
        } else if (snap !== lastSnapshotRef.current) {
          // Snapshot changed. Only count this as genuine cursor movement when
          // we already had a previous non-empty snapshot. The very first poll
          // always transitions "" → "source:cursor" which is NOT real movement
          // — it is just the initial read. Treating it as movement would set
          // hasSeenMovementRef=true immediately, causing the stall counter to
          // start on the very next poll even if the cursor never advanced.
          stalledPollsRef.current = 0;
          if (lastSnapshotRef.current !== "") {
            hasSeenMovementRef.current = true;
          }
          lastSnapshotRef.current = snap;
          setBackfillStalled(false);
        } else if (hasSeenMovementRef.current) {
          // Cursor hasn't moved since the last poll AND it has moved before
          // (i.e. the backfill was actively progressing and then froze).
          // Only now do we start counting toward a stall.
          stalledPollsRef.current += 1;
          if (stalledPollsRef.current >= 3) {
            setBackfillStalled(true);
          }
        }
        // If hasSeenMovementRef is false, the backfill is still in queue /
        // hasn't started yet — do nothing; don't count toward a stall.
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load Digital Twin status");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [userId],
  );

  // User-facing reload (e.g. after enable/disable/upload) — shows spinner
  // and resets stall counters so the UI reacts immediately.
  const reload = useCallback(() => {
    stalledPollsRef.current    = 0;
    lastSnapshotRef.current    = "";
    hasSeenMovementRef.current = false;
    setBackfillStalled(false);
    void fetchStatus(false);
  }, [fetchStatus]);

  useEffect(() => {
    void fetchStatus(false);
  }, [fetchStatus]);

  const backfillRunning = useMemo(() => {
    if (!status?.backfillState) return false;
    return Object.values(status.backfillState).some((s) => !s.complete);
  }, [status]);

  useEffect(() => {
    if (!backfillRunning) return;
    // Background poll — silent, so the banner keeps rendering Building state
    // (progress bars updating in place) instead of flashing to skeleton.
    const id = setInterval(() => void fetchStatus(true), 10_000);
    return () => clearInterval(id);
  }, [backfillRunning, fetchStatus]);

  return { status, loading, error, reload, backfillStalled };
}
