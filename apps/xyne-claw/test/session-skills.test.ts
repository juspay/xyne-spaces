import { test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dataDir: string;
beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "skills-"));
  process.env["XYNE_CLAW_DATA_DIR"] = dataDir; // config reads this at module load
});
afterAll(async () => { await rm(dataDir, { recursive: true, force: true }); });

test("writeSessionSkills materializes a scope dir; deleteSessionSkills removes it", async () => {
  const { writeSessionSkills, deleteSessionSkills } = await import("../src/session-skills.js");
  const dir = await writeSessionSkills("scope-1", [{ name: "Foo", content: "do foo" }]);
  expect(dir).toBeTruthy();
  expect(existsSync(dir!)).toBe(true);

  await deleteSessionSkills("scope-1");
  expect(existsSync(dir!)).toBe(false);
});

test("deleteSessionSkills on a missing/empty scope is a safe no-op", async () => {
  const { deleteSessionSkills } = await import("../src/session-skills.js");
  await expect(deleteSessionSkills("does-not-exist")).resolves.toBeUndefined();
  await expect(deleteSessionSkills("")).resolves.toBeUndefined();
});
