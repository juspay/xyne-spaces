/**
 * Policy for agent-proposed MCP servers.
 *
 * Two rules, both enforced here rather than left to the caller, because both
 * failure modes are silent and severe:
 *
 * 1. HTTP ONLY. `McpServer.transport` defaults to "stdio" in the schema, and a
 *    stdio server is a command line — `command` + `args` + `env` executed on the
 *    runner. An agent that can create one has arbitrary code execution, from a
 *    chat message. Nothing an agent proposes may be stdio; the transport is
 *    forced to "http" and any command-shaped field is a hard rejection, not a
 *    silently dropped key.
 *
 * 2. NO CREDENTIALS. An agent must never carry a token. Anything it passes ends
 *    up in the model's context, the run transcript, the ledger and the logs, and
 *    stays there after the token is rotated. The agent names WHICH inputs the
 *    user should fill; the user fills them in the dashboard and the values go
 *    browser → claw-auth. So a proposal carrying a value that looks like a
 *    secret is rejected outright rather than scrubbed — scrubbing teaches the
 *    model the field is accepted.
 *
 * The tool that eventually emits these proposals is a thin wrapper over this
 * function; keeping the policy here means the rules can't drift per call site.
 */

export interface McpProposal {
  name: string;
  url: string;
  description?: string;
  /** Header NAMES the user will be asked to fill — never values. */
  headerNames?: string[];
}

export interface McpProposalResult {
  ok: boolean;
  /** Present when ok — safe to persist, transport pinned to http. */
  config?: { name: string; url: string; transport: 'http'; description?: string; headerNames: string[] };
  /** Present when !ok — phrased for the model, so it can correct itself. */
  error?: string;
}

/** Keys that carry a secret in every MCP config shape we have seen. */
const CREDENTIAL_KEYS = new Set([
  'token', 'accesstoken', 'access_token', 'apikey', 'api_key', 'key',
  'secret', 'clientsecret', 'client_secret', 'password', 'passwd', 'pat',
  'authorization', 'auth', 'bearer', 'credential', 'credentials',
  'privatekey', 'private_key', 'sessionid', 'session_id', 'cookie',
]);

/** Command-shaped keys — the stdio transport's surface. */
const STDIO_KEYS = ['command', 'args', 'env', 'cwd', 'entrypoint', 'exec', 'shell'];

function looksLikeSecretValue(value: string): boolean {
  const v = value.trim();
  if (v.length < 12) return false;
  // Provider-prefixed tokens (ghp_, sk-, glpat-, xoxb-, …) and long opaque blobs.
  if (/^(gh[pousr]_|sk-|glpat-|xox[baprs]-|Bearer\s|eyJ[A-Za-z0-9_-]{10,})/i.test(v)) return true;
  return /^[A-Za-z0-9_\-.]{32,}$/.test(v) && /[0-9]/.test(v) && /[A-Za-z]/.test(v);
}

/**
 * Validate an agent-proposed MCP server against the two rules above.
 * Returns a normalized config, or an error written for the model to act on.
 */
export function validateMcpProposal(raw: unknown): McpProposalResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Proposal must be an object with name and url.' };
  }
  const input = raw as Record<string, unknown>;

  // ── Rule 1: HTTP only ──────────────────────────────────────────────────────
  const stdioKey = STDIO_KEYS.find((k) => input[k] !== undefined);
  if (stdioKey) {
    return {
      ok: false,
      error:
        `Rejected: "${stdioKey}" describes a stdio (command-executing) server. ` +
        `Agents may only propose HTTP MCP servers — pass a url instead.`,
    };
  }
  if (input['transport'] !== undefined && input['transport'] !== 'http') {
    return {
      ok: false,
      error: `Rejected: transport "${String(input['transport'])}" is not allowed. Only "http" may be proposed.`,
    };
  }

  const name = typeof input['name'] === 'string' ? input['name'].trim() : '';
  const url = typeof input['url'] === 'string' ? input['url'].trim() : '';
  if (!name) return { ok: false, error: 'Rejected: name is required.' };
  if (!url) return { ok: false, error: 'Rejected: url is required (HTTP MCP servers only).' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `Rejected: "${url}" is not a valid URL.` };
  }
  if (parsed.protocol !== 'https:') {
    // http: is refused too — an MCP endpoint carries the user's credentials on
    // every call, so cleartext is never acceptable, localhost included.
    return { ok: false, error: `Rejected: ${parsed.protocol}// is not allowed. The url must be https.` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Rejected: credentials embedded in the url. The user supplies credentials, not the agent.' };
  }

  // ── Rule 2: no credentials, anywhere ───────────────────────────────────────
  for (const [key, value] of Object.entries(input)) {
    if (CREDENTIAL_KEYS.has(key.toLowerCase())) {
      return {
        ok: false,
        error:
          `Rejected: "${key}" looks like a credential. Agents never pass credentials — ` +
          `name the field in headerNames and the user will fill it in.`,
      };
    }
    if (typeof value === 'string' && looksLikeSecretValue(value)) {
      return {
        ok: false,
        error: `Rejected: the value of "${key}" looks like a secret. Ask the user to supply it instead.`,
      };
    }
  }

  const headerNames = Array.isArray(input['headerNames'])
    ? (input['headerNames'] as unknown[]).filter((h): h is string => typeof h === 'string' && h.trim() !== '').map((h) => h.trim())
    : [];

  const description = typeof input['description'] === 'string' ? input['description'].trim() : '';

  return {
    ok: true,
    config: {
      name,
      url: parsed.toString(),
      transport: 'http',
      ...(description ? { description } : {}),
      headerNames,
    },
  };
}
