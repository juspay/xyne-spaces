import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REPO_CONFIGS } from "xyne-claw-shared";
import { fakeSandboxRepoConfigDb as db } from "./sandboxRepoConfigRepository.fake.js";

vi.mock("../db.js", async () => ({
  prisma: (await import("./sandboxRepoConfigRepository.fake.js")).fakeSandboxRepoConfigDb.prisma,
}));

const { repoConfigColumns, sandboxRepoConfigRepository: repo } = await import("./sandboxRepoConfigRepository.js");

const json = (value: unknown) => value as Prisma.InputJsonValue;
const base = { slug: "s", name: "n", description: "", defaultBranch: "main", workDir: "/w", steps: [] };
const aux = [{ name: "lib", url: "https://git.example.test/a/lib.git", defaultBranch: "main", workDir: "/w/lib" }];
const withRepos = { ...base, template: "tpl-a", repoUrl: "https://git.example.test/a/app.git", auxRepos: aux };
const noRepo = { ...base, template: "tpl-b" };
const BUILT_IN = "browser";
const builtIn = DEFAULT_REPO_CONFIGS[BUILT_IN]!;

/** The rule this change rests on: on every row the columns say what the JSON says. */
function expectColumnsToMatchJson(): void {
  for (const row of db.rows()) {
    expect({ key: row.key, template: row.template, repoUrl: row.repoUrl, auxRepos: row.auxRepos }).toEqual({
      key: row.key,
      ...repoConfigColumns(row.config),
    });
  }
}

const LEGACY_FIELDS = ["id", "key", "config", "enabled", "workspaceId", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt"];

beforeEach(() => db.reset());

describe("repoConfigColumns", () => {
  it("copies template, repoUrl and auxRepos", () => {
    expect(repoConfigColumns(withRepos)).toEqual({ template: "tpl-a", repoUrl: withRepos.repoUrl, auxRepos: aux });
  });

  it("gives null for a profile with no repoUrl and no auxRepos", () => {
    expect(repoConfigColumns(noRepo)).toEqual({ template: "tpl-b", repoUrl: null, auxRepos: null });
  });

  it("turns an empty-string repoUrl into null", () => {
    expect(repoConfigColumns({ ...noRepo, repoUrl: "" }).repoUrl).toBeNull();
  });

  it("keeps an empty auxRepos array as an array, and ignores anything that is not one", () => {
    expect(repoConfigColumns({ ...noRepo, auxRepos: [] }).auxRepos).toEqual([]);
    expect(repoConfigColumns({ ...noRepo, auxRepos: "lib", repoUrl: 7 })).toEqual({ template: "tpl-b", repoUrl: null, auxRepos: null });
  });

  it("refuses a config with no template", () => {
    for (const config of [base, { ...base, template: "" }, { ...base, template: 3 }, null, "tpl", [withRepos]]) {
      expect(() => repoConfigColumns(config)).toThrow("no template");
    }
  });

  it("works for every built-in, which the enabled toggle stores unvalidated", () => {
    for (const config of Object.values(DEFAULT_REPO_CONFIGS)) {
      expect(repoConfigColumns(config).template).toBe(config.template);
    }
  });
});

describe("every write stores the columns with the JSON", () => {
  it("create", async () => {
    const row = await repo.create("acme", json(withRepos), "ws_1", "user_1");
    expect(db.row("acme")).toMatchObject({ template: "tpl-a", repoUrl: withRepos.repoUrl, auxRepos: aux, workspaceId: "ws_1" });
    expect(Object.keys(row)).toEqual(LEGACY_FIELDS);
    expectColumnsToMatchJson();
  });

  it("upsert, on insert and on every later update", async () => {
    await repo.upsert("acme", json(withRepos), true, "user_1", { workspaceId: "ws_1" });
    expect(db.row("acme")).toMatchObject({ template: "tpl-a", repoUrl: withRepos.repoUrl, auxRepos: aux });
    expectColumnsToMatchJson();

    const updated = await repo.upsert("acme", json({ ...noRepo, repoUrl: "" }), true, "user_2");
    expect(db.row("acme")).toMatchObject({ template: "tpl-b", repoUrl: null, auxRepos: null, updatedByUserId: "user_2" });
    expect(db.row("acme")?.config).toMatchObject({ template: "tpl-b", repoUrl: "" });
    expect(Object.keys(updated)).toEqual(LEGACY_FIELDS);
    expectColumnsToMatchJson();
  });

  it("upsert of a built-in's code version, as the enabled toggle stores it", async () => {
    await repo.upsert(BUILT_IN, json(builtIn), false, "user_1");
    expect(db.row(BUILT_IN)).toMatchObject({ enabled: false, ...repoConfigColumns(builtIn) });
    expectColumnsToMatchJson();
  });

  it("setEnabled leaves config and columns alone", async () => {
    await repo.create("acme", json(withRepos), "ws_1", "user_1");
    const before = db.row("acme")!;
    await repo.setEnabled("acme", false, "user_2");
    expect(db.row("acme")).toMatchObject({ enabled: false, updatedByUserId: "user_2", config: before.config, template: before.template });
    expectColumnsToMatchJson();
  });

  it("the system copies start-up writes and refreshes", async () => {
    await repo.insertSystemCopies({ a: json(withRepos), b: json(noRepo) });
    expectColumnsToMatchJson();
    expect(await repo.refreshSystemCopy("a", json(noRepo))).toBe(true);
    expect(db.row("a")).toMatchObject({ template: "tpl-b", repoUrl: null, auxRepos: null });
    expectColumnsToMatchJson();
  });

  it("delete of a built-in's row, which puts the system copy back", async () => {
    await repo.upsert(BUILT_IN, json({ ...builtIn, template: "edited" }), true, "user_1");
    await repo.delete(BUILT_IN);
    expect(db.row(BUILT_IN)).toMatchObject(repoConfigColumns(builtIn));
    expectColumnsToMatchJson();
  });
});

describe("a system copy is no row to anything a person does", () => {
  beforeEach(async () => {
    await repo.insertSystemCopies({ [BUILT_IN]: json(builtIn) });
    await repo.create("acme", json(withRepos), "ws_1", "user_1");
    await repo.upsert("unowned", json(noRepo), true, "admin_1");
  });

  it("is a row nobody made, owned by nobody", () => {
    expect(db.row(BUILT_IN)).toMatchObject({ createdByUserId: null, updatedByUserId: null, workspaceId: null, enabled: true });
  });

  it("is hidden from list and find", async () => {
    expect((await repo.list()).map((row) => row.key)).toEqual(["acme", "unowned"]);
    expect(await repo.find(BUILT_IN)).toBeNull();
    expect((await repo.find("acme"))?.key).toBe("acme");
  });

  it("never shows as unowned and cannot be given to a workspace", async () => {
    expect(await repo.listUnowned()).toEqual([{ key: "unowned" }]);
    expect(await repo.listUnowned([BUILT_IN, "unowned"])).toEqual([{ key: "unowned" }]);
    expect(await repo.assignWorkspace([BUILT_IN, "unowned"], "ws_9")).toEqual({ count: 1 });
    expect(db.row(BUILT_IN)?.workspaceId).toBeNull();
    expect(db.row("unowned")?.workspaceId).toBe("ws_9");
  });

  it("cannot be switched or deleted: there is nothing of a person's to change", async () => {
    await expect(repo.setEnabled(BUILT_IN, false, "user_1")).rejects.toMatchObject({ code: "P2025" });
    await expect(repo.delete(BUILT_IN)).rejects.toMatchObject({ code: "P2025" });
    expect(db.rows().map((row) => row.key)).toEqual(["acme", BUILT_IN, "unowned"]);
    expect(db.row(BUILT_IN)).toMatchObject({ enabled: true, updatedByUserId: null });
  });

  it("is taken over by a person's first save as the insert it would have been", async () => {
    const copy = db.row(BUILT_IN)!;
    const row = await repo.upsert(BUILT_IN, json({ ...builtIn, template: "edited" }), true, "user_1");
    expect(row).toMatchObject({ key: BUILT_IN, enabled: true, workspaceId: null, createdByUserId: "user_1", updatedByUserId: "user_1" });
    expect(row.createdAt.getTime()).toBeGreaterThan(copy.createdAt.getTime());
    expect(Object.keys(row)).toEqual(LEGACY_FIELDS);
    expect(db.rows().filter((each) => each.key === BUILT_IN)).toHaveLength(1);
    expect(db.row(BUILT_IN)?.template).toBe("edited");
    expect((await repo.find(BUILT_IN))?.key).toBe(BUILT_IN);

    // A second save is an ordinary update: the creator stays.
    await repo.upsert(BUILT_IN, json(builtIn), true, "user_2", { workspaceId: "ws_ignored" });
    expect(db.row(BUILT_IN)).toMatchObject({ createdByUserId: "user_1", updatedByUserId: "user_2", workspaceId: null });
  });

  it("is taken over with the owner an insert would have had", async () => {
    await repo.upsert(BUILT_IN, json(builtIn), false, "admin_1", { workspaceId: "ws_1" });
    expect(db.row(BUILT_IN)).toMatchObject({ enabled: false, workspaceId: "ws_1", createdByUserId: "admin_1" });
  });

  it("is only ever an enabled row with no owner: anything else with no user on it is a person's", async () => {
    await repo.upsert("off-by-nobody", json(noRepo), false, null);
    await repo.upsert("owned-by-nobody", json(noRepo), true, null, { workspaceId: "ws_1" });
    expect((await repo.list()).map((row) => row.key)).toEqual(["acme", "off-by-nobody", "owned-by-nobody", "unowned"]);
    expect(await repo.listUnowned(["off-by-nobody"])).toEqual([{ key: "off-by-nobody" }]);
    expect(await repo.refreshSystemCopy("off-by-nobody", json(withRepos))).toBe(false);
    expect(await repo.refreshSystemCopy("owned-by-nobody", json(withRepos))).toBe(false);
    expect((await repo.listSystemCopies(["off-by-nobody", "owned-by-nobody", BUILT_IN])).map((row) => row.key)).toEqual([BUILT_IN]);
  });

  it("does not block a new profile when its key is no longer a built-in", async () => {
    // A copy outlives its built-in when the code stops defining that key (lotus without BITBUCKET_SSH_HOST).
    await repo.insertSystemCopies({ "was-built-in": json(noRepo) });
    expect(await repo.find("was-built-in")).toBeNull();
    const row = await repo.create("was-built-in", json(withRepos), "ws_2", "user_2");
    expect(row).toMatchObject({ workspaceId: "ws_2", createdByUserId: "user_2", updatedByUserId: "user_2", enabled: true });
    expect(db.rows().filter((each) => each.key === "was-built-in")).toHaveLength(1);
    expect(db.row("was-built-in")).toMatchObject({ template: "tpl-a", repoUrl: withRepos.repoUrl });
  });

  it("still refuses a key a person holds", async () => {
    await expect(repo.create("acme", json(noRepo), "ws_2", "user_2")).rejects.toMatchObject({ code: "P2002" });
    expect(db.row("acme")).toMatchObject({ workspaceId: "ws_1", template: "tpl-a" });
  });
});

describe("delete", () => {
  it("removes a workspace's profile for good", async () => {
    await repo.create("acme", json(withRepos), "ws_1", "user_1");
    expect(await repo.delete("acme")).toMatchObject({ key: "acme", enabled: true });
    expect(db.rows()).toEqual([]);
    await expect(repo.delete("acme")).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("returns a built-in's row as it was and leaves the system copy in its place", async () => {
    const edited = { ...builtIn, template: "edited" };
    await repo.upsert(BUILT_IN, json(edited), false, "user_1", { workspaceId: "ws_1" });
    const removed = await repo.delete(BUILT_IN);
    expect(removed).toMatchObject({ key: BUILT_IN, enabled: false, updatedByUserId: "user_1" });
    expect(removed.config).toMatchObject({ template: "edited" });
    expect(Object.keys(removed)).toEqual(LEGACY_FIELDS);
    expect(db.row(BUILT_IN)).toMatchObject({
      enabled: true,
      workspaceId: null,
      createdByUserId: null,
      updatedByUserId: null,
      template: builtIn.template,
    });
    expect(await repo.find(BUILT_IN)).toBeNull();
  });
});

describe("listByTemplate", () => {
  it("finds every profile on a template: system copies, people's rows and disabled ones", async () => {
    await repo.insertSystemCopies({ sys: json(withRepos) });
    await repo.create("mine", json({ ...withRepos, repoUrl: "" }), "ws_1", "user_1");
    await repo.upsert("off", json({ ...noRepo, template: "tpl-a" }), false, "user_1", { workspaceId: "ws_2" });
    await repo.create("other", json(noRepo), "ws_1", "user_1");

    expect(await repo.listByTemplate("tpl-a")).toEqual([
      { key: "mine", template: "tpl-a", repoUrl: null, auxRepos: aux, enabled: true, workspaceId: "ws_1" },
      { key: "off", template: "tpl-a", repoUrl: null, auxRepos: null, enabled: false, workspaceId: "ws_2" },
      { key: "sys", template: "tpl-a", repoUrl: withRepos.repoUrl, auxRepos: aux, enabled: true, workspaceId: null },
    ]);
    expect((await repo.listByTemplate("tpl-b")).map((row) => row.key)).toEqual(["other"]);
    expect(await repo.listByTemplate("nothing-uses-this")).toEqual([]);
  });
});
