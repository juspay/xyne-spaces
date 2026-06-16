/**
 * Helpers for extracting env variable names from a release_env_form bag's
 * cleaned `newValue` / `oldValue` strings.
 *
 * The bag stores already-cleaned content (concatenated `+` / `-` lines with
 * the marker stripped by `DiffParser.parseEnvDiff` at write time). That
 * means the variable name appears at the start of a line, followed by
 * either `=` (shell-style .env files) or `:` (Joi schema in env.ts).
 *
 * Used by ReleaseDetailScreen to compute variable-level counts for the
 * Envs tab badge / Applications row / Dev Tickets row — the count a
 * deployer cares about ("how many env knobs do I need to set in prod").
 */

// Shell-style .env keys are UPPER_SNAKE, but config files (e.g. env.ts Joi
// schemas) can use lowercase / camelCase keys — so we match either case.
const ENV_VAR_REGEX = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*[=:]/gm;

export function extractEnvVarNames(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  const matches = Array.from(value.matchAll(ENV_VAR_REGEX));
  return new Set(matches.map(m => m[1]).filter((name): name is string => !!name));
}

/**
 * Union of var names from one env change row's EAV bag. Covers both
 * adds (newValue) and removes (oldValue) — both count as changes a
 * deployer needs to action.
 */
export function extractEnvVarsFromBag(values: Record<string, string>): Set<string> {
  const all = new Set<string>();
  extractEnvVarNames(values['newValue']).forEach(n => all.add(n));
  extractEnvVarNames(values['oldValue']).forEach(n => all.add(n));
  return all;
}
