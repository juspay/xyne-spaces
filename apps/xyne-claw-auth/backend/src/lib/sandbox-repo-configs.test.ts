import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REPO_CONFIGS, type RepoConfigMap } from "xyne-claw-shared";
import { fakeSandboxRepoConfigDb as db } from "../repositories/sandboxRepoConfigRepository.fake.js";

const logged = vi.hoisted(() => ({ error: [] as unknown[][] }));

vi.mock("../db.js", async () => ({
  prisma: (await import("../repositories/sandboxRepoConfigRepository.fake.js")).fakeSandboxRepoConfigDb.prisma,
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: (...args: unknown[]) => logged.error.push(args), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const { sandboxRepoConfigRepository: repo } = await import("../repositories/index.js");
const { loadEffectiveRepoConfigs, sameRepoConfig, syncBuiltInRepoConfigs, syncBuiltInRepoConfigsAtBoot } = await import(
  "./sandbox-repo-configs.js"
);

describe("sameRepoConfig", () => {
  it("ignores key order and undefined fields, catches real edits", () => {
    const code = { name: "x", steps: [{ type: "run", cmd: "a" }], ports: { web: 3000 } };
    expect(sameRepoConfig(code, { ports: { web: 3000 }, steps: [{ cmd: "a", type: "run" }], name: "x", cwd: undefined })).toBe(true);
    expect(sameRepoConfig(code, { ...code, name: "y" })).toBe(false);
  });
});

describe("syncBuiltInRepoConfigs", () => {
  const json = (value: unknown) => value as Prisma.InputJsonValue;
  const base = { slug: "s", name: "n", description: "", defaultBranch: "main", workDir: "/w", steps: [] };
  const aux = [{ name: "lib", url: "https://git.example.test/a/lib.git", defaultBranch: "main", workDir: "/w/lib" }];
  const v1: RepoConfigMap = {
    app: { ...base, template: "tpl-app", repoUrl: "https://git.example.test/a/app.git", auxRepos: aux },
    // sessionTimeoutMs: undefined is what an optional field left out looks like in the code file.
    plain: { ...base, template: "tpl-plain", sessionTimeoutMs: undefined as unknown as number },
  };
  const v2: RepoConfigMap = {
    app: { ...base, template: "tpl-app-2", repoUrl: "https://git.example.test/a/app-moved.git" },
    plain: v1["plain"]!,
  };

  beforeEach(() => db.reset());

  it("inserts a copy of every built-in that has no row", async () => {
    expect(await syncBuiltInRepoConfigs(v1)).toEqual({ inserted: ["app", "plain"], refreshed: [] });
    expect(db.rows()).toMatchObject([
      { key: "app", template: "tpl-app", repoUrl: "https://git.example.test/a/app.git", auxRepos: aux, enabled: true },
      { key: "plain", template: "tpl-plain", repoUrl: null, auxRepos: null, enabled: true },
    ]);
    for (const row of db.rows()) {
      expect(row).toMatchObject({ createdByUserId: null, updatedByUserId: null, workspaceId: null });
      expect(sameRepoConfig(row.config, v1[row.key])).toBe(true);
    }
  });

  it("refreshes an untouched copy when the code version changed", async () => {
    await syncBuiltInRepoConfigs(v1);
    expect(await syncBuiltInRepoConfigs(v2)).toEqual({ inserted: [], refreshed: ["app"] });
    expect(db.row("app")).toMatchObject({
      template: "tpl-app-2",
      repoUrl: "https://git.example.test/a/app-moved.git",
      auxRepos: null,
      createdByUserId: null,
      updatedByUserId: null,
    });
    expect(sameRepoConfig(db.row("app")?.config, v2["app"])).toBe(true);
  });

  it("leaves a row a person edited", async () => {
    await syncBuiltInRepoConfigs(v1);
    await repo.upsert("app", json({ ...v1["app"], name: "edited" }), true, "user_1");
    const edited = db.row("app");
    expect(await syncBuiltInRepoConfigs(v2)).toEqual({ inserted: [], refreshed: [] });
    expect(db.row("app")).toEqual(edited);
  });

  it("leaves a built-in a person switched off, even with the code version in it", async () => {
    await syncBuiltInRepoConfigs(v1);
    await repo.upsert("app", json(v1["app"]), false, "user_1");
    const disabled = db.row("app");
    expect(await syncBuiltInRepoConfigs(v2)).toEqual({ inserted: [], refreshed: [] });
    expect(db.row("app")).toEqual(disabled);
    expect(db.row("app")).toMatchObject({ enabled: false, template: "tpl-app" });
  });

  it("leaves a row that existed before any copy was made", async () => {
    await repo.upsert("app", json({ ...v1["app"], name: "older override" }), true, "admin_1");
    const override = db.row("app");
    expect(await syncBuiltInRepoConfigs(v2)).toEqual({ inserted: ["plain"], refreshed: [] });
    expect(db.row("app")).toEqual(override);
  });

  it("follows the code again once a person's row is deleted", async () => {
    await syncBuiltInRepoConfigs(DEFAULT_REPO_CONFIGS);
    await repo.upsert("browser", json({ ...DEFAULT_REPO_CONFIGS["browser"], template: "edited" }), true, "user_1");
    await repo.delete("browser");
    const newer = { ...DEFAULT_REPO_CONFIGS, browser: { ...DEFAULT_REPO_CONFIGS["browser"]!, template: "tpl-next-release" } };
    expect((await syncBuiltInRepoConfigs(newer)).refreshed).toEqual(["browser"]);
    expect(db.row("browser")?.template).toBe("tpl-next-release");
  });

  it("writes nothing when run again", async () => {
    await syncBuiltInRepoConfigs(v1);
    const rows = db.rows();
    const writes = db.writes();
    expect(await syncBuiltInRepoConfigs(v1)).toEqual({ inserted: [], refreshed: [] });
    expect(await syncBuiltInRepoConfigs(v1)).toEqual({ inserted: [], refreshed: [] });
    expect(db.writes()).toBe(writes);
    expect(db.rows()).toEqual(rows);
  });

  it("does not change what loadEffectiveRepoConfigs returns for any workspace", async () => {
    await repo.create("acme", json({ ...base, template: "tpl-acme" }), "ws_1", "user_1");
    await repo.upsert("xyne-spaces", json({ ...DEFAULT_REPO_CONFIGS["xyne-spaces"], name: "edited" }), true, "admin_1");
    const scopes = [undefined, null, "ws_1", "ws_other"];
    const before = await Promise.all(scopes.map((scope) => loadEffectiveRepoConfigs(scope)));
    await syncBuiltInRepoConfigs();
    expect(db.row("browser")).toMatchObject({ updatedByUserId: null });
    expect(await Promise.all(scopes.map((scope) => loadEffectiveRepoConfigs(scope)))).toEqual(before);
  });

  it("at boot, logs a failure instead of throwing", async () => {
    const failing = vi.spyOn(repo, "insertSystemCopies").mockRejectedValueOnce(new Error("database is down"));
    logged.error.length = 0;
    await expect(syncBuiltInRepoConfigsAtBoot()).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(logged.error).toHaveLength(1);
    expect(String(logged.error[0]?.[1])).toContain("database is down");
    failing.mockRestore();
  });
});
