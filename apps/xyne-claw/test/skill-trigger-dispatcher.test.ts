import { describe, it, expect } from "vitest";
import {
  resolveTriggers,
  matchTrigger,
  formatSkillInjection,
  formatCombinedInjection,
  sortTriggers,
  normalizeMatchMode,
  type RawSkillTrigger,
} from "../src/skill-trigger-dispatcher.js";

const skills = [
  { name: "frontend-design-skill", content: "Use the design system. Prefer inline CSS." },
  { name: "incident-response", content: "Page the on-call and preserve logs." },
];

const rawTrigger = (overrides: Partial<RawSkillTrigger> = {}): RawSkillTrigger => ({
  toolName: "create_html_report",
  skillSlug: "frontend-design-skill",
  when: "after",
  ...overrides,
});

const resolvedTrigger = (overrides: Partial<ReturnType<typeof resolveTriggers>[number]> = {}) => ({
  toolName: "create_html_report",
  skillSlug: "frontend-design-skill",
  skillContent: skills[0]!.content,
  when: "after" as const,
  matchMode: "suffix" as const,
  ...overrides,
});

describe("normalizeMatchMode", () => {
  it("defaults unknown values to suffix", () => {
    expect(normalizeMatchMode(undefined)).toBe("suffix");
    expect(normalizeMatchMode("")).toBe("suffix");
    expect(normalizeMatchMode("wildcard")).toBe("suffix");
  });

  it("preserves supported values", () => {
    expect(normalizeMatchMode("exact")).toBe("exact");
    expect(normalizeMatchMode("prefix")).toBe("prefix");
    expect(normalizeMatchMode("contains")).toBe("contains");
    expect(normalizeMatchMode("suffix")).toBe("suffix");
  });
});

describe("resolveTriggers", () => {
  it("resolves a valid trigger", () => {
    const result = resolveTriggers([rawTrigger()], skills);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      toolName: "create_html_report",
      skillSlug: "frontend-design-skill",
      skillContent: skills[0]!.content,
      when: "after",
      matchMode: "suffix",
    });
  });

  it("drops triggers whose skill is missing", () => {
    const logs: string[] = [];
    const result = resolveTriggers([rawTrigger({ skillSlug: "missing-skill" })], skills, { log: (m) => logs.push(m) });
    expect(result).toHaveLength(0);
    expect(logs.some((m) => m.includes("missing-skill"))).toBe(true);
  });

  it("filters triggers missing toolName or skillSlug", () => {
    const result = resolveTriggers(
      [rawTrigger({ toolName: "" }), rawTrigger({ skillSlug: "" })],
      skills,
    );
    expect(result).toHaveLength(0);
  });

  it("normalizes before/after", () => {
    const result = resolveTriggers([rawTrigger({ when: "before" })], skills);
    expect(result[0]?.when).toBe("before");
  });
});

describe("matchTrigger", () => {
  it("matches exact names only when exact mode is set", () => {
    expect(matchTrigger("create_html_report", resolvedTrigger({ matchMode: "exact" }))).toBe(true);
    expect(matchTrigger("create_html_report_v2", resolvedTrigger({ matchMode: "exact" }))).toBe(false);
  });

  it("matches suffixes", () => {
    expect(matchTrigger("my_create_html_report", resolvedTrigger({ matchMode: "suffix" }))).toBe(true);
    expect(matchTrigger("create_html_report_v2", resolvedTrigger({ matchMode: "suffix" }))).toBe(false);
  });

  it("matches prefixes", () => {
    expect(matchTrigger("bitbucket__create_pull_request", resolvedTrigger({ toolName: "bitbucket", matchMode: "prefix" }))).toBe(true);
    expect(matchTrigger("github__create_pull_request", resolvedTrigger({ toolName: "bitbucket", matchMode: "prefix" }))).toBe(false);
  });

  it("matches contains", () => {
    expect(matchTrigger("foo_bar_baz", resolvedTrigger({ toolName: "bar", matchMode: "contains" }))).toBe(true);
    expect(matchTrigger("foo_baz", resolvedTrigger({ toolName: "bar", matchMode: "contains" }))).toBe(false);
  });
});

describe("formatSkillInjection", () => {
  it("includes skill slug, prompt, and content", () => {
    const text = formatSkillInjection(resolvedTrigger({ prompt: "Be concise." }));
    expect(text).toContain("frontend-design-skill");
    expect(text).toContain("Be concise.");
    expect(text).toContain(skills[0]!.content);
  });

  it("omits prompt when absent", () => {
    const text = formatSkillInjection(resolvedTrigger());
    expect(text).not.toContain("undefined");
    expect(text).toContain(skills[0]!.content);
  });
});

describe("formatCombinedInjection", () => {
  it("deduplicates by skill slug", () => {
    const triggers = [
      resolvedTrigger(),
      resolvedTrigger({ toolName: "other_tool" }),
    ];
    const text = formatCombinedInjection(triggers);
    expect(text).toContain("frontend-design-skill");
    // Should only appear once because both triggers reference the same skill slug
    expect(text.split("frontend-design-skill").length).toBe(2);
  });

  it("combines multiple distinct skills", () => {
    const triggers = [
      resolvedTrigger(),
      resolvedTrigger({
        toolName: "page_oncall",
        skillSlug: "incident-response",
        skillContent: skills[1]!.content,
      }),
    ];
    const text = formatCombinedInjection(triggers);
    expect(text).toContain("frontend-design-skill");
    expect(text).toContain("incident-response");
  });
});

describe("sortTriggers", () => {
  it("orders exact before prefix before suffix before contains", () => {
    const triggers = [
      resolvedTrigger({ matchMode: "contains" }),
      resolvedTrigger({ matchMode: "exact" }),
      resolvedTrigger({ matchMode: "suffix" }),
      resolvedTrigger({ matchMode: "prefix" }),
    ];
    const sorted = sortTriggers(triggers);
    expect(sorted.map((t) => t.matchMode)).toEqual(["exact", "prefix", "suffix", "contains"]);
  });
});
