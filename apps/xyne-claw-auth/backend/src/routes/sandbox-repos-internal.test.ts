import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

vi.mock("../config.js", () => ({ CONFIG: { xyneClawS2sKey: "claw-runtime-key" } }));

vi.mock("../lib/sandbox-repo-configs.js", () => ({
  loadEffectiveRepoConfigs: async () => ({
    "xyne-spaces": { repoUrl: "ssh://git@github.com/example-org/xyne-spaces.git" },
    torana: { repoUrl: "ssh://git@ssh.bitbucket.example.net/lp/torana.git" },
  }),
}));

const SPACES_KEY = "spaces-internal-key";
const CLAW_KEY = "claw-runtime-key";

describe("GET /internal/sandbox-repo-resolve", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    process.env["INTERNAL_S2S_KEY"] = SPACES_KEY;
    process.env["XYNE_CLAW_S2S_KEY"] = CLAW_KEY;
    const { requireInternalS2S } = await import("../middleware/require-auth.js");
    const { sandboxRepoResolveRouter } = await import("./sandbox-repos-internal.js");
    const { errorMiddleware } = await import("../lib/http.js");
    const app = express();
    app.use("/internal/sandbox-repo-resolve", requireInternalS2S, sandboxRepoResolveRouter);
    app.use(errorMiddleware);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/sandbox-repo-resolve`;
  });

  afterAll(() => {
    server?.close();
  });

  const call = (query: string, key?: string) =>
    fetch(`${base}${query}`, { headers: key ? { "x-s2s-key": key } : {} });

  it("returns the sandbox key to a caller holding the Spaces internal key", async () => {
    const res = await call(`?repoUrl=${encodeURIComponent("https://github.com/example-org/xyne-spaces.git")}`, SPACES_KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { sandboxKey?: string; sandboxKeys?: string[] } };
    expect(body.data?.sandboxKey).toBe("xyne-spaces");
    expect(body.data?.sandboxKeys).toEqual(["xyne-spaces"]);
  });

  it("rejects the claw runtime key and a missing key", async () => {
    const q = `?repoUrl=${encodeURIComponent("https://github.com/example-org/xyne-spaces")}`;
    expect((await call(q, CLAW_KEY)).status).toBe(401);
    expect((await call(q)).status).toBe(401);
    expect((await call(q, "wrong")).status).toBe(401);
  });

  it("answers 404 for an unknown repo and 400 without repoUrl", async () => {
    expect((await call(`?repoUrl=${encodeURIComponent("https://github.com/example-org/nope")}`, SPACES_KEY)).status).toBe(404);
    expect((await call("", SPACES_KEY)).status).toBe(400);
  });
});
