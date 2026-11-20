/** Parent environment variables passed to MCP server processes. */
const CHILD_ENV_ALLOWLIST = [
  "PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TZ", "TMPDIR", "NODE_ENV",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "NODE_USE_ENV_PROXY",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
  "XDG_CACHE_HOME", "npm_config_cache", "UV_CACHE_DIR", "PIP_CACHE_DIR",
  "SPACES_BACKEND_URL", "LOG_LEVEL",
] as const;

export function childBaseEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    const v = source[name];
    if (typeof v === "string") out[name] = v;
  }
  return out;
}
