/**
 * Dev-only observability tap for the client half of the sync engine.
 *
 * The host app (dashboard/mobile) points this at the local collector via
 * `configureObs(url)` — shared can't read the app's build env, so the sink is
 * injected. Inert until configured; fire-and-forget, never throws into a caller.
 */
let sink: string | null = null;

/** Point the client obs tap at a collector `/ingest` URL (or `null` to disable). */
export function configureObs(url: string | null): void {
  sink = url;
}

export function obsEmit(kind: string, data: Record<string, unknown>): void {
  if (!sink) return;
  try {
    void fetch(sink, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'client', kind, at: Date.now(), ...data }),
      keepalive: true,
    }).catch(() => {
      /* collector down — ignore */
    });
  } catch {
    /* never throw into the caller */
  }
}
