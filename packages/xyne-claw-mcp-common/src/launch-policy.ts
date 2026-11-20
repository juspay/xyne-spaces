/**
 * Launch policy of the MCP service. checkLaunch() allows:
 *   xyne-mcp-server <name>  a name in BUILTIN_SERVERS
 *   node <file>             a file under MCP_EXTRA_SERVER_DIRS (optionally --import tsx/esm)
 *   npx -y <spec>           a spec in INSTALLED_NPX_SPECS
 *   uvx [--with d]* <spec>  an entry of INSTALLED_UVX
 *   <binary> <subcommand> [--flag[=v]]*  an entry of INSTALLED_BINARIES with its allowed flags
 *   http <url>              https to a public host, or a host in MCP_ALLOWED_HTTP_HOSTS;
 *                           with MCP_HTTP_ONLY_LISTED=true, listed hosts only
 * and refuses env keys matching BLOCKED_ENV.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { isBlockedAddress } from "./outbound-url.js";
import { EXTRA_BUILTIN_SERVERS } from "./extra-servers.js";
import { BUILTIN_SERVER_CMD, type LaunchSpec } from "./protocol.js";

/** Server names for `xyne-mcp-server <name>` (apps/xyne-claw-mcp-service/src/servers/<name>.ts). */
export const BUILTIN_SERVERS: ReadonlySet<string> = new Set([
  "google-server",
  "jenkins-server",
  "linkedin-rapidapi-server",
  "microsoft-server",
  "neo4j-http-server",
  "reddit-server",
  "twitter-server",
  "x-news-server",
  "xyne-dashboard-server",
  "xyne-spaces-app-tools-server",
  "xyne-spaces-server",
  ...EXTRA_BUILTIN_SERVERS,
]);


/** npm MCP servers installed in the MCP service image (mcp-packages/npm). */
export const INSTALLED_NPX_SPECS: readonly string[] = [
  "@ergut/mcp-bigquery-server@1.0.4",
  "@hubspot/mcp-server@0.4.0",
  "@mercuryml/mcp-mixpanel@1.0.9",
  "@modelcontextprotocol/server-sequential-thinking@2025.12.18",
  "@mondaydotcomorg/monday-api-mcp@3.3.1",
  "@nexus2520/bitbucket-mcp-server@2.2.0",
  "@notionhq/notion-mcp-server@2.2.1",
  "@roychri/mcp-server-asana@1.8.0",
  "@scofieldfree/excalidraw-mcp@0.1.1",
  "@sentry/mcp-server@0.36.0",
  "amplitude-mcp-server@1.0.2",
  "figma-developer-mcp@0.13.2",
  "mongodb-mcp-server@1.12.0",
  "shopify-mcp@1.0.8",
];

/**
 * Python MCP servers installed in the MCP service image, one virtualenv each
 * (mcp-packages/python/<venv>.txt). The service runs `<venv>/bin/<bin>`.
 */
export interface InstalledUvx {
  spec: string;
  with: readonly string[];
  venv: string;
  bin: string;
}

export const INSTALLED_UVX: readonly InstalledUvx[] = [
  { spec: "databricks-mcp-server==0.4.4", with: ["mcp<2"], venv: "databricks-mcp-server", bin: "databricks-mcp-server" },
  { spec: "mcp-clickhouse==0.4.0", with: [], venv: "mcp-clickhouse", bin: "mcp-clickhouse" },
  { spec: "mcp-grafana==1.6.3", with: [], venv: "mcp-grafana", bin: "mcp-grafana" },
  { spec: "mcp-neo4j-aura-manager==0.4.8", with: [], venv: "mcp-neo4j-aura-manager", bin: "mcp-neo4j-aura-manager" },
];

/** Prebuilt MCP server binaries installed in the MCP service image (mcp-packages/bin). */
export interface InstalledBinary {
  name: string;
  version: string;
  subcommand: string;
  flags: readonly string[];
}

export const INSTALLED_BINARIES: readonly InstalledBinary[] = [
  { name: "github-mcp-server", version: "2.1.0", subcommand: "stdio", flags: ["--toolsets", "--tools", "--read-only", "--lockdown-mode"] },
];

function checkBinary(binary: InstalledBinary, args: string[]): string | null {
  const [subcommand, ...flags] = args;
  if (subcommand !== binary.subcommand) return `${binary.name}: expected ${binary.subcommand}`;
  for (const flag of flags) {
    const name = flag.split("=")[0] ?? "";
    if (!binary.flags.includes(name)) return `${binary.name}: flag ${flag} is not allowed`;
  }
  return null;
}

/** Split uvx args into `--with` deps, the package spec and the server's own args. */
export function parseUvxArgs(args: readonly string[]): { with: string[]; spec: string; rest: string[] } | null {
  const deps: string[] = [];
  let i = 0;
  while (args[i] === "--with") {
    const dep = args[i + 1];
    if (!dep) return null;
    deps.push(dep);
    i += 2;
  }
  const spec = args[i];
  if (!spec || spec.startsWith("-")) return null;
  return { with: deps, spec, rest: args.slice(i + 1) };
}

/** The installed Python server a uvx launch refers to, if any. */
export function findInstalledUvx(args: readonly string[]): { installed: InstalledUvx; rest: string[] } | null {
  const parsed = parseUvxArgs(args);
  if (!parsed) return null;
  const wanted = [...parsed.with].sort().join("\n");
  const installed = INSTALLED_UVX.find((u) => u.spec === parsed.spec && [...u.with].sort().join("\n") === wanted);
  return installed ? { installed, rest: parsed.rest } : null;
}

export interface LaunchPolicy {
  /** Dirs a plain `node <file>` launch may run from. Empty by default. */
  serverDirs: string[];
  /** Exact npx specs that may run (INSTALLED_NPX_SPECS). */
  npxSpecs: ReadonlySet<string>;
  /** Hosts http launches may always reach, internal ones included (exact or subdomain). */
  httpHosts: string[];
  /** Only `httpHosts`; no other public https hosts. */
  httpOnlyListed: boolean;
}

function list(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): LaunchPolicy {
  return {
    serverDirs: list(env["MCP_EXTRA_SERVER_DIRS"]).map((d) => path.resolve(d)),
    npxSpecs: new Set(INSTALLED_NPX_SPECS),
    httpHosts: list(env["MCP_ALLOWED_HTTP_HOSTS"]).map((h) => h.toLowerCase()),
    httpOnlyListed: env["MCP_HTTP_ONLY_LISTED"] === "true",
  };
}

/** `@scope/name@1.2.3` → `@scope/name`; `name@latest` → `name`. */
export function npxPackageName(spec: string): string {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return at === -1 ? spec : spec.slice(0, at);
}

function insideDir(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function checkNode(args: string[], policy: LaunchPolicy): string | null {
  let i = 0;
  if (args[0] === "--import") {
    if (args[1] !== "tsx/esm") return "node: only --import tsx/esm is allowed";
    i = 2;
  }
  const script = args[i];
  if (!script || script.startsWith("-")) return "node: expected a server file, not a flag";
  if (!path.isAbsolute(script)) return "node: server file must be an absolute path";
  const resolved = path.resolve(script);
  if (!policy.serverDirs.some((dir) => insideDir(resolved, dir))) return "node: server file is outside the allowed server dirs";
  return null;
}

function checkNpx(args: string[], policy: LaunchPolicy): string | null {
  if (args[0] !== "-y") return "npx: expected -y <package>";
  const spec = args[1];
  if (!spec || spec.startsWith("-")) return "npx: missing package";
  if (!policy.npxSpecs.has(spec)) return `npx: ${spec} is not installed in this image`;
  return null;
}

function checkUvx(args: string[]): string | null {
  if (!parseUvxArgs(args)) return "uvx: expected [--with <dep>]* <package>";
  return findInstalledUvx(args) ? null : `uvx: ${args.join(" ")} is not installed in this image`;
}

function isInternalHost(host: string): boolean {
  // Drops brackets and a trailing dot.
  const h = host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isIP(h)) return isBlockedAddress(h);
  // Single-label names are internal.
  if (!h.includes(".")) return true;
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".svc") || h.includes(".svc.");
}

function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

function checkHttp(rawUrl: string, policy: LaunchPolicy): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "http: invalid URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "http: only http(s) URLs";
  if (hostAllowed(url.hostname, policy.httpHosts)) return null;
  if (policy.httpOnlyListed) return `http: host ${url.hostname} is not allowed`;
  if (url.protocol !== "https:") return "http: only https URLs";
  if (isInternalHost(url.hostname)) return `http: internal host ${url.hostname} is not allowed`;
  return null;
}

const FILE_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/** Env keys a launch may not set. */
const BLOCKED_ENV = /^(NODE_(?!ENV$)\w*|LD_\w*|DYLD_\w*|NPM_CONFIG_\w*|UV_\w*|PIP_\w*|PYTHON\w*|PATH|HOME|TMPDIR|SHELL|BASH_ENV|ENV|SSL_CERT_\w*|REQUESTS_CA_BUNDLE|HTTPS?_PROXY|NO_PROXY|GIT_\w*)$/i;

export function blockedEnvKey(key: string): boolean {
  return BLOCKED_ENV.test(key);
}
const MAX_FILE_BYTES = 64 * 1024;

/** null when the launch may run, otherwise the reason it may not. */
export function checkLaunch(spec: LaunchSpec, policy: LaunchPolicy): string | null {
  if (spec.transport === "http") return checkHttp(spec.url, policy);

  for (const key of Object.keys(spec.env)) {
    if (blockedEnvKey(key)) return `env: ${key} may not be set`;
  }
  for (const [name, content] of Object.entries(spec.files ?? {})) {
    if (!FILE_NAME.test(name) || name === "." || name === "..") return `files: bad name ${name}`;
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) return `files: ${name} is too large`;
  }
  if (spec.cmd === BUILTIN_SERVER_CMD) {
    const [name, ...rest] = spec.args;
    if (!name || rest.length > 0) return `${BUILTIN_SERVER_CMD}: expected exactly one server name`;
    return BUILTIN_SERVERS.has(name) ? null : `${BUILTIN_SERVER_CMD}: unknown server ${name}`;
  }
  // Exact command names only, not paths.
  if (spec.cmd === "node" || spec.cmd === process.execPath) return checkNode(spec.args, policy);
  if (spec.cmd === "npx") return checkNpx(spec.args, policy);
  if (spec.cmd === "uvx") return checkUvx(spec.args);
  const binary = INSTALLED_BINARIES.find((b) => b.name === spec.cmd);
  if (binary) return checkBinary(binary, spec.args);
  return `command ${spec.cmd} is not allowed`;
}

/** URLs a launch connects to. */
function launchUrls(spec: LaunchSpec): string[] {
  return spec.transport === "http" ? [spec.url] : [];
}

/**
 * Resolves the hosts a launch connects to and refuses internal addresses.
 * Hosts in MCP_ALLOWED_HTTP_HOSTS and IP literals are not resolved.
 */
export async function checkLaunchAddresses(
  spec: LaunchSpec,
  policy: LaunchPolicy,
  resolve: (host: string) => Promise<string[]> = async (host) =>
    (await lookup(host, { all: true, verbatim: true })).map((a) => a.address),
): Promise<string | null> {
  for (const raw of launchUrls(spec)) {
    let host: string;
    try {
      host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
    } catch {
      return "http: invalid URL";
    }
    if (hostAllowed(host, policy.httpHosts) || isIP(host)) continue;
    let addresses: string[];
    try {
      addresses = await resolve(host);
    } catch {
      return `http: cannot resolve ${host}`;
    }
    const blocked = addresses.find((a) => isBlockedAddress(a));
    if (blocked) return `http: ${host} resolves to internal address ${blocked}`;
  }
  return null;
}
