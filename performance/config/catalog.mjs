export const K6_IMAGE = 'grafana/k6:2.2.0';

export const ENVIRONMENTS = Object.freeze({
  sandbox: Object.freeze({ maxVus: 50, maxDurationSeconds: 60 * 60 }),
  preprod: Object.freeze({ maxVus: 500, maxDurationSeconds: 8 * 60 * 60 }),
});

export const PROFILES = new Set(['smoke', 'release', 'load', 'stress', 'soak']);
// `zero-query-transform` exercises the query-transform step of POST /api/zero/query:
// auth, rate limit, ACL, tenant scoping and AST compilation. It does not execute SQL and
// is not a Zero-sync test. `rest-messaging` exercises POST /api/conversations/:id/messages,
// which bots, the Claw MCP route and attachment uploads use rather than the chat UI.
// The names are deliberately narrow so a report is never read as broader than it is.
export const SCENARIOS = new Set(['smoke', 'zero-query-transform', 'rest-messaging']);
const SANDBOX_PROFILES = new Set(['smoke', 'release']);

// Scenarios that insert rows. Each `rest-messaging` iteration writes a message, which also
// enqueues a Vespa index job and side-effect fan-out; a soak is roughly 360,000 of them.
// No teardown exists yet (performance/README.md, "Cleanup"), so running one leaves a
// workspace that has to be cleaned by hand and skews search relevance meanwhile. Gated
// behind an explicit opt-in until a reset is implemented.
export const WRITE_SCENARIOS = new Set(['rest-messaging']);

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
    const maximum = maximumSeconds === 3600 ? '1h' : `${maximumSeconds / 3600}h`;
    throw new Error(`Duration override exceeds maximum ${maximum}`);
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
  if (environment === 'sandbox' && !SANDBOX_PROFILES.has(profile)) {
    throw new Error(`${profile} is allowed only in preprod`);
  }
  if (!SCENARIOS.has(scenario)) {
    throw new Error(`Unknown scenario: ${scenario}`);
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
