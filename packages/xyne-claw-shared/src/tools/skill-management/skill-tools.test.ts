import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSkillTool, updateSkillTool } from "./tools.js";

describe("createSkillTool definition", () => {
  it("is an approval-gated write tool", () => {
    expect(createSkillTool.slug).toBe("create-skill");
    expect(createSkillTool.source).toBe("custom:agent-tools");
    expect(createSkillTool.isWriteTool).toBe(true);
  });
  it("requires name, description and content", () => {
    expect(createSkillTool.inputSchema.required).toEqual(
      expect.arrayContaining(["name", "description", "content"]),
    );
  });
  it("never persists in its fallback execute body", async () => {
    const out = await createSkillTool.execute({ name: "X", description: "d", content: "c" });
    expect(out.toLowerCase()).toContain("approve");
  });
});

describe("updateSkillTool definition", () => {
  it("is a proposal (non-write) tool", () => {
    expect(updateSkillTool.slug).toBe("update-skill");
    expect(updateSkillTool.source).toBe("custom:agent-tools");
    expect(updateSkillTool.isWriteTool).toBeFalsy();
  });
  it("requires slug while accepting edits or content", () => {
    expect(updateSkillTool.inputSchema.required).toEqual(["slug"]);
  });
});

describe("updateSkillTool.execute validation", () => {
  const ctx = { config: {}, meta: { userId: "u1", agentSlug: "a1" } };

  it("errors when slug missing", async () => {
    const out = JSON.parse(await updateSkillTool.execute({ content: "x" }, ctx));
    expect(out.error).toMatch(/slug is required/i);
  });
  it("errors when both edits and content are empty", async () => {
    const out = JSON.parse(await updateSkillTool.execute({ slug: "s", content: "   " }, ctx));
    expect(out.error).toMatch(/edits.*or.*content/i);
  });
  it("errors when requesting user id absent from context", async () => {
    const out = JSON.parse(await updateSkillTool.execute({ slug: "s", content: "x" }, { config: {}, meta: {} }));
    expect(out.error).toMatch(/missing requesting user/i);
  });
});

describe("updateSkillTool.execute HTTP behavior", () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env["XYNE_CLAW_S2S_KEY"] = "test-s2s";
    process.env["XYNE_CLAW_AUTH_URL"] = "http://auth.local:3003";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...OLD };
  });

  it("errors clearly when S2S key not configured", async () => {
    delete process.env["XYNE_CLAW_S2S_KEY"];
    const out = JSON.parse(await updateSkillTool.execute(
      { slug: "s", content: "x" },
      { config: {}, meta: { userId: "u1" } },
    ));
    expect(out.error).toMatch(/S2S/i);
  });

  it("posts to /skills/:slug/propose-update with S2S + user headers and returns proposed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { requestId: "req-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const out = JSON.parse(await updateSkillTool.execute(
      { slug: "My Skill", content: "new body", summary: "tidy up" },
      { config: {}, meta: { userId: "u1", agentSlug: "a1" } },
    ));

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = call[0];
    const init = call[1];
    expect(String(url)).toBe("http://auth.local:3003/claw/api/v1/skills/my-skill/propose-update");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-s2s-key"]).toBe("test-s2s");
    expect(headers["x-user-id"]).toBe("u1");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ content: "new body", summary: "tidy up", agentSlug: "a1" });
    expect(out.status).toBe("proposed");
  });

  it("maps 404 to a clear not-found error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error: "nope" }), { status: 404 })));
    const out = JSON.parse(await updateSkillTool.execute({ slug: "ghost", content: "x" }, { config: {}, meta: { userId: "u1" } }));
    expect(out.error).toMatch(/not found/i);
  });

  it("maps 409 to a no-op / identical error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error: "identical" }), { status: 409 })));
    const out = JSON.parse(await updateSkillTool.execute({ slug: "s", content: "x" }, { config: {}, meta: { userId: "u1" } }));
    expect(out.error).toMatch(/identical/i);
  });
});
