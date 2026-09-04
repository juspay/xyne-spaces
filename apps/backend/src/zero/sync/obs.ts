/**
 * Dev-only observability tap for the shared-base sync engine.
 *
 * Emits REAL, structured events from the running backend to a local collector
 * (scratchpad/obs/collector.mjs) so the sync dashboard can visualize live flow:
 * client subscriptions, the backend tap → zero-cache lifecycle, poke ingress, and
 * fan-out to clients.
 *
 * GATED: entirely inert unless `SYNC_OBS_URL` is set (e.g. http://localhost:8899/ingest).
 * Fire-and-forget — never blocks a request path and never throws into a caller.
 */
const OBS_URL = process.env['SYNC_OBS_URL'];

export const OBS_ENABLED = Boolean(OBS_URL);

export function obsEmit(kind: string, data: Record<string, unknown>): void {
  if (!OBS_URL) return;
  try {
    void fetch(OBS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'backend', kind, at: Date.now(), ...data }),
    }).catch(() => {
      /* collector down — ignore */
    });
  } catch {
    /* never throw into the caller */
  }
}
