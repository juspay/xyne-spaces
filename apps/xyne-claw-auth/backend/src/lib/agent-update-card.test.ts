import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../repositories/index.js", () => ({ agentRepository: {} }));
vi.mock("../routes/tools.js", () => ({ buildAvailableToolsCatalog: vi.fn() }));

const { describeAgentUpdate } = await import("./agent-update-card.js");

const row = {
  name: "Release Notes",
  slug: "release-notes",
  description: "Writes release notes",
  systemPrompt: "You write release notes.\nKeep them short.",
  modelId: "claude-sonnet-5",
  color: null,
};

describe("describeAgentUpdate", () => {
  it("lists only the scalar fields that actually change", () => {
    const { changes, note } = describeAgentUpdate(row, {
      slug: "release-notes",
      name: "Release Notes",
      description: "Writes concise release notes",
      color: "#6366f1",
    });

    expect(changes).toEqual([
      { field: "description", label: "Description", before: "Writes release notes", after: "Writes concise release notes" },
      { field: "color", label: "Colour", after: "#6366f1" },
    ]);
    expect(note).toBeUndefined();
  });

  it("shows a full prompt replacement as before and after", () => {
    const { changes } = describeAgentUpdate(row, { slug: "release-notes", systemPrompt: "You write changelogs." });

    expect(changes).toEqual([
      { field: "systemPrompt", label: "System prompt", before: row.systemPrompt, after: "You write changelogs." },
    ]);
  });

  it("applies anchored prompt edits to compute the new prompt", () => {
    const { changes } = describeAgentUpdate(row, {
      slug: "release-notes",
      promptEdits: [{ oldText: "Keep them short.", newText: "Keep them under 200 words." }],
    });

    expect(changes[0]).toMatchObject({
      field: "systemPrompt",
      before: row.systemPrompt,
      after: "You write release notes.\nKeep them under 200 words.",
    });
  });

  it("reports a prompt edit that cannot apply instead of showing a change", () => {
    const { changes, note } = describeAgentUpdate(row, {
      slug: "release-notes",
      promptEdits: [{ oldText: "not in the prompt", newText: "x" }],
    });

    expect(changes).toEqual([]);
    expect(note).toContain("can't be applied");
  });

  it("shows tools added and removed by label and notes unknown ones", () => {
    const { changes, note } = describeAgentUpdate(
      row,
      { slug: "release-notes", tools: ["github", "web-search", "nope"] },
      {
        before: [
          { id: "spaces", label: "Spaces" },
          { id: "github", label: "GitHub" },
        ],
        after: [
          { id: "github", label: "GitHub" },
          { id: "web-search", label: "Web Search" },
        ],
        unknown: ["nope"],
      },
    );

    expect(changes).toEqual([{ field: "tools", label: "Tools", added: ["Web Search"], removed: ["Spaces"] }]);
    expect(note).toContain("nope");
  });

  it("omits a tools change that resolves to the same set", () => {
    const same = [{ id: "github", label: "GitHub" }];
    const { changes } = describeAgentUpdate(row, { slug: "release-notes", tools: ["github"] }, { before: same, after: same, unknown: [] });

    expect(changes).toEqual([]);
  });

  it("returns no changes when nothing differs", () => {
    expect(describeAgentUpdate(row, { slug: "release-notes", name: "Release Notes" }).changes).toEqual([]);
  });
});
