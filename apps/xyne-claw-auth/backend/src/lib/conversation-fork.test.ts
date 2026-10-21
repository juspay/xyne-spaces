import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({ CONFIG: { spacesAppUrl: "https://spaces.example.com/" } }));
vi.mock("../routes/lib/branching.js", () => ({ cloneBranchSession: vi.fn() }));

const { applyConversationFork, forkMessage, parseForkRequest, FORK_SUMMARY_MAX_CHARS } = await import("./conversation-fork.js");

const source = { conversationId: "conv-src", channelId: "ch-src", agentSlug: "architect", userId: "u1" };

function deps(opts: { posted?: { conversationId?: string }; postError?: Error; clone?: { success: boolean; targetExisted?: boolean } } = {}) {
  const post = vi.fn(async () => {
    if (opts.postError) throw opts.postError;
    return opts.posted ?? {};
  });
  const clone = vi.fn(async () => opts.clone ?? { success: true });
  return { post, clone };
}

describe("parseForkRequest", () => {
  it("needs exactly one target and a summary", () => {
    expect(parseForkRequest({ summary: "s" }).ok).toBe(false);
    expect(parseForkRequest({ conversationId: "c", channelId: "ch", summary: "s" }).ok).toBe(false);
    expect(parseForkRequest({ conversationId: "c", summary: "  " }).ok).toBe(false);
    expect(parseForkRequest({ channelId: "ch", summary: "x".repeat(FORK_SUMMARY_MAX_CHARS + 1) }).ok).toBe(false);
    expect(parseForkRequest({ channelId: " ch ", summary: " s " })).toEqual({ ok: true, value: { target: { channelId: "ch" }, summary: "s" } });
  });
});

describe("forkMessage", () => {
  it("links back to the source thread when there is a link", () => {
    expect(forkMessage("notes", "https://x/t")).toContain("[an earlier thread](https://x/t)");
    expect(forkMessage("notes", null)).toContain("an earlier thread.");
    expect(forkMessage("notes", null)).toContain("\n\nnotes");
  });
});

describe("applyConversationFork", () => {
  it("starts a thread in a channel and copies the session into it", async () => {
    const d = deps({ posted: { conversationId: "conv-new" } });
    const result = await applyConversationFork({ channelId: "ch-dst", summary: "what I know" }, source, d);
    expect(d.post).toHaveBeenCalledWith({
      channelId: "ch-dst",
      markdownText: expect.stringContaining("https://spaces.example.com/chat/dir/ch-src/conv-src"),
    });
    expect(d.clone).toHaveBeenCalledWith({
      sourceConversationId: "conv-src_architect",
      targetConversationId: "conv-new_architect",
      branchMode: "full",
    });
    expect(result).toMatchObject({
      ok: true,
      conversationId: "conv-new",
      link: "https://spaces.example.com/chat/dir/ch-dst/conv-new",
      memoryCopied: true,
    });
  });

  it("replies in an existing thread and keeps a session already there", async () => {
    const d = deps({ clone: { success: true, targetExisted: true } });
    const result = await applyConversationFork({ conversationId: "conv-doc", summary: "s" }, source, d);
    expect(d.post).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conv-doc" }));
    expect(result.ok && result.memoryCopied).toBe(false);
    expect(result.ok && result.message).toMatch(/kept that memory/);
  });

  it("still succeeds with the summary when the clone fails", async () => {
    const d = deps({ clone: { success: false } });
    const result = await applyConversationFork({ conversationId: "conv-doc", summary: "s" }, source, d);
    expect(result.ok && result.message).toMatch(/not copied/);
  });

  it("does not clone when the post fails, and refuses the same thread", async () => {
    const d = deps({ postError: new Error("Spaces 403: not a member") });
    const failed = await applyConversationFork({ channelId: "ch-dst", summary: "s" }, source, d);
    expect(failed).toEqual({ ok: false, error: "could not post in the target: Spaces 403: not a member" });
    expect(d.clone).not.toHaveBeenCalled();
    const same = await applyConversationFork({ conversationId: "conv-src", summary: "s" }, source, deps());
    expect(same.ok).toBe(false);
  });
});
