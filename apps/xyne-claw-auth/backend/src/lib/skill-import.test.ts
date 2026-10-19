import { beforeEach, describe, expect, it, vi } from "vitest";

// GitHub is faked at safeFetch: the repo API answers `defaultBranch`, commits a fixed SHA,
// the tree API answers from `files`, raw.githubusercontent.com with the bytes.
const SHA = "a".repeat(40);
let defaultBranch = "main";
let files: Record<string, string | Uint8Array> = {};
let treeTruncated = false;
const fetched: string[] = [];
vi.mock("./safe-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./safe-fetch.js")>();
  return {
    ...actual,
    safeFetch: vi.fn(async (url: string, _init?: unknown, opts?: { maxResponseBytes?: number }) => {
      fetched.push(url);
      if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(url)) {
        return new Response(JSON.stringify({ default_branch: defaultBranch }), { status: 200 });
      }
      if (url.includes("/commits/")) return new Response(SHA, { status: 200 });
      if (url.includes("/git/trees/")) {
        const tree = Object.entries(files).map(([path, content]) => ({
          path,
          type: "blob",
          size: typeof content === "string" ? Buffer.byteLength(content) : content.length,
        }));
        return new Response(JSON.stringify({ tree, truncated: treeTruncated }), { status: 200 });
      }
      const path = decodeURIComponent(url.split("/abc123/")[1] ?? "");
      const content = files[path];
      if (content === undefined) return new Response("", { status: 404 });
      const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
      if (opts?.maxResponseBytes && bytes.length > opts.maxResponseBytes) {
        throw new actual.SafeFetchError("too large", "response-too-large", url);
      }
      return new Response(bytes, { status: 200 });
    }),
  };
});

const {
  discoverSkills,
  listRepoTree,
  parseSkillsShTop,
  parseSkillSourceUrl,
  readSkillFiles,
  renameSkillContent,
  resolveSkillSource,
  skillFileStats,
} = await import("./skill-import.js");

const skillMd = (name: string, extra = "") => `---\nname: ${name}\ndescription: does ${name}\n${extra}---\n\n# ${name}\n`;

async function repo(next: Record<string, string | Uint8Array>) {
  files = next;
  return listRepoTree("o", "skills", "abc123");
}

beforeEach(() => {
  files = {};
  treeTruncated = false;
  defaultBranch = "main";
  fetched.length = 0;
});

describe("skill import", () => {
  it("discovers skills like the skills package", async () => {
    const entries = await repo({
      "README.md": "x",
      "skills/grilling/SKILL.md": skillMd("grilling"),
      "skills/grilling/nested/SKILL.md": skillMd("nested"),
      "skills/tdd/SKILL.md": skillMd("tdd"),
      "skills/hidden/SKILL.md": skillMd("hidden", "metadata:\n  internal: true\n"),
      "skills/broken/SKILL.md": "no frontmatter",
      "examples/demo/SKILL.md": skillMd("demo"),
      "node_modules/x/SKILL.md": skillMd("x"),
    });
    expect((await discoverSkills(entries, "")).map((s) => s.name)).toEqual(["tdd", "grilling"]);
    expect((await discoverSkills(entries, "examples")).map((s) => s.path)).toEqual(["examples/demo"]);
    expect((await discoverSkills(entries, "skills/tdd")).map((s) => s.path)).toEqual(["skills/tdd"]);
  });

  it("reads sibling files, base64 for binary, and flags oversize files", async () => {
    const entries = await repo({
      "a/SKILL.md": skillMd("a"),
      "a/ref/format.md": "text",
      "a/logo.png": new Uint8Array([0x89, 0x50, 0x00, 0xff]),
      "b/SKILL.md": skillMd("b"),
      "b/big.txt": "x".repeat(1_000_001),
    });
    const a = await readSkillFiles(entries, "a");
    expect(a.error).toBeUndefined();
    expect(a.files).toEqual([
      { relativePath: "ref/format.md", content: "text", contentType: "text/plain" },
      { relativePath: "logo.png", content: "iVAA/w==", contentType: "application/octet-stream" },
    ]);
    expect((await readSkillFiles(entries, "b")).error).toBe("big.txt is over the 1 MB file limit");
  });

  it("fetches only picked SKILL.md files and one skill's folder, skipping oversize files unfetched", async () => {
    const entries = await repo({
      "skills/a/SKILL.md": skillMd("a"),
      "skills/a/ref.md": "text",
      "skills/b/SKILL.md": skillMd("b"),
      "skills/b/big.txt": "x".repeat(1_000_001),
      "docs/huge.bin": "x".repeat(2_000_000),
    });
    fetched.length = 0;
    await discoverSkills(entries, "");
    expect(fetched.map((url) => url.split("/abc123/")[1])).toEqual(["skills/a/SKILL.md", "skills/b/SKILL.md"]);
    fetched.length = 0;
    expect((await readSkillFiles(entries, "skills/b")).error).toBe("big.txt is over the 1 MB file limit");
    expect(fetched).toEqual([]);
    expect(skillFileStats(entries, "skills/a")).toEqual({ fileCount: 1, sizeBytes: 4 });
  });

  it("refuses a repo with over 200 skills before fetching any", async () => {
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`skills/s${i}/SKILL.md`, skillMd(`s${i}`)]));
    const entries = await repo(many);
    fetched.length = 0;
    await expect(discoverSkills(entries, "")).rejects.toThrow(
      "Repo has over 200 skills. Paste a link to one skill folder (github.com/o/skills/tree/<branch>/<path>).",
    );
    expect(fetched).toEqual([]);
  });

  it("caps a skill at 100 files and refuses a truncated tree", async () => {
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`a/f${i}.md`, "x"]));
    const entries = await repo({ "a/SKILL.md": skillMd("a"), ...many });
    expect((await readSkillFiles(entries, "a")).error).toBe("Skill has over 100 files");
    treeTruncated = true;
    await expect(listRepoTree("o", "skills", "abc123")).rejects.toThrow("Repo is too big to list.");
  });

  it("parses links and renames only the frontmatter name", () => {
    expect(parseSkillSourceUrl("mattpocock/skills")).toEqual({ owner: "mattpocock", repo: "skills", treeSegments: [] });
    expect(parseSkillSourceUrl("https://github.com/A/B.git/")).toEqual({ owner: "a", repo: "b", treeSegments: [] });
    expect(parseSkillSourceUrl("https://github.com/a/b/tree/feat/x/skills/tdd").treeSegments).toEqual([
      "feat", "x", "skills", "tdd",
    ]);
    expect(parseSkillSourceUrl("https://www.skills.sh/vercel-labs/skills/find-skills")).toEqual({
      owner: "vercel-labs", repo: "skills", treeSegments: [], skill: "find-skills",
    });
    expect(parseSkillSourceUrl("skills.sh/vercel-labs/skills")).toEqual({
      owner: "vercel-labs", repo: "skills", treeSegments: [],
    });
    expect(() => parseSkillSourceUrl("https://gitlab.com/a/b")).toThrow("Paste a github.com repo or a skills.sh link.");
    expect(() => parseSkillSourceUrl("https://github.com/a/b/blob/main/x")).toThrow();
    expect(() => parseSkillSourceUrl(`https://github.com/a/b/tree/main/${"x/".repeat(18)}`)).toThrow("Link is too long.");
    expect(renameSkillContent(skillMd("grilling") + "\nname: keep\n", "grilling-mp")).toBe(
      skillMd("grilling").replace("name: grilling", "name: grilling-mp") + "\nname: keep\n",
    );
  });

  it("resolves only default-branch links, in at most 2 GitHub calls", async () => {
    defaultBranch = "feat/x";
    await expect(resolveSkillSource(parseSkillSourceUrl("github.com/o/r/tree/feat/x/skills/tdd"))).resolves.toEqual({
      sha: SHA,
      subpath: "skills/tdd",
    });
    expect(fetched).toEqual(["https://api.github.com/repos/o/r", "https://api.github.com/repos/o/r/commits/feat/x"]);
    fetched.length = 0;
    await expect(resolveSkillSource(parseSkillSourceUrl("github.com/o/r/tree/feat/y/skills"))).rejects.toThrow(
      "Only the repo's default branch (feat/x) can be imported.",
    );
    expect(fetched).toEqual(["https://api.github.com/repos/o/r"]);
  });

  it("reads the skills.sh leaderboard: escaped entries, deduped, capped at 20, [] on garbage", () => {
    const entry = (source: string, skillId: string, installs: number) =>
      `\\"source\\":\\"${source}\\",\\"skillId\\":\\"${skillId}\\",\\"name\\":\\"${skillId}\\",\\"installs\\":${installs},\\"x\\":1`;
    const page = [
      entry("vercel-labs/skills", "find-skills", 3883644),
      entry("vercel-labs/skills", "find-skills", 3883644),
      ...Array.from({ length: 25 }, (_, i) => entry("o/r", `s${i}`, 100 - i)),
    ].join("},{");
    const rows = parseSkillsShTop(page);
    expect(rows).toHaveLength(20);
    expect(rows[0]).toEqual({ source: "vercel-labs/skills", skillId: "find-skills", name: "find-skills", installs: 3883644 });
    expect(rows[1]?.skillId).toBe("s0");
    expect(parseSkillsShTop("<html>Redirecting...</html>")).toEqual([]);
  });
});
