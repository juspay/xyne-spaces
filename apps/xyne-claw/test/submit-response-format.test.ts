import { describe, expect, it, vi } from "vitest";

const verifyResponse = vi.fn(async () => ({ ok: true, errors: [] }));
vi.mock("../src/verify-response.js", () => ({ verifyResponse, renderRejection: () => "rejected" }));

const { buildVerifiedResponseTool } = await import("../src/verified-response.js");

const replyFormat = { maxSections: 5, maxWords: 100 };
const tooLong = Array.from({ length: 7 }, (_, i) => `**Part ${i + 1}**\nshort body`).join("\n\n");
const fits = "**Answer**\nAll good.";

function tool(withFormat: boolean) {
  const pending: Array<{ responseId: string; message: string }> = [];
  const t = buildVerifiedResponseTool({
    getPendingResponses: () => pending as never,
    task: "t",
    evidenceRef: {},
    ...(withFormat ? { replyFormat } : {}),
  });
  const submit = async (message: string) =>
    ((await t.execute("id", { message }, undefined as never, undefined as never, undefined as never)) as { content: Array<{ text: string }> }).content[0]!.text;
  return { pending, submit };
}

describe("submit-response format gate", () => {
  it("sends a draft that does not fit back once with what is wrong", async () => {
    verifyResponse.mockClear();
    const { pending, submit } = tool(true);
    const status = JSON.parse(await submit(tooLong)) as { delivered: boolean; errors: string[]; action: string };
    expect(status.delivered).toBe(false);
    expect(status.errors).toEqual(["7 sections (max 5)"]);
    expect(status.action).toContain("at most 5 sections");
    expect(pending).toHaveLength(0);
    expect(verifyResponse).not.toHaveBeenCalled();
  });

  it("does not loop: a second over-long draft goes on to verification and delivery", async () => {
    verifyResponse.mockClear();
    const { pending, submit } = tool(true);
    await submit(tooLong);
    await submit(tooLong);
    expect(verifyResponse).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
  });

  it("delivers a draft that fits without a format round", async () => {
    verifyResponse.mockClear();
    const { pending, submit } = tool(true);
    await submit(fits);
    expect(verifyResponse).toHaveBeenCalledTimes(1);
    expect(pending[0]?.message).toBe(fits);
  });

  it("skips the format check when the channel has no reply format", async () => {
    verifyResponse.mockClear();
    const { pending, submit } = tool(false);
    await submit(tooLong);
    expect(pending).toHaveLength(1);
  });
});
