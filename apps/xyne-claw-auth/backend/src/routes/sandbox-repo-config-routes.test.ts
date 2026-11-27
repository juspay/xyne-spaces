import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REPO_CONFIGS } from "xyne-claw-shared";
import { fakeSandboxRepoConfigDb as db } from "../repositories/sandboxRepoConfigRepository.fake.js";

/**
 * The admin and Spaces routes over a table that holds a system copy of every built-in. Each answer
 * must be the one the routes gave when the table held no row for an untouched built-in.
 */

const audits = vi.hoisted(() => [] as Array<{ description: string; metadata?: Record<string, unknown> }>);

vi.mock("../db.js", async () => ({
  prisma: (await import("../repositories/sandboxRepoConfigRepository.fake.js")).fakeSandboxRepoConfigDb.prisma,
}));
vi.mock("../lib/audit.js", () => ({
  writeAuditLog: vi.fn(async (entry: { description: string; metadata?: Record<string, unknown> }) => {
    audits.push(entry);
  }),
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const BUILT_IN = "browser";
const builtIn = DEFAULT_REPO_CONFIGS[BUILT_IN]!;
const builtInKeys = Object.keys(DEFAULT_REPO_CONFIGS).sort();
const WS = "ws_1";
const actor = { workspaceId: WS, actorUserId: "user_1" };
const profile = { slug: "s", name: "Acme", description: "", defaultBranch: "main", workDir: "/w", steps: [], template: "tpl-acme" };
const ROW_FIELDS = ["id", "key", "config", "enabled", "workspaceId", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt"];
const SYSTEM_COPY = { enabled: true, workspaceId: null, createdByUserId: null, updatedByUserId: null, template: builtIn.template };

let server: Server;
let base = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-user-id": "admin_1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await res.json()) as { data?: unknown };
  return { status: res.status, data: payload.data ?? payload };
}

const adminList = async () => (await call("GET", "/admin")).data as Array<Record<string, unknown>>;
const profiles = async () => (await call("GET", `/profiles?workspaceId=${WS}`)).data as Array<Record<string, unknown>>;

beforeAll(async () => {
  const { adminSandboxReposRouter } = await import("./admin-sandbox-repos.js");
  const { sandboxProfilesInternalRouter } = await import("./sandbox-profiles-internal.js");
  const { errorMiddleware } = await import("../lib/http.js");
  const app = express();
  app.use(express.json());
  app.use("/admin", adminSandboxReposRouter);
  app.use("/profiles", sandboxProfilesInternalRouter);
  app.use(errorMiddleware);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

beforeEach(async () => {
  db.reset();
  audits.length = 0;
  const { syncBuiltInRepoConfigs } = await import("../lib/sandbox-repo-configs.js");
  await syncBuiltInRepoConfigs();
});

describe("with only system copies in the table", () => {
  it("has a row for every built-in", () => {
    expect(db.rows().map((row) => row.key)).toEqual(builtInKeys);
  });

  it("the admin list still reports every built-in as the code default", async () => {
    const list = await adminList();
    expect(list.map((row) => row["key"])).toEqual(builtInKeys);
    for (const row of list) {
      expect(row).toMatchObject({ source: "default", hasDefault: true, enabled: true, active: true, updatedAt: null, updatedByUserId: null, workspaceId: null });
    }
  });

  it("the profile list still reports every built-in as on and not overridden", async () => {
    for (const row of await profiles()) {
      expect(row).toMatchObject({ builtIn: true, enabled: true, overridden: false, workspaceId: null, createdByUserId: null });
    }
  });

  it("assign-workspace finds nothing to assign, and admin delete finds no stored config", async () => {
    expect((await call("POST", "/admin/assign-workspace", { workspaceId: WS, dryRun: false })).data).toEqual({ dryRun: false, workspaceId: WS, keys: [] });
    expect((await call("DELETE", `/admin/${BUILT_IN}`)).status).toBe(404);
    expect(db.row(BUILT_IN)).toMatchObject(SYSTEM_COPY);
  });

  it("a workspace still cannot take a built-in's key", async () => {
    const taken = await call("PUT", `/profiles/${BUILT_IN}`, { ...actor, create: true, config: profile });
    expect(taken.status).toBe(409);
    expect(db.row(BUILT_IN)).toMatchObject(SYSTEM_COPY);
  });
});

describe("switching a built-in off and on", () => {
  it("off stores the code version as a person's row; on hands the row back", async () => {
    const off = await call("POST", `/profiles/${BUILT_IN}/enabled`, { ...actor, enabled: false });
    expect(off.status).toBe(200);
    expect(Object.keys(off.data)).toEqual(ROW_FIELDS);
    expect(off.data).toMatchObject({ key: BUILT_IN, enabled: false, workspaceId: null, createdByUserId: "user_1", updatedByUserId: "user_1" });
    expect(db.row(BUILT_IN)).toMatchObject({ enabled: false, template: builtIn.template, repoUrl: null, auxRepos: null });
    expect((await adminList()).find((row) => row["key"] === BUILT_IN)).toMatchObject({ source: "database", enabled: false, active: false });
    expect((await profiles()).find((row) => row["key"] === BUILT_IN)).toMatchObject({ enabled: false, overridden: false });

    const on = await call("POST", `/profiles/${BUILT_IN}/enabled`, { ...actor, enabled: true });
    expect(on).toEqual({ status: 200, data: { key: BUILT_IN, enabled: true } });
    expect(db.row(BUILT_IN)).toMatchObject(SYSTEM_COPY);
    expect((await adminList()).find((row) => row["key"] === BUILT_IN)).toMatchObject({ source: "default", enabled: true, active: true });
  });

  it("an edited built-in keeps its edit through off and on", async () => {
    const edited = { ...builtIn, name: "Edited browser" };
    await call("PUT", `/profiles/${BUILT_IN}`, { ...actor, config: edited });
    await call("POST", `/profiles/${BUILT_IN}/enabled`, { ...actor, enabled: false });
    const on = await call("POST", `/profiles/${BUILT_IN}/enabled`, { ...actor, enabled: true });
    expect(on.data).toMatchObject({ key: BUILT_IN, enabled: true, updatedByUserId: "user_1" });
    expect((await profiles()).find((row) => row["key"] === BUILT_IN)).toMatchObject({ enabled: true, overridden: true });
    expect(db.row(BUILT_IN)?.config).toMatchObject({ name: "Edited browser" });
  });
});

describe("editing a built-in and going back to the code version", () => {
  const edited = { ...builtIn, template: "tpl-edited", repoUrl: "https://git.example.test/a/b.git" };

  it("an edit takes the system copy over; reset puts it back", async () => {
    const saved = await call("PUT", `/profiles/${BUILT_IN}`, { ...actor, config: edited });
    expect(Object.keys(saved.data)).toEqual(ROW_FIELDS);
    expect(saved.data).toMatchObject({ enabled: true, createdByUserId: "user_1", updatedByUserId: "user_1", workspaceId: null });
    expect(db.row(BUILT_IN)).toMatchObject({ template: "tpl-edited", repoUrl: edited.repoUrl });
    expect((await profiles()).find((row) => row["key"] === BUILT_IN)).toMatchObject({ overridden: true });

    expect(await call("POST", `/profiles/${BUILT_IN}/reset`, { actorUserId: "user_1" })).toEqual({ status: 200, data: { key: BUILT_IN } });
    expect(db.row(BUILT_IN)).toMatchObject({ ...SYSTEM_COPY, repoUrl: null });
    expect((await profiles()).find((row) => row["key"] === BUILT_IN)).toMatchObject({ overridden: false, enabled: true });
    // Nothing of a person's is left, so a second reset has nothing to do.
    expect((await call("POST", `/profiles/${BUILT_IN}/reset`, { actorUserId: "user_1" })).status).toBe(200);
  });

  it("admin save audits no previous version; admin delete audits the one it removed", async () => {
    const saved = await call("PUT", `/admin/${BUILT_IN}`, { config: edited });
    expect(saved.data).toMatchObject({ createdByUserId: "admin_1", updatedByUserId: "admin_1", workspaceId: null });
    expect(audits.at(-1)?.metadata).toMatchObject({ before: null, after: { enabled: true } });

    const removed = await call("DELETE", `/admin/${BUILT_IN}`);
    expect(removed).toEqual({ status: 200, data: { key: BUILT_IN, revertedToDefault: true } });
    expect(audits.at(-1)?.metadata).toMatchObject({ before: { enabled: true, config: { template: "tpl-edited" } }, after: null });
    expect(db.row(BUILT_IN)).toMatchObject(SYSTEM_COPY);
    expect((await call("DELETE", `/admin/${BUILT_IN}`)).status).toBe(404);
  });
});

describe("a workspace's own profile", () => {
  it("is created, listed, switched and deleted as before", async () => {
    const created = await call("PUT", "/profiles/acme", { ...actor, create: true, config: profile });
    expect(Object.keys(created.data)).toEqual(ROW_FIELDS);
    expect(db.row("acme")).toMatchObject({ template: "tpl-acme", repoUrl: null, auxRepos: null, workspaceId: WS });
    expect((await call("PUT", "/profiles/acme", { ...actor, create: true, config: profile })).status).toBe(409);

    await call("POST", "/profiles/acme/enabled", { ...actor, enabled: false });
    expect((await profiles()).find((row) => row["key"] === "acme")).toMatchObject({ enabled: false, builtIn: false, workspaceId: WS });
    expect((await adminList()).find((row) => row["key"] === "acme")).toMatchObject({ source: "database", hasDefault: false, active: false });

    expect((await call("DELETE", "/admin/acme")).data).toEqual({ key: "acme", revertedToDefault: false });
    expect(db.row("acme")).toBeUndefined();
  });
});
