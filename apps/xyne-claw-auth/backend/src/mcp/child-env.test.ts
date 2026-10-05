import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  buildChildEnv,
  isAllowlistedForThirdParty,
  isChildEnvAllowlistEnabled,
  isFirstPartyLaunch,
} from "./child-env.js";

const SERVERS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "servers");

/** A realistic slice of the claw-auth production environment. */
const PARENT_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/home/app",
  TMPDIR: "/tmp",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  NODE_ENV: "production",
  NODE_EXTRA_CA_CERTS: "/etc/ssl/ca.pem",
  HTTPS_PROXY: "http://proxy.internal:3128",
  NO_PROXY: "localhost,.svc",
  npm_config_cache: "/home/app/.npm",
  // Secrets — none of these may reach a third-party child.
  INTERNAL_S2S_KEY: "root-internal-key",
  XYNE_CLAW_S2S_KEY: "root-runtime-key",
  DATABASE_URL: "postgres://claw:pw@db/claw",
  SPACES_DATABASE_URL: "postgres://spaces:pw@db/spaces",
  ENCRYPTION_KEY: "aa".repeat(32),
  SPACES_ENCRYPTION_KEY: "bb".repeat(32),
  SESSION_SIGNING_KEY: "sess-sign",
  ACTION_SIGNING_KEY: "act-sign",
  GOOGLE_CLIENT_SECRET: "gcs",
  NODE_AUTH_TOKEN: "npm-publish-token",
  npm_config__authToken: "npm-auth",
  AZURE_TTS_API_KEY: "tts",
  XYNE_CLAW_URL: "http://claw.svc:3002",
};

const FORBIDDEN = [
  /_S2S_KEY$/,
  /DATABASE_URL/,
  /ENCRYPTION_KEY/,
  /SIGNING_KEY/,
  /SECRET/,
  /TOKEN/i,
  /API_KEY/,
];

function forbiddenKeys(env: Record<string, string>): string[] {
  return Object.keys(env).filter((k) => FORBIDDEN.some((re) => re.test(k)));
}

describe("isChildEnvAllowlistEnabled", () => {
  it("is off by default and on for truthy values", () => {
    expect(isChildEnvAllowlistEnabled({})).toBe(false);
    expect(isChildEnvAllowlistEnabled({ MCP_CHILD_ENV_ALLOWLIST: "false" })).toBe(false);
    for (const v of ["1", "true", "TRUE", "on", "yes"]) {
      expect(isChildEnvAllowlistEnabled({ MCP_CHILD_ENV_ALLOWLIST: v })).toBe(true);
    }
  });
});

describe("isAllowlistedForThirdParty", () => {
  it("never lets a secret-looking name through an allowed prefix", () => {
    expect(isAllowlistedForThirdParty("NODE_ENV")).toBe(true);
    expect(isAllowlistedForThirdParty("NODE_AUTH_TOKEN")).toBe(false);
    expect(isAllowlistedForThirdParty("npm_config_cache")).toBe(true);
    expect(isAllowlistedForThirdParty("npm_config__authToken")).toBe(false);
    expect(isAllowlistedForThirdParty("LC_ALL")).toBe(true);
    expect(isAllowlistedForThirdParty("INTERNAL_S2S_KEY")).toBe(false);
  });
});

describe("isFirstPartyLaunch", () => {
  it("recognises in-tree servers and rejects everything else", () => {
    expect(isFirstPartyLaunch(["--import", "file:///x/tsx/esm.mjs", path.join(SERVERS_DIR, "xyne-spaces-server.ts")])).toBe(true);
    expect(isFirstPartyLaunch(["/store/@modelcontextprotocol/server-github/dist/index.js"])).toBe(false);
    expect(isFirstPartyLaunch(["-y", "@mondaydotcomorg/monday-api-mcp@3.3.1"])).toBe(false);
    // Path traversal out of the servers dir is not first-party.
    expect(isFirstPartyLaunch([path.join(SERVERS_DIR, "..", "..", "evil.js")])).toBe(false);
    // A sibling directory sharing the prefix is not first-party.
    expect(isFirstPartyLaunch([`${SERVERS_DIR}-evil/x.js`])).toBe(false);
  });
});

describe("buildChildEnv", () => {
  it("flag off: preserves the legacy full-env behaviour (rollback path)", () => {
    const env = buildChildEnv({ parentEnv: PARENT_ENV, adapterEnv: { FOO: "bar" }, firstParty: false, allowlistEnabled: false });
    expect(env["INTERNAL_S2S_KEY"]).toBe("root-internal-key");
    expect(env["FOO"]).toBe("bar");
  });

  it("third-party: only the allowlist plus the adapter's own env", () => {
    const env = buildChildEnv({
      parentEnv: PARENT_ENV,
      adapterEnv: { GITHUB_PERSONAL_ACCESS_TOKEN: "user-pat" },
      firstParty: false,
      allowlistEnabled: true,
    });
    expect(Object.keys(env).sort()).toEqual(
      [
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "HOME",
        "HTTPS_PROXY",
        "LANG",
        "LC_ALL",
        "NODE_ENV",
        "NODE_EXTRA_CA_CERTS",
        "NO_PROXY",
        "PATH",
        "TMPDIR",
        "npm_config_cache",
      ].sort(),
    );
    // The adapter's declared credential is the only secret it gets.
    expect(forbiddenKeys(env)).toEqual(["GITHUB_PERSONAL_ACCESS_TOKEN"]);
  });

  it("first-party: strips every S2S key the adapter did not pass explicitly", () => {
    const withoutKey = buildChildEnv({ parentEnv: PARENT_ENV, adapterEnv: {}, firstParty: true, allowlistEnabled: true });
    expect(Object.keys(withoutKey).filter((k) => k.endsWith("_S2S_KEY"))).toEqual([]);
    // Known exception (TODO XYNE-65483): first-party code still needs config.ts inputs.
    expect(withoutKey["ENCRYPTION_KEY"]).toBe(PARENT_ENV["ENCRYPTION_KEY"]);

    const spaces = buildChildEnv({
      parentEnv: PARENT_ENV,
      adapterEnv: { INTERNAL_S2S_KEY: "root-internal-key", XYNE_SPACES_TOKEN: "t" },
      firstParty: true,
      allowlistEnabled: true,
    });
    expect(Object.keys(spaces).filter((k) => k.endsWith("_S2S_KEY"))).toEqual(["INTERNAL_S2S_KEY"]);
  });
});

describe("spawned third-party child (real process via the MCP stdio transport)", () => {
  it("receives no S2S key, database URL, or encryption/signing secret", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "child-env-"));
    const out = path.join(dir, "env.json");
    const script = path.join(dir, "dump-env.cjs");
    writeFileSync(script, `require("fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env));`);

    // Same construction runner.ts uses for an npx adapter, with the real
    // parent env polluted by the production secrets.
    const saved = { ...process.env };
    Object.assign(process.env, PARENT_ENV, { PATH: process.env["PATH"] });
    let env: Record<string, string>;
    try {
      const args = [script];
      env = buildChildEnv({ adapterEnv: {}, firstParty: isFirstPartyLaunch(args), allowlistEnabled: true });
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }

    const transport = new StdioClientTransport({ command: process.execPath, args: [script], env, cwd: dir, stderr: "ignore" });
    try {
      await transport.start();
      for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 50));
      const childEnv = JSON.parse(readFileSync(out, "utf8")) as Record<string, string>;
      expect(forbiddenKeys(childEnv)).toEqual([]);
      for (const v of ["root-internal-key", "root-runtime-key", "postgres://claw:pw@db/claw", "aa".repeat(32), "sess-sign"]) {
        expect(Object.values(childEnv)).not.toContain(v);
      }
      expect(childEnv["NODE_ENV"]).toBe("production");
    } finally {
      await transport.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
