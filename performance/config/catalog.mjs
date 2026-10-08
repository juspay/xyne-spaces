import { PROFILE_NAMES } from '../k6/profiles.mjs';

export const K6_IMAGE = 'grafana/k6:2.2.0';

// The two targets are not peers, and the asymmetry is deliberate.
//
// `sandbox` is a genuinely separate deployment: its own host, its own database, its own
// capacity. It is therefore the only place real load belongs, and carries the higher cap.
//
// `preprod` is not a deployment at all. The desktop app's Beta toggle sends
// `x-route-env: playground` to the SAME host, and the backend passes that to Superposition
// as a config dimension (cacConfigController.ts:14) — so it resolves a different feature
// set against the same backend, database, Vespa and Redis that serve customers. Load there
// is load on production. It is kept as a UAT verification target: the smoke check and the
// read-only release check, capped at the release profile's 25-VU peak, and nothing heavier.
export const ENVIRONMENTS = Object.freeze({
  sandbox: Object.freeze({ maxVus: 300, maxDurationSeconds: 8 * 60 * 60 }),
  preprod: Object.freeze({ maxVus: 25, maxDurationSeconds: 10 * 60 }),
});

export const PROFILES = new Set(PROFILE_NAMES);

// `zero-query-transform` exercises the query-transform step of POST /api/zero/query:
// auth, rate limit, ACL, tenant scoping and AST compilation. It does not execute SQL and
// is not a Zero-sync test. `rest-messaging` exercises POST /api/conversations/:id/messages,
// which bots, the Claw MCP route and attachment uploads use rather than the chat UI.
// `search` exercises GET /api/vespaSearch/ — ACL-filtered Vespa retrieval, read-only.
// `attachments` exercises GET /api/attachments/:id/{download,thumbnail} — object-storage
// retrieval, read-only, but it moves real bytes so it has a bandwidth cost.
// The names are deliberately narrow so a report is never read as broader than it is.
export const SCENARIOS = new Set([
  'smoke',
  'zero-query-transform',
  'search',
  'attachments',
  'zero-push',
  'rest-messaging',
]);
// Pre-production runs on production infrastructure, so only the single-request smoke check
// and the short read-only release check are permitted there. Everything heavier — load,
// stress, spike, soak — belongs on sandbox.
const PREPROD_PROFILES = new Set(['smoke', 'release']);

// Scenarios that insert rows. Each `rest-messaging` iteration writes a message, which also
// enqueues a Vespa index job and side-effect fan-out; a soak is roughly 360,000 of them.
// No teardown exists yet (performance/README.md, "Cleanup"), so running one leaves a
// workspace that has to be cleaned by hand and skews search relevance meanwhile. Gated
// behind an explicit opt-in until a reset is implemented.
export const WRITE_SCENARIOS = new Set(['zero-push', 'rest-messaging']);

const DURATION_PATTERN = /^(\d+)(s|m|h)$/;

function parseOptionalPositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} override must be a positive integer`);
  }
  return parsed;
}

function parseOptionalDuration(value, maximumSeconds) {
  if (value === undefined || value === null || value === '') return undefined;

  const match = DURATION_PATTERN.exec(String(value));
  if (!match || Number(match[1]) <= 0) {
    throw new Error('Duration override must be a positive integer followed by s, m, or h');
  }

  const multipliers = { s: 1, m: 60, h: 3600 };
  const seconds = Number(match[1]) * multipliers[match[2]];
  if (seconds > maximumSeconds) {
    throw new Error(`Duration override exceeds maximum ${maximumSeconds}s`);
  }

  return String(value);
}

export function resolveRunConfig(input = {}) {
  const environment = input.environment ?? 'sandbox';
  const profile = input.profile ?? 'smoke';
  const scenario = input.scenario ?? (profile === 'smoke' ? 'smoke' : 'zero-query-transform');
  const environmentConfig = ENVIRONMENTS[environment];

  if (!environmentConfig) {
    throw new Error(`Environment ${environment} is not allowed; use sandbox or preprod`);
  }
  if (!PROFILES.has(profile)) {
    throw new Error(`Unknown profile: ${profile}`);
  }
  if (environment === 'preprod' && !PREPROD_PROFILES.has(profile)) {
    throw new Error(
      `${profile} is not allowed on preprod: it shares production's backend, database and `
      + 'capacity, so anything beyond the smoke and release checks is a production load '
      + 'test. Run it on sandbox instead.',
    );
  }
  if (!SCENARIOS.has(scenario)) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
  if (WRITE_SCENARIOS.has(scenario) && environment === 'preprod') {
    throw new Error(
      `${scenario} writes rows, and preprod writes to production data — the same database `
      + 'customers use. There is no opt-in for that. Run write scenarios on sandbox.',
    );
  }
  if (WRITE_SCENARIOS.has(scenario) && input.allowWriteScenarios !== true) {
    throw new Error(
      `${scenario} writes rows and no reset is implemented for the messages it creates. `
      + 'Set PERF_ALLOW_WRITE_SCENARIOS=true to run it anyway, and clean the workspace '
      + 'afterwards by the PERF-<run-id> marker.',
    );
  }

  const vusOverride = parseOptionalPositiveInteger(input.vusOverride, 'VUs');
  if (vusOverride && vusOverride > environmentConfig.maxVus) {
    throw new Error(`VUs override exceeds maximum ${environmentConfig.maxVus} for ${environment}`);
  }

  const durationOverride = parseOptionalDuration(
    input.durationOverride,
    environmentConfig.maxDurationSeconds,
  );

  return { environment, profile, scenario, vusOverride, durationOverride };
}
