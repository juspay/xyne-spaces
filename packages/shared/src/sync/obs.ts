/**
 * Dev-only observability tap for the client half of the sync engine.
 *
 * The host app (dashboard/mobile) points this at the local collector via
 * `configureObs(url)` — shared can't read the app's build env, so the sink is
 * injected. Inert until configured; fire-and-forget, never throws into a caller.
 */
let sink: string | null = null;
let shadow = false;

/** Point the client obs tap at a collector `/ingest` URL (or `null` to disable). */
export function configureObs(url: string | null): void {
  sink = url;
}

/**
 * Shadow-diff mode: when on, a shared query ALSO runs the real Zero query; Zero is
 * displayed (known-good), the sync result is observed. We only compare once BOTH results
 * are `complete` and settled (debounced) — during loading they legitimately differ — and
 * log a divergence only if the data still differs then. Purely diagnostic; off normally.
 */
export function configureShadow(on: boolean): void {
  shadow = on;
}
export function isShadow(): boolean {
  return shadow;
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
