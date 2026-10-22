import { describe, expect, it, vi } from "vitest";

// A fake Kata client: sandbox-create stores the session it returns, and the
// follow-up tools must find that session when the call leaves out sessionId.
const writes: Array<{ session: string; path: string; text: string }> = [];
const detached: Array<{ session: string; cmd: string }> = [];
let created = 0;
vi.mock("@xyne/kata-sdk", () => ({
  KataClient: class {
    async createSession() {
      created += 1;
      const id = `sbx-${created}`;
      return {
        id,
        commands: {
          run: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }),
          runDetached: async (cmd: string) => {
            detached.push({ session: id, cmd });
            return "job-1";
          },
          pollJob: async () => ({ status: "done", stdout: "built", stderr: "", exitCode: 0 }),
        },
        files: {
          write: async (path: string, buf: Buffer) => {
            writes.push({ session: id, path, text: buf.toString("utf8") });
          },
          read: async () => Buffer.from("hello\n"),
        },
      };
    }
  },
}));

const { sandboxCreate, sandboxWriteFile, sandboxRunDetached, sandboxReadFile, sandboxDestroy } = await import("./tools.js");

const context = (conversationId: string, userId = "u1") =>
  ({ config: { KATA_ROUTER_URL: "http://kata.test" }, meta: { userId, conversationId, agentSlug: "agent-a" } }) as never;

describe("sandbox tools without sessionId", () => {
  it("use the conversation's sandbox that sandbox-create made", async () => {
    const ctx = context("conv-default");
    const createdResult = JSON.parse(await sandboxCreate.execute({}, ctx)) as { sessionId: string };

    expect(await sandboxWriteFile.execute({ path: "/workspace/a.txt", content: "hi" }, ctx)).toBe(
      JSON.stringify({ path: "/workspace/a.txt", written: true }),
    );
    expect(writes.at(-1)).toEqual({ session: createdResult.sessionId, path: "/workspace/a.txt", text: "hi" });

    expect(await sandboxRunDetached.execute({ cmd: "pnpm build" }, ctx)).toBe(JSON.stringify({ jobId: "job-1" }));
    expect(detached.at(-1)).toEqual({ session: createdResult.sessionId, cmd: "pnpm build" });

    expect(await sandboxReadFile.execute({ path: "/workspace/a.txt" }, ctx)).toContain("hello");
  });

  it("still honour an explicit sessionId", async () => {
    const ctx = context("conv-explicit");
    const { sessionId } = JSON.parse(await sandboxCreate.execute({}, ctx)) as { sessionId: string };
    await sandboxWriteFile.execute({ sessionId, path: "/workspace/b.txt", content: "x" }, ctx);
    expect(writes.at(-1)?.session).toBe(sessionId);
  });

  it("never reach another conversation's sandbox", async () => {
    await sandboxCreate.execute({}, context("conv-owner"));
    expect(await sandboxWriteFile.execute({ path: "/workspace/c.txt", content: "x" }, context("conv-other"))).toMatch(
      /^Error: No sandbox session for this conversation/,
    );
  });

  it("refuse another conversation's sandbox even when its id is passed", async () => {
    const { sessionId } = JSON.parse(await sandboxCreate.execute({}, context("conv-victim"))) as { sessionId: string };
    expect(await sandboxWriteFile.execute({ sessionId, path: "/workspace/d.txt", content: "x" }, context("conv-attacker"))).toMatch(
      /not authorized/,
    );
  });

  it("keep sessionId required for sandbox-destroy", () => {
    expect((sandboxDestroy.inputSchema as { required: string[] }).required).toContain("sessionId");
  });
});
