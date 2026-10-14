import { test, expect } from "vitest";
import { AGENT_TOOL_DEFS } from "xyne-claw-shared";
import { writeToolQueuedText } from "../src/custom-tools.js";

const tool = (slug: string) => {
  const def = AGENT_TOOL_DEFS.find((t) => t.slug === slug);
  if (!def) throw new Error(`no ${slug} tool`);
  return def;
};

test("create-agent tells the model the card already says it all", () => {
  const text = writeToolQueuedText(tool("create-agent"));

  expect(text).toContain("draft card");
  expect(text).toContain("must be EMPTY");
});

test("other write tools keep the generic approval message", () => {
  expect(writeToolQueuedText(tool("update-agent"))).toBe(
    "Action queued for user approval: Update Agent. The user will see an Approve/Decline prompt.",
  );
});
