/**
 * Per-query serve mode for the sync engine — the runtime rollout control (CAC overlay).
 *
 * The COMPILED registries remain the security boundary: a query name never in the
 * CI-audited allowlists is refused regardless of what any config says (modes can only
 * SUBTRACT from the audited set, never add). Within that set, each query is in one of:
 *   - 'serve'  — engine serves it; the client displays the sync result.
 *   - 'shadow' — engine serves it; the client subscribes BOTH and displays native Zero
 *                (observation state; the default for audited-but-not-yet-promoted queries).
 *   - 'off'    — the gateway refuses the subscribe; the client stays fully native.
 *
 * Sources, in precedence order, ALL fail-static (a broken source never mass-disables —
 * a fleet-wide fallback to native Zero is itself a load incident):
 *   1. remote config (CAC): SYNC_ENGINE_MODES_URL polled every SYNC_ENGINE_MODES_POLL_MS;
 *      an unreachable/invalid response keeps the last good value forever.
 *   2. ship-with env default: SYNC_ENGINE_QUERY_MODES (JSON, same shape).
 *   3. built-in: { default: 'shadow', queries: {} }.
 *
 * The active snapshot rides the `sync:ready` payload, so clients learn modes on every
 * (re)connect with zero extra round-trips; mid-session changes apply to NEW subscribes
 * (drain semantics — deliberate, see the rollout design: no revoke stampedes).
 *
 * Init is async-lazy (config/env + logger validate env at import, which env-free unit
 * tests must not touch): until the env config lands — milliseconds, once, at boot —
 * `modeFor` serves the built-in shadow default.
 */

export type QueryMode = 'serve' | 'shadow' | 'off';

export interface QueryModesConfig {
  default: QueryMode;
  queries: Record<string, QueryMode>;
}

const BUILT_IN: QueryModesConfig = { default: 'shadow', queries: {} };
const MODES: ReadonlySet<string> = new Set(['serve', 'shadow', 'off']);

function log(level: 'warn' | 'error', msg: string, fields: Record<string, unknown>): void {
  void import('@/utils/logger')
    .then(({ logger }) => logger[level](msg, fields))
    .catch(() => {
      // eslint-disable-next-line no-console
      console.error(msg, fields);
    });
}

function sanitize(raw: unknown, source: string): QueryModesConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { default?: unknown; queries?: unknown };
  const def = typeof r.default === 'string' && MODES.has(r.default) ? (r.default as QueryMode) : 'shadow';
  const queries: Record<string, QueryMode> = {};
  if (r.queries && typeof r.queries === 'object') {
    for (const [name, mode] of Object.entries(r.queries as Record<string, unknown>)) {
      if (typeof mode === 'string' && MODES.has(mode)) queries[name] = mode as QueryMode;
      else log('warn', 'sync_query_modes_invalid_entry', { source, name, mode });
    }
  }
  return { default: def, queries };
}

let active: QueryModesConfig = BUILT_IN;
let initialized = false;
let pinnedForTests = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;

/** Test seam: pin a config (null = reset to uninitialized built-in). Stops the poller. */
export function setQueryModesForTests(cfg: QueryModesConfig | null): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
  active = cfg ?? BUILT_IN;
  initialized = cfg !== null;
  pinnedForTests = cfg !== null;
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  void import('@/config/env')
    .then(({ config }) => {
      if (pinnedForTests) return;
      const modesCfg = (config as { syncEngineModes?: { json?: string; url?: string; pollMs?: number } })
        .syncEngineModes;
      if (modesCfg?.json) {
        try {
          const parsed = sanitize(JSON.parse(modesCfg.json), 'env');
          if (parsed) active = parsed;
        } catch (e) {
          log('error', 'sync_query_modes_env_invalid', { error: e instanceof Error ? e.message : String(e) });
        }
      }
      const url = modesCfg?.url;
      if (url) {
        const poll = async (): Promise<void> => {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const parsed = sanitize(await res.json(), 'remote');
            if (parsed && !pinnedForTests) active = parsed; // last-good swap
          } catch (e) {
            // FAIL-STATIC: keep serving the last good config.
            log('warn', 'sync_query_modes_poll_failed', { error: e instanceof Error ? e.message : String(e) });
          }
        };
        void poll();
        pollTimer = setInterval(() => void poll(), modesCfg?.pollMs ?? 30_000);
        (pollTimer as { unref?: () => void }).unref?.();
      }
    })
    .catch(() => {
      /* env unavailable (unit tests) — built-in default stands */
    });
}

/** The mode for an (already registry-audited) query. Synchronous — sits on the subscribe path. */
export function modeFor(queryName: string): QueryMode {
  ensureInit();
  return active.queries[queryName] ?? active.default;
}

/** The active config, for the `sync:ready` payload. */
export function modesSnapshot(): QueryModesConfig {
  ensureInit();
  return { default: active.default, queries: { ...active.queries } };
}
