/**
 * Generic poller for server-side background jobs (BullMQ on the backend).
 *
 * Supports MULTIPLE concurrent jobs of the same kind (e.g. two folders'
 * eval runs at once): start → persist the {jobId,...meta} handles in
 * localStorage (a refresh re-attaches to still-running jobs) → poll each
 * job's status every interval → on terminal state fire onDone and drop it.
 *
 * `active` (first job) is kept for single-job consumers; `actives` is the
 * full list for multi-job UIs (stacked banners, per-folder gating).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface JobSnapshot<TProgress> {
  jobId: string;
  state: string; // waiting | active | completed | failed | delayed | unknown
  progress: TProgress | null;
  failedReason?: string;
}

export interface BackgroundJobOptions<TMeta, TProgress> {
  storageKey: string;
  fetchStatus: (jobId: string) => Promise<JobSnapshot<TProgress>>;
  cancelJob: (jobId: string) => Promise<void>;
  isDone: (s: JobSnapshot<TProgress>) => boolean;
  onTick?: (meta: TMeta, s: JobSnapshot<TProgress>) => void | Promise<void>;
  onDone: (meta: TMeta, s: JobSnapshot<TProgress>) => void | Promise<void>;
  onRestore?: (meta: TMeta) => void;
  onFinish?: () => void;
  intervalMs?: number;
}

export function useBackgroundJob<TMeta extends { jobId: string }, TProgress>(
  options: BackgroundJobOptions<TMeta, TProgress>,
) {
  type Active = TMeta & { state: string; progress: TProgress | null };
  const [actives, setActives] = useState<Active[]>([]);
  // Callbacks live in a ref so the poll effect always calls the latest render's
  // closures without re-arming on every render.
  const optsRef = useRef(options);
  optsRef.current = options;
  const activesRef = useRef(actives);
  activesRef.current = actives;

  const persist = useCallback((list: Array<{ jobId: string }>) => {
    try {
      if (list.length === 0) localStorage.removeItem(optsRef.current.storageKey);
      else localStorage.setItem(optsRef.current.storageKey, JSON.stringify(list));
    } catch {
      /* private mode etc. */
    }
  }, []);

  const start = useCallback(
    (meta: TMeta) => {
      setActives((cur) => {
        const next = [...cur.filter((a) => a.jobId !== meta.jobId), { ...meta, state: "waiting", progress: null } as Active];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Restore running jobs after a page refresh (job state lives in Redis; we
  // just re-attach the persisted handles and resume polling). Accepts the old
  // single-object handle format too.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(optsRef.current.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as TMeta | TMeta[];
      const metas = (Array.isArray(parsed) ? parsed : [parsed]).filter((m) => m?.jobId);
      if (metas.length === 0) return;
      for (const m of metas) optsRef.current.onRestore?.(m);
      setActives(metas.map((m) => ({ ...m, state: "waiting", progress: null }) as Active));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Jobs the user has asked to cancel — instant UI feedback while the worker
   *  winds the job down (it aborts the in-flight work within a couple seconds). */
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());

  /** Cancel one job (by id) or all active jobs (no id). */
  const cancel = useCallback(async (jobId?: string) => {
    const targets = jobId ? activesRef.current.filter((a) => a.jobId === jobId) : activesRef.current;
    setCancelling((cur) => {
      const n = new Set(cur);
      for (const t of targets) n.add(t.jobId);
      return n;
    });
    for (const t of targets) {
      try {
        await optsRef.current.cancelJob(t.jobId);
      } catch {
        /* worker still picks up the cancel flag */
      }
    }
  }, []);

  // One interval polls every active job; re-arms when the job set changes.
  const jobsKey = actives.map((a) => a.jobId).join(",");
  useEffect(() => {
    if (activesRef.current.length === 0) return;
    let stopped = false;
    const misses = new Map<string, number>();
    const remove = (jobId: string) => {
      setActives((cur) => {
        const next = cur.filter((a) => a.jobId !== jobId);
        persist(next);
        if (next.length === 0) optsRef.current.onFinish?.();
        return next;
      });
    };
    const tick = async () => {
      for (const job of [...activesRef.current]) {
        if (stopped) return;
        try {
          const s = await optsRef.current.fetchStatus(job.jobId);
          if (stopped) return;
          misses.set(job.jobId, 0);
          setActives((cur) => cur.map((a) => (a.jobId === s.jobId ? { ...a, state: s.state, progress: s.progress } : a)));
          await optsRef.current.onTick?.(job, s);
          if (stopped) return;
          if (s.state === "completed" || s.state === "failed" || optsRef.current.isDone(s)) {
            await optsRef.current.onDone(job, s);
            remove(job.jobId);
          }
        } catch {
          // Job gone (reaped) or transient error — give up after a few misses.
          const m = (misses.get(job.jobId) ?? 0) + 1;
          misses.set(job.jobId, m);
          if (m > 4) remove(job.jobId);
        }
      }
    };
    void tick();
    const iv = setInterval(tick, optsRef.current.intervalMs ?? 2000);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsKey, persist]);

  return { actives, active: actives[0] ?? null, start, cancel, cancelling };
}
