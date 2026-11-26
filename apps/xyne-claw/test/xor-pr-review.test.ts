import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

process.env["XOR_URL"] = "http://xor.test/v1/decisions";
process.env["XOR_API_KEY"] = "test-key";

const { buildXorPrReviewTool, formatOutcome, parseReviewRules, reviewFiles, rulesFor } = await import("../src/xor-pr-review.js");
type Rule = ReturnType<typeof parseReviewRules>[number];

const skill = readFileSync(new URL("../skills/code-reviewer.md", import.meta.url), "utf8");
const rules = parseReviewRules(skill);

const file = (path: string, hunks = "@@ -1 +1 @@\n-a\n+b") => ({
  path,
  status: "modified" as const,
  isNewFile: false,
  insertions: 1,
  deletions: 1,
  hunks,
  history: [],
  testFiles: [],
});

describe("parseReviewRules", () => {
  it("reads every numbered rule of code-reviewer.md with its section and severity", () => {
    expect(rules.length).toBeGreaterThan(100);
    expect(rules[0]).toMatchObject({ id: "R1", section: "Security", severity: "Critical" });
    expect(rules[0]!.text).toMatch(/whereExists membership check/);
    expect(rules.find((r) => r.id === "R17")).toMatchObject({ section: "Database", severity: "Critical" });
    expect(new Set(rules.map((r) => r.section))).toEqual(new Set(["Security", "Database", "Error Handling", "Performance", "Concurrency", "API", "Frontend", "Testing", "General"]));
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });
});

describe("parseReviewRules on the xyne-spaces-review-guidelines layout", () => {
  const md = [
    "## Intensity Scale",
    "| 🔴 5 — Critical | Will cause bugs |",
    "## Security",
    "1. **[🔴 Critical]** Add a whereExists check.",
    "## Security — SAST Hardening Rules (SEC-INT-2026-06)",
    "### Secrets, config & fail-closed startup",
    "S4. **[🔴 Critical]** Validate security-critical config at boot.",
    "## Architecture & Layering *(NEW SECTION)*",
    "56. **[🟠 High]** Place auth checks in middleware.",
    "## Frontend",
    "137. **[🔴 Critical]** Attach the full event handler.",
    "## General",
    "306. [🔴 Critical] Prevent SSRF.",
  ].join("\n");
  it("reads ## and ### sections, S-prefixed ids and unbolded severities", () => {
    expect(parseReviewRules(md).map((r) => [r.id, r.section, r.severity])).toEqual([
      ["R1", "Security", "Critical"],
      ["S4", "Secrets, config & fail-closed startup", "Critical"],
      ["R56", "Architecture & Layering", "High"],
      ["R137", "Frontend", "Critical"],
      ["R306", "General", "Critical"],
    ]);
    expect(rulesFor("apps/backend/src/x.ts", parseReviewRules(md)).map((r) => r.id)).toEqual(["R1", "S4", "R56", "R306"]);
  });
});

describe("rulesFor", () => {
  const sections = (path: string) => new Set(rulesFor(path, rules).map((r) => r.section));
  it("asks Frontend rules only of UI files, Database rules only of data files, Testing rules only of tests", () => {
    expect(sections("apps/dashboard/src/x.tsx").has("Frontend")).toBe(true);
    expect(sections("apps/backend/src/services/x.ts").has("Frontend")).toBe(false);
    expect(sections("apps/backend/src/services/x.ts").has("Database")).toBe(false);
    expect(sections("apps/backend/prisma/migrations/1/migration.sql").has("Database")).toBe(true);
    expect(sections("apps/backend/src/repositories/userRepository.ts").has("Database")).toBe(true);
    expect(sections("apps/backend/src/x.test.ts").has("Testing")).toBe(true);
    expect(sections("apps/backend/src/x.ts").has("Security")).toBe(true);
  });
});

describe("reviewFiles", () => {
  it("asks each applicable rule per file and keeps the answers over the threshold, most severe first", async () => {
    const asked: Array<{ state: string; ids: string[] }> = [];
    const ask = async (req: { state: string; questions: Record<string, unknown> }) => {
      const ids = Object.keys(req.questions);
      asked.push({ state: req.state, ids });
      if (req.state.includes("broken.ts")) return null;
      return Object.fromEntries(ids.map((id) => [id, { type: "noul", noul: id === "R53" ? 0.92 : id === "R4" ? 0.75 : id === "R54" ? 0.69 : 0.1 }]));
    };
    const out = await reviewFiles(
      [file("apps/backend/src/services/a.ts"), file("apps/backend/src/broken.ts"), file("README.md"), file("apps/backend/src/empty.ts", "")],
      rules,
      { skill: "code-reviewer", baseRef: "origin/main", threshold: 0.7, ask: ask as never },
    );
    expect(out.files).toEqual(["apps/backend/src/services/a.ts", "apps/backend/src/broken.ts"]);
    expect(out.skipped).toEqual(["README.md", "apps/backend/src/empty.ts"]);
    expect(out.violations.map((v) => [v.rule.id, v.file])).toEqual([
      ["R53", "apps/backend/src/services/a.ts"],
      ["R4", "apps/backend/src/services/a.ts"],
    ]);
    expect(out.unavailable).toBeGreaterThan(0);
    // Per-file tally: every applicable rule is either passed or violated; a failed call leaves its rules unchecked.
    const a = out.perFile.find((f) => f.file === "apps/backend/src/services/a.ts")!;
    const applicable = rulesFor("apps/backend/src/services/a.ts", rules).length;
    expect(a).toMatchObject({ checked: applicable, passed: applicable - 2, unchecked: 0, calls: Math.ceil(applicable / 40) });
    expect(a.violations.map((v) => v.rule.id)).toEqual(["R53", "R4"]);
    const broken = out.perFile.find((f) => f.file === "apps/backend/src/broken.ts")!;
    expect(broken).toMatchObject({ checked: 0, passed: 0, unchecked: rulesFor("apps/backend/src/broken.ts", rules).length });
    // Every call carries at most 40 rules and the file's diff as the state.
    expect(asked.every((a) => a.ids.length <= 40 && a.state.includes("Diff:\n@@"))).toBe(true);
    const askedForA = asked.filter((a) => a.state.includes("a.ts")).flatMap((a) => a.ids);
    expect(new Set(askedForA)).toEqual(new Set(rulesFor("apps/backend/src/services/a.ts", rules).map((r: Rule) => r.id)));
    expect(formatOutcome(out)).toMatch(/2 likely violation\(s\):\n- \[Critical\] R53 \(Error Handling\) apps\/backend\/src\/services\/a\.ts — p=0\.92/);
  });
});

describe("the tool", () => {
  const run = (tool: ReturnType<typeof buildXorPrReviewTool>, params: Record<string, unknown>) =>
    (tool.execute as (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }>)("call-1", params).then((r) => r.content[0]!.text);

  it("reads the bundled code-reviewer skill when the run hasn't loaded one, and needs a sandbox", async () => {
    const tool = buildXorPrReviewTool({}, [], { session: () => undefined });
    expect(await run(tool, {})).toMatch(/no sandbox in this run/);
  });

  it("names the skills it has when the one asked for is missing", async () => {
    const tool = buildXorPrReviewTool({}, [{ slug: "team-rules", name: "Team rules", content: "1. **[🔴 Critical]** x" }], { session: () => undefined });
    expect(await run(tool, { skill: "nope" })).toMatch(/no skill named "nope" \(loaded in this run: team-rules\)/);
    expect(await run(tool, { skill: "team-rules" })).toMatch(/no sandbox/);
  });
});
