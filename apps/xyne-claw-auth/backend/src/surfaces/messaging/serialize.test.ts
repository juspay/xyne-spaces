import { describe, expect, it } from "vitest";
import { runSerialized } from "./serialize.js";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runSerialized", () => {
  it("keeps a chat's messages in the order they were sent", async () => {
    const done: string[] = [];
    // The photo is slow; the text sent right after it must still land second.
    const photo = runSerialized("chat", async () => {
      await tick(20);
      done.push("photo");
    });
    const text = runSerialized("chat", async () => {
      done.push("text");
    });
    await Promise.all([photo, text]);
    expect(done).toEqual(["photo", "text"]);
  });

  it("lets different chats run in parallel", async () => {
    const done: string[] = [];
    const slow = runSerialized("a", async () => {
      await tick(20);
      done.push("a");
    });
    const fast = runSerialized("b", async () => {
      done.push("b");
    });
    await Promise.all([slow, fast]);
    expect(done).toEqual(["b", "a"]);
  });

  it("does not let one failure block the next message", async () => {
    const failed = runSerialized("chat", async () => {
      throw new Error("dispatch failed");
    });
    await expect(failed).rejects.toThrow("dispatch failed");
    await expect(runSerialized("chat", async () => "ok")).resolves.toBe("ok");
  });


});
