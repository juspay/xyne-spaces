import { test, expect } from "vitest";
import { getMemoryProvider } from "xyne-claw-shared";

const BANK = "xyne-digital-twin";

test("deleteByTag removes only memories carrying the tag and returns the count", async () => {
  const m = getMemoryProvider("stub");
  await m.retain(BANK, [
    { content: "mine-1", tags: ["user:u1", "subsystem:style"] },
    { content: "mine-2", tags: ["user:u1"] },
    { content: "theirs", tags: ["user:u2"] },
  ]);

  const deleted = await m.deleteByTag!(BANK, "user:u1");
  expect(deleted).toBe(2);

  // u2's memory must survive — this is the per-user privacy boundary.
  const rest = await m.listMemories(BANK);
  expect(rest.memories.map((x) => x.content)).toEqual(["theirs"]);

  // Idempotent: deleting again removes nothing.
  expect(await m.deleteByTag!(BANK, "user:u1")).toBe(0);
});

test("deleteByTag on an unknown bank/tag is a no-op", async () => {
  const m = getMemoryProvider("stub");
  expect(await m.deleteByTag!("no-such-bank", "user:x")).toBe(0);
});
