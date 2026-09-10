export const K6_IMAGE = 'grafana/k6:2.2.0';

export const ENVIRONMENTS = Object.freeze({
  sandbox: Object.freeze({ maxVus: 50, maxDurationSeconds: 60 * 60 }),
  preprod: Object.freeze({ maxVus: 500, maxDurationSeconds: 8 * 60 * 60 }),
});

export const PROFILES = new Set(['smoke', 'release', 'load', 'stress', 'soak']);
export const SCENARIOS = new Set(['smoke', 'messaging']);

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
  const scenario = input.scenario ?? (profile === 'smoke' ? 'smoke' : 'messaging');
  const environmentConfig = ENVIRONMENTS[environment];

  if (!environmentConfig) {
    throw new Error(`Environment ${environment} is not allowed; use sandbox or preprod`);
  }
  if (!PROFILES.has(profile)) {
    throw new Error(`Unknown profile: ${profile}`);
  }
  if (!SCENARIOS.has(scenario)) {
    throw new Error(`Unknown scenario: ${scenario}`);
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
