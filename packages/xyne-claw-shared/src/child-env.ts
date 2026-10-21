/**
 * The environment for a child process claw spawns: a stdio MCP adapter, or the
 * npm install that provisions one.
 *
 * Spreading `process.env` hands every secret this service holds (database URL,
 * encryption key, OAuth client secrets) to third-party packages. A child gets
 * the variables below, the ones its launch declares, and whatever its adapter
 * says it also reads. Nothing else.
 */
const BASE_CHILD_ENV = [
  "PATH", "HOME", "TMPDIR", "TZ", "LANG", "LC_ALL", "LANGUAGE", "SHELL", "USER", "LOGNAME", "TERM",
  "NODE_PATH", "NODE_ENV", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
] as const;

export interface ChildEnvOptions {
  /** Parent variables this child also reads, copied when set. */
  inherit?: readonly string[] | undefined;
  /** Parent variables copied by name prefix, such as `npm_config_`. */
  inheritPrefixes?: readonly string[] | undefined;
  /** Copy the whole parent environment. Only for servers built from this repo that import this service's own config. */
  inheritAll?: boolean | undefined;
}

export function buildChildEnv(
  parent: Readonly<Record<string, string | undefined>>,
  declared: Record<string, string>,
  options: ChildEnvOptions = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  const copy = (name: string): void => {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  };
  if (options.inheritAll) {
    for (const name of Object.keys(parent)) copy(name);
  } else {
    for (const name of BASE_CHILD_ENV) copy(name);
    for (const name of options.inherit ?? []) copy(name);
    const prefixes = options.inheritPrefixes ?? [];
    if (prefixes.length > 0) {
      for (const name of Object.keys(parent)) {
        if (prefixes.some((prefix) => name.startsWith(prefix))) copy(name);
      }
    }
  }
  return { ...env, ...declared };
}
