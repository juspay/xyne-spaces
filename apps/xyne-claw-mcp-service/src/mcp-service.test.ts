/**
 * End to end: the shared service client (what claw-auth uses) → signed HTTP →
 * this app → a real stdio MCP server (__fixtures__/echo-server.mjs).
 */
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const encPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const ENC_PRIVATE_PEM = encPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ENC_PUBLIC_PEM = encPair.publicKey.export({ type: "spki", format: "pem" }).toString();

process.env["ENCRYPTION_KEY"] = "must-not-reach-children";
process.env["MCP_EXTRA_SERVER_DIRS"] = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
process.env["DATABASE_URL"] = "postgres://must-not-reach-children";

const { AssertionVerifier, callerKeysFromEnv, parsePublicKeys, SERVICE_ASSERTION_HEADER } = await import("./auth.js");
const { createMcpServiceApp } = await import("./app.js");
const { bodyHash, MCP_SERVICE_PATHS } = await import("xyne-claw-mcp-common/protocol");
const { poolCloseAll, poolStats } = await import("./pool.js");
const { createMcpServiceClient, McpServiceError } = await import("xyne-claw-mcp-common/client");

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "echo-server.mjs");

let server: Server;
let baseUrl = "";
let client: ReturnType<typeof createMcpServiceClient>;
const mcpExecutor = () => client;

beforeAll(async () => {
  const verifier = new AssertionVerifier(
    new Map([
      ["xyne-claw-auth", parsePublicKeys(JSON.stringify({ "claw-1": PUBLIC_PEM }))],
      ["xyne-claw-encryption", parsePublicKeys(JSON.stringify({ "enc-1": ENC_PUBLIC_PEM }))],
    ]),
  );
  server = createMcpServiceApp(verifier).listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = createMcpServiceClient({
    baseUrl,
    sign: (_method, p, claims) => assertion({ htu: p, ...claims }),
    send: (url, init) => fetch(url, init),
  });
});

afterAll(async () => {
  await poolCloseAll();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function ref(key: string, token: string, launches: { count: number }) {
  return {
    key,
    serverType: "echo",
    fingerprint: `tok:${token}`,
    launch: async () => {
      launches.count += 1;
      return { transport: "stdio" as const, cmd: process.execPath, args: [FIXTURE], env: { FIXTURE_TOKEN: token } };
    },
  };
}

function text(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

function assertion(
  claims: Record<string, unknown>,
  key = PRIVATE_PEM,
  caller: { iss: string; kid: string } = { iss: "xyne-claw-auth", kid: "claw-1" },
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "xyne-service+jwt", kid: caller.kid };
  const payload = { iss: caller.iss, aud: "xyne-claw-mcp", iat: now, exp: now + 60, jti: randomUUID(), htm: "POST", ...claims };
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${enc(header)}.${enc(payload)}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

async function rawPost(p: string, body: string, headers: Record<string, string>): Promise<number> {
  return (await rawPostJson(p, body, headers)).status;
}

async function rawPostJson(p: string, body: string, headers: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function signedBy(caller: { iss: string; kid: string }, key: string, p: string, body: string): Record<string, string> {
  return { [SERVICE_ASSERTION_HEADER]: assertion({ htu: p, bh: bodyHash(body) }, key, caller) };
}

describe("xyne-claw-mcp service", () => {
  it("starts a session once, reuses it, and keeps claw-auth secrets out of the child", async () => {
    const executor = mcpExecutor();
    const launches = { count: 0 };
    const r = ref("u1:echo", "a", launches);

    const tools = await executor.listTools(r);
    expect(tools.map((t) => t.name)).toEqual(["echo"]);

    const first = text(await executor.callTool(r, "echo", { text: "hi" }, { xyneSpacesAuth: { agentToken: "t1" } }));
    const second = text(await executor.callTool(r, "echo", { text: "again" }));
    expect(first).toMatchObject({ text: "hi", token: "a", meta: { xyneSpacesAuth: { agentToken: "t1" } }, leaked: [] });
    expect(second["pid"]).toBe(first["pid"]);
    expect(launches.count).toBe(1);
  });

  it("restarts the session when the credential fingerprint changes", async () => {
    const executor = mcpExecutor();
    const launches = { count: 0 };
    const before = text(await executor.callTool(ref("u2:echo", "a", launches), "echo", {}));
    const after = text(await executor.callTool(ref("u2:echo", "b", launches), "echo", {}));
    expect(after["token"]).toBe("b");
    expect(after["pid"]).not.toBe(before["pid"]);
    expect(launches.count).toBe(2);
  });

  it("evicts scoped sessions so the next call starts fresh", async () => {
    const executor = mcpExecutor();
    const launches = { count: 0 };
    await executor.callTool(ref("u3:echo:ws:w1", "a", launches), "echo", {});
    const sessionsBefore = poolStats().sessions;
    await executor.evict({ scopedKeys: ["u3:echo"] });
    expect(poolStats().sessions).toBe(sessionsBefore - 1);
    await executor.callTool(ref("u3:echo:ws:w1", "a", launches), "echo", {});
    expect(launches.count).toBe(2);
  });

  it("surfaces a tool error with the server's message", async () => {
    const executor = mcpExecutor();
    const result = await executor.callTool(ref("u4:echo", "a", { count: 0 }), "nope", {});
    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it("rejects unsigned, tampered, replayed and foreign-key requests", async () => {
    const p = MCP_SERVICE_PATHS.restart;
    const body = JSON.stringify({ serverType: "none" });

    expect(await rawPost(p, body, {})).toBe(401);

    const signedForOther = assertion({ htu: p, bh: bodyHash(JSON.stringify({ serverType: "other" })) });
    expect(await rawPost(p, body, { [SERVICE_ASSERTION_HEADER]: signedForOther })).toBe(401);

    const wrongPath = assertion({ htu: MCP_SERVICE_PATHS.evict, bh: bodyHash(body) });
    expect(await rawPost(p, body, { [SERVICE_ASSERTION_HEADER]: wrongPath })).toBe(401);

    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(await rawPost(p, body, { [SERVICE_ASSERTION_HEADER]: assertion({ htu: p, bh: bodyHash(body) }, other) })).toBe(401);

    const good = assertion({ htu: p, bh: bodyHash(body) });
    expect(await rawPost(p, body, { [SERVICE_ASSERTION_HEADER]: good })).toBe(200);
    expect(await rawPost(p, body, { [SERVICE_ASSERTION_HEADER]: good })).toBe(401);
  });

  it("refuses launches outside the allowlist, even when correctly signed", async () => {
    const executor = mcpExecutor();
    const launches: Array<() => Promise<unknown>> = [
      async () => ({ transport: "stdio", cmd: process.execPath, args: ["-e", "process.exit(3)"], env: {} }),
      async () => ({ transport: "stdio", cmd: "/bin/sh", args: ["-c", "id"], env: {} }),
      async () => ({ transport: "stdio", cmd: "npx", args: ["-y", "evil-package@1.0.0"], env: {} }),
      async () => ({ transport: "http", url: "http://169.254.169.254/latest/meta-data", headers: {} }),
    ];
    for (const [i, launch] of launches.entries()) {
      const bad = { key: `u5-${i}:echo`, serverType: "echo", fingerprint: "", launch } as Parameters<typeof executor.callTool>[0];
      const err = await executor.callTool(bad, "echo", {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(McpServiceError);
      expect((err as InstanceType<typeof McpServiceError>).code).toBe("launch-not-allowed");
    }
  });

  it("writes launch files for the session and removes them when it closes", async () => {
    const executor = mcpExecutor();
    const r = {
      key: "u6:echo",
      serverType: "echo",
      fingerprint: "",
      launch: async () => ({
        transport: "stdio" as const,
        cmd: process.execPath,
        args: [FIXTURE],
        env: { FIXTURE_TOKEN: "{{file:key.json}}" },
        files: { "key.json": "{\"secret\":1}" },
      }),
    };
    const report = text(await executor.callTool(r, "echo", {}));
    const keyPath = String(report["token"]);
    expect(keyPath).toMatch(/mcp-files-.*key\.json$/);
    const fs = await import("node:fs");
    expect(fs.readFileSync(keyPath, "utf8")).toBe("{\"secret\":1}");
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    await executor.evict({ scopedKeys: ["u6:echo"] });
    expect(fs.existsSync(keyPath)).toBe(false);
  });

  it("accepts the encryption service as a caller and refuses unknown services", async () => {
    const p = MCP_SERVICE_PATHS.restart;
    const body = JSON.stringify({ serverType: "none" });
    const enc = { iss: "xyne-claw-encryption", kid: "enc-1" };
    expect(await rawPost(p, body, signedBy(enc, ENC_PRIVATE_PEM, p, body))).toBe(200);
    // Right issuer name, wrong key (claw-auth's key used under the encryption name).
    expect(await rawPost(p, body, signedBy({ iss: "xyne-claw-encryption", kid: "claw-1" }, PRIVATE_PEM, p, body))).toBe(401);
    // A service that isn't configured as a caller.
    expect(await rawPost(p, body, signedBy({ iss: "xyne-spaces", kid: "claw-1" }, PRIVATE_PEM, p, body))).toBe(401);
  });

  it("starts one of our own servers by name from the servers package", async () => {
    const tools = await mcpExecutor().listTools({
      key: "u8:reddit",
      serverType: "reddit",
      fingerprint: "",
      launch: async () => ({ transport: "stdio" as const, cmd: "xyne-mcp-server", args: ["reddit-server"], env: {} }),
    });
    expect(tools.map((t) => t.name)).toContain("search_reddit");
  }, 30_000);

  it("reports a failed server start as a service error", async () => {
    const executor = mcpExecutor();
    const bad = {
      key: "u7:echo",
      serverType: "echo",
      fingerprint: "",
      launch: async () => ({
        transport: "stdio" as const,
        cmd: process.execPath,
        args: [path.join(path.dirname(FIXTURE), "missing-server.mjs")],
        env: {},
      }),
    };
    const err = await executor.callTool(bad, "echo", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpServiceError);
    expect((err as InstanceType<typeof McpServiceError>).code).toBe("tool-error");
  });
});

describe("AssertionVerifier", () => {
  it("refuses to run without caller keys", () => {
    expect(new AssertionVerifier(callerKeysFromEnv({})).configured).toBe(false);
    expect(new AssertionVerifier(callerKeysFromEnv({ CLAW_SERVICE_PUBLIC_KEYS: "not json" })).configured).toBe(false);
  });

  it("loads each caller from its own env var and can be narrowed", () => {
    const keys = JSON.stringify({ k: PUBLIC_PEM });
    const both = callerKeysFromEnv({ CLAW_SERVICE_PUBLIC_KEYS: keys, CLAW_ENCRYPTION_PUBLIC_KEYS: keys });
    expect([...both.keys()].sort()).toEqual(["xyne-claw-auth", "xyne-claw-encryption"]);
    const encOnly = callerKeysFromEnv({
      CLAW_SERVICE_PUBLIC_KEYS: keys,
      CLAW_ENCRYPTION_PUBLIC_KEYS: keys,
      MCP_ALLOWED_CALLERS: "xyne-claw-encryption",
    });
    expect([...encOnly.keys()]).toEqual(["xyne-claw-encryption"]);
  });
});
