import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({ CONFIG: {} }));
vi.mock("./spaces-db.js", () => ({}));
vi.mock("../mcp/servers/xyne-spaces-client.js", () => ({}));

const { renderSdlcHubKnowledge } = await import("./sdlc-repository-context.js");

describe("renderSdlcHubKnowledge", () => {
  it("gives pinned items in full and lists the other files by canvasId", () => {
    const text = renderSdlcHubKnowledge(
      {
        documents: [{ title: "System Overview", markdown: "Three services." }],
        files: [{ canvasId: "cnv_1", title: "Code Map" }],
        skills: [],
      },
      [{ name: "PR review", content: "Check migrations." }],
    );
    expect(text).toContain("## System Overview\n\nThree services.");
    expect(text).toContain("## Skill: PR review\n\nCheck migrations.");
    expect(text).toContain("- Code Map (canvasId cnv_1)");
    expect(text).not.toContain("Code Map\n\n");
  });

  it("adds nothing when the hub has no files and nothing pinned", () => {
    expect(renderSdlcHubKnowledge({ documents: [], files: [], skills: [{ skillId: "s", pinned: false }] }, [])).toBeUndefined();
  });
});
