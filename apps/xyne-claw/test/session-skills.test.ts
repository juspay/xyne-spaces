import { test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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

test("keeps uploaded skills with colliding declared names distinct and writes their references", async () => {
  const { writeSessionSkills } = await import("../src/session-skills.js");
  const dir = await writeSessionSkills("scope-collision", [
    {
      slug: "xyne-lens",
      name: "Xyne Lens Guide",
      content: "---\nname: xyne-lens\ndescription: Core guide\n---\n\ncore",
    },
    {
      slug: "xyne-lens-skill",
      name: "Xyne Lens Skill",
      content: "---\nname: xyne-lens\ndescription: Uploaded reference library\n---\n\nlibrary",
      files: [
        { relativePath: "references/scene-catalog.md", content: "catalog" },
        { relativePath: "agents/openai.yaml", content: "model: gpt-5", contentType: "application/x-yaml" },
      ],
    },
  ]);

  expect(dir).toBeTruthy();
  const uploadedDir = join(dir!, "xyne-lens-skill");
  expect(readFileSync(join(uploadedDir, "SKILL.md"), "utf8")).toContain("name: xyne-lens-skill");
  expect(readFileSync(join(uploadedDir, "references", "scene-catalog.md"), "utf8")).toBe("catalog");
  expect(readFileSync(join(uploadedDir, "agents", "openai.yaml"), "utf8")).toBe("model: gpt-5");
});
