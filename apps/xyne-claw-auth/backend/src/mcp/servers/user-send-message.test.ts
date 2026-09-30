import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interact: vi.fn(),
  spacesFetchBuffer: vi.fn(),
  spacesFetch: vi.fn(),
  spacesFetchText: vi.fn(),
  search: vi.fn(),
  memorySearch: vi.fn(),
  appFetch: vi.fn(),
  appFetchBuffer: vi.fn(),
  getWorkspaceIdForUser: vi.fn(async (_userId: string) => "ws-1" as string | null),
  spacesDbAvailable: vi.fn(() => true),
  lookupWorkspaces: [] as Array<string | undefined>,
}));

vi.mock("./xyne-spaces-client.js", () => mocks);
vi.mock("../../lib/spaces-db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/spaces-db.js")>()),
  getWorkspaceIdForUser: mocks.getWorkspaceIdForUser,
  spacesDbAvailable: mocks.spacesDbAvailable,
}));
vi.mock("../../lib/mention-lookups.js", () => ({
  buildSpacesMentionLookupsDb: (workspaceId?: string) => {
    mocks.lookupWorkspaces.push(workspaceId);
    return {
      byName: async (name: string) => (name === "Anurag Dwivedi" ? [{ id: "usr_anurag000000000", name }] : []),
      byEmail: async () => [],
      byHandle: async () => [],
      byGroupAlias: async (alias: string) =>
        alias === "spaces" ? [{ id: "grp_xynespaces00000", name: "xyne-spaces", alias: "spaces" }] : [],
    };
  },
}));

process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);
delete process.env["XYNE_SPACES_WORKSPACE_ID"];

async function sendTool() {
  const mod = await import("./xyne-spaces-tools.js");
  const tool = mod.tools.find((t) => t.name === "user-send-message");
  if (!tool) throw new Error("user-send-message tool not found");
  return tool;
}

function postedContent(): string {
  const init = mocks.spacesFetch.mock.calls[0]?.[1] as { body: string };
  return JSON.parse(init.body).content as string;
}

describe("user-send-message mentions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupWorkspaces.length = 0;
    mocks.spacesDbAvailable.mockReturnValue(true);
    mocks.spacesFetch.mockResolvedValue({ conversationId: "conv-1", initialMessage: { messageId: "msg-1" } });
  });

  it("tags plain @group and @Name mentions typed outside the Spaces composer", async () => {
    const tool = await sendTool();
    const res = await tool.handler({ channelId: "ch-1", content: "hello @spaces and @Anurag Dwivedi" }, { userId: "user-1", authMode: "user" });
    expect(res.isError).toBeFalsy();
    const content = postedContent();
    expect(content).toContain('data-mention-type="group" data-group-id="grp_xynespaces00000"');
    expect(content).toContain('data-mention-type="user" data-user-id="usr_anurag000000000"');
    expect(mocks.lookupWorkspaces).toEqual(["ws-1"]);
    expect(mocks.getWorkspaceIdForUser).toHaveBeenCalledWith("user-1");
  });

  it("posts the text unchanged when the Spaces DB is not available", async () => {
    mocks.spacesDbAvailable.mockReturnValue(false);
    const tool = await sendTool();
    await tool.handler({ channelId: "ch-1", content: "hello @spaces" }, { userId: "user-1", authMode: "user" });
    expect(postedContent()).toBe("hello @spaces");
    expect(mocks.lookupWorkspaces).toEqual([]);
  });
});
