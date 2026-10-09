import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({ CONFIG: {} }));
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("./spaces-db.js", () => ({}));
vi.mock("../mcp/servers/xyne-spaces-client.js", () => ({}));

const { hubRunSkillWhere, renderSdlcHubKnowledge } = await import("./sdlc-repository-context.js");

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

  it("lists at most 50 files and says how many are left out", () => {
    const files = Array.from({ length: 53 }, (_, index) => ({ canvasId: `cnv_${index}`, title: `File ${index}` }));
    const text = renderSdlcHubKnowledge({ documents: [], files, skills: [] }, []);
    expect(text).toContain("- File 49 (canvasId cnv_49)");
    expect(text).not.toContain("File 50");
    expect(text).toContain("3 more are not listed.");
  });

  it("adds nothing when the hub has no files and nothing pinned", () => {
    expect(renderSdlcHubKnowledge({ documents: [], files: [], skills: [{ skillId: "s", pinned: false }] }, [])).toBeUndefined();
  });
});

describe("hubRunSkillWhere", () => {
  it("keeps a run to enabled skills of its org that are global or the user's own", () => {
    expect(hubRunSkillWhere(["s1"], "user_1", "org_1")).toEqual({
      id: { in: ["s1"] },
      orgId: "org_1",
      enabled: true,
      OR: [{ scope: "global" }, { ownerUserId: "user_1" }],
    });
  });
});
