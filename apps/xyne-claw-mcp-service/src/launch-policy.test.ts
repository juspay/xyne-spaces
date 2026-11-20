import { describe, expect, it } from "vitest";
import {
  BUILTIN_SERVERS,
  checkLaunch,
  checkLaunchAddresses,
  findInstalledUvx,
  INSTALLED_NPX_SPECS,
  INSTALLED_UVX,
  npxPackageName,
  policyFromEnv,
} from "xyne-claw-mcp-common/launch-policy";
import { BUILTIN_SERVER_CMD } from "xyne-claw-mcp-common/protocol";
import { builtinServerPath } from "./servers/index.js";

const policy = policyFromEnv({});
const withDir = policyFromEnv({ MCP_EXTRA_SERVER_DIRS: "/srv/mcp-extra" });

describe("launch policy", () => {
  it("allows our builtin servers by name only", () => {
    const builtin = (args: string[]) => checkLaunch({ transport: "stdio", cmd: BUILTIN_SERVER_CMD, args, env: {} }, policy);
    for (const name of BUILTIN_SERVERS) expect(builtin([name])).toBeNull();
    expect(builtin(["../../etc/passwd"])).toMatch(/unknown server/);
    expect(builtin(["xyne-spaces-tools"])).toMatch(/unknown server/);
    expect(builtin(["xyne-spaces-server", "--inspect"])).toMatch(/exactly one/);
    expect(builtin([])).toMatch(/exactly one/);
  });

  it("finds every builtin server's file", async () => {
    const { existsSync } = await import("node:fs");
    for (const name of BUILTIN_SERVERS) expect(existsSync(builtinServerPath(name))).toBe(true);
  });

  it("refuses other commands and node flags", () => {
    const stdio = (cmd: string, args: string[]) => checkLaunch({ transport: "stdio", cmd, args, env: {} }, policy);
    expect(stdio("/bin/sh", ["-c", "id"])).toMatch(/not allowed/);
    expect(stdio("bash", ["x"])).toMatch(/not allowed/);
    expect(stdio("python3", ["-c", "x"])).toMatch(/not allowed/);
    expect(stdio("node", ["-e", "process.exit(1)"])).toMatch(/flag/);
    expect(stdio("node", ["--require", "/tmp/x.js", "/tmp/y.js"])).toMatch(/flag/);
    expect(stdio("node", ["--import", "/tmp/evil.mjs", "/tmp/y.js"])).toMatch(/tsx\/esm/);
    expect(stdio("node", ["/tmp/evil.mjs"])).toMatch(/outside/);
    expect(stdio("node", ["relative/server.ts"])).toMatch(/absolute/);
    expect(stdio("npx", ["evil-pkg"])).toMatch(/-y/);
    expect(stdio("npx", ["-y", "evil-pkg@1.0.0"])).toMatch(/not installed/);
    expect(stdio("npx", ["-y", "@modelcontextprotocol/server-github-evil@1"])).toMatch(/not installed/);
    expect(stdio("uvx", ["evil==1"])).toMatch(/not installed/);
    expect(stdio("uvx", ["--with", "evil", "mcp-grafana==1.6.3"])).toMatch(/not installed/);
  });

  it("refuses node scripts that escape the server dir", () => {
    const serverDir = withDir.serverDirs[0]!;
    expect(checkLaunch({ transport: "stdio", cmd: "node", args: ["--import", "tsx/esm", `${serverDir}/../runner.ts`], env: {} }, withDir)).toMatch(
      /outside/,
    );
  });

  it("checks launch files", () => {
    const withFiles = (files: Record<string, string>) =>
      checkLaunch({ transport: "stdio", cmd: "npx", args: ["-y", "@ergut/mcp-bigquery-server@1.0.4"], env: {}, files }, policy);
    expect(withFiles({ "sa-key.json": "{}" })).toBeNull();
    expect(withFiles({ "../x": "{}" })).toMatch(/bad name/);
    expect(withFiles({ "big.json": "x".repeat(70_000) })).toMatch(/too large/);
  });

  it("allows public https and refuses internal or plain http hosts", () => {
    const http = (url: string, p = policy) => checkLaunch({ transport: "http", url, headers: {} }, p);
    expect(http("https://mcp.notion.com/mcp")).toBeNull();
    expect(http("http://mcp.notion.com/mcp")).toMatch(/https/);
    expect(http("https://169.254.169.254/latest")).toMatch(/internal/);
    expect(http("https://10.0.0.5/mcp")).toMatch(/internal/);
    expect(http("https://[::1]/mcp")).toMatch(/internal/);
    expect(http("https://localhost/mcp")).toMatch(/internal/);
    expect(http("https://metadata.google.internal/x")).toMatch(/internal/);
    expect(http("https://claw-auth.xyne.svc.cluster.local/x")).toMatch(/internal/);
    expect(http("file:///etc/passwd")).toMatch(/http/);

    const listed = policyFromEnv({ MCP_ALLOWED_HTTP_HOSTS: "tools.internal.example" });
    expect(http("http://tools.internal.example/tools", listed)).toBeNull();
    const onlyListed = policyFromEnv({ MCP_ALLOWED_HTTP_HOSTS: "mcp.notion.com", MCP_HTTP_ONLY_LISTED: "true" });
    expect(http("https://mcp.notion.com/mcp", onlyListed)).toBeNull();
    expect(http("https://mcp.atlassian.com/v1/mcp", onlyListed)).toMatch(/not allowed/);
  });

  it("parses package names", () => {
    expect(npxPackageName("@scope/name@1.2.3")).toBe("@scope/name");
    expect(npxPackageName("name@latest")).toBe("name");
    expect(npxPackageName("name")).toBe("name");
  });

  it("refuses env keys that change how node, npm, python or the loader behave", () => {
    const withEnv = (env: Record<string, string>) =>
      checkLaunch({ transport: "stdio", cmd: BUILTIN_SERVER_CMD, args: ["google-server"], env }, policy);
    for (const key of ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "PATH", "HOME", "npm_config_registry", "UV_INDEX_URL", "PIP_INDEX_URL", "PYTHONPATH", "HTTPS_PROXY", "BASH_ENV"]) {
      expect(withEnv({ [key]: "x" }), key).toMatch(/may not be set/);
    }
    expect(withEnv({ NODE_ENV: "production", GOOGLE_ACCESS_TOKEN: "t" })).toBeNull();
  });

  it("allows only the exact package versions installed in the image", () => {
    const npx = (spec: string, ...rest: string[]) => checkLaunch({ transport: "stdio", cmd: "npx", args: ["-y", spec, ...rest], env: {} }, policy);
    for (const spec of INSTALLED_NPX_SPECS) expect(npx(spec), spec).toBeNull();
    // Another version, no version, aliases, URLs and git refs are all "not installed".
    expect(npx("@sentry/mcp-server@0.35.0")).toMatch(/not installed/);
    expect(npx("@sentry/mcp-server")).toMatch(/not installed/);
    expect(npx("@sentry/mcp-server@latest")).toMatch(/not installed/);
    expect(npx("@sentry/mcp-server@npm:evil-pkg")).toMatch(/not installed/);
    expect(npx("@sentry/mcp-server@https://evil.example/x.tgz")).toMatch(/not installed/);
    expect(npx("@sentry/mcp-server@github:evil/repo")).toMatch(/not installed/);

    const uvx = (...args: string[]) => checkLaunch({ transport: "stdio", cmd: "uvx", args, env: {} }, policy);
    for (const u of INSTALLED_UVX) expect(uvx(...u.with.flatMap((d) => ["--with", d]), u.spec), u.spec).toBeNull();
    expect(uvx("databricks-mcp-server==0.4.4")).toMatch(/not installed/); // missing its --with
    expect(uvx("klaviyo-mcp-server@latest")).toMatch(/not installed/);
    expect(uvx("mcp @ https://evil.example/x.whl")).toMatch(/not installed/);
    expect(uvx("--with", "mcp @ https://evil.example/x.whl", "mcp-grafana==1.6.3")).toMatch(/not installed/);
  });

  it("splits a uvx launch into the installed server and its own args", () => {
    const found = findInstalledUvx(["--with", "mcp<2", "databricks-mcp-server==0.4.4", "--port", "1"]);
    expect(found?.installed.venv).toBe("databricks-mcp-server");
    expect(found?.rest).toEqual(["--port", "1"]);
    expect(findInstalledUvx(["mcp-grafana==1.6.3", "--enabled-tools", "search"])?.rest).toEqual(["--enabled-tools", "search"]);
  });

  it("refuses commands given as a path and single-label hosts", () => {
    expect(checkLaunch({ transport: "stdio", cmd: "/tmp/evil/npx", args: ["-y", "@sentry/mcp-server@0.36.0"], env: {} }, policy)).toMatch(/not allowed/);
    expect(checkLaunch({ transport: "http", url: "https://xyne-claw-auth:3003/mcp", headers: {} }, policy)).toMatch(/internal/);
  });

  it("refuses public-looking names that resolve to internal addresses", async () => {
    const resolveTo = (addr: string) => async () => [addr];
    const http = { transport: "http" as const, url: "https://169.254.169.254.nip.io/x", headers: {} };
    expect(await checkLaunchAddresses(http, policy, resolveTo("169.254.169.254"))).toMatch(/internal address/);
    expect(await checkLaunchAddresses(http, policy, resolveTo("10.1.2.3"))).toMatch(/internal address/);
    expect(await checkLaunchAddresses(http, policy, resolveTo("93.184.216.34"))).toBeNull();
    const listed = policyFromEnv({ MCP_ALLOWED_HTTP_HOSTS: "nip.io" });
    expect(await checkLaunchAddresses(http, listed, resolveTo("10.1.2.3"))).toBeNull();
    const stdio = { transport: "stdio" as const, cmd: BUILTIN_SERVER_CMD, args: ["google-server"], env: {} };
    expect(await checkLaunchAddresses(stdio, policy, resolveTo("10.1.2.3"))).toBeNull();
  });

  it("never runs mcp itself as the uvx program", () => {
    const uvx = (...args: string[]) => checkLaunch({ transport: "stdio", cmd: "uvx", args, env: {} }, policy);
    expect(uvx("mcp[cli]", "run", "{{file:x.py}}")).toMatch(/not installed/);
    expect(uvx("mcp", "run", "x.py")).toMatch(/not installed/);
  });

  it("refuses every internal IP literal and trailing-dot internal names", () => {
    const http = (url: string) => checkLaunch({ transport: "http", url, headers: {} }, policy);
    for (const url of ["https://192.0.0.1/x", "https://198.18.0.1/x", "https://[fec0::1]/x", "https://[64:ff9b::a9fe:a9fe]/x", "https://[::ffff:169.254.169.254]/x"]) {
      expect(http(url), url).toMatch(/internal/);
    }
    expect(http("https://metadata.google.internal./x")).toMatch(/internal/);
    expect(http("https://93.184.216.34/x")).toBeNull();
  });

  it("allows installed binaries with their subcommand and listed flags only", () => {
    const bin = (cmd: string, ...args: string[]) => checkLaunch({ transport: "stdio", cmd, args, env: {} }, policy);
    expect(bin("github-mcp-server", "stdio")).toBeNull();
    expect(bin("github-mcp-server", "stdio", "--toolsets=repos,issues", "--read-only")).toBeNull();
    expect(bin("github-mcp-server", "http")).toMatch(/expected stdio/);
    expect(bin("github-mcp-server", "stdio", "--export-translations")).toMatch(/not allowed/);
    expect(bin("/opt/mcp/bin/github-mcp-server", "stdio")).toMatch(/not allowed/);
  });
});
