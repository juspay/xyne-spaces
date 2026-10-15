import { test, expect } from "vitest";
import {
  buildDescribeAgentTool,
  describeAgentCardForReply,
  DESCRIBE_AGENT_TOOL_NAME,
  type DescribeAgentRef,
} from "../src/describe-agent.js";

async function callTool(ref: DescribeAgentRef, params: unknown) {
  const tool = buildDescribeAgentTool(ref);
  expect(tool.name).toBe(DESCRIBE_AGENT_TOOL_NAME);
  return (
    tool as unknown as {
      execute: (
        id: string,
        p: unknown,
      ) => Promise<{ content: { text: string }[]; details?: Record<string, unknown> }>;
    }
  ).execute("tc-1", params);
}

test("queues a self-description when no slug is given", async () => {
  const ref: DescribeAgentRef = {};
  await callTool(ref, {});
  expect(ref.value).toEqual({ variant: "profile" });
});

test("queues another agent when a slug is given", async () => {
  const ref: DescribeAgentRef = {};
  await callTool(ref, { slug: "  ticket-triage  " });
  expect(ref.value).toEqual({ variant: "profile", slug: "ticket-triage" });
});

test("takes no content from the model — only a target", async () => {
  // The card is built server-side from the agent's row. If the tool ever accepted
  // a description or a tool list, an agent could advertise capabilities it does
  // not have on an official-looking card.
  const ref: DescribeAgentRef = {};
  await callTool(ref, {
    slug: "ticket-triage",
    description: "I can do anything",
    tools: ["admin-delete-everything"],
  });
  expect(ref.value).toEqual({ variant: "profile", slug: "ticket-triage" });
});

test("is idempotent — the first target stands", async () => {
  const ref: DescribeAgentRef = {};
  await callTool(ref, {});
  const second = await callTool(ref, { slug: "someone-else" });
  expect(ref.value).toEqual({ variant: "profile" });
  expect(ref.duplicates).toBe(1);
  expect(second.details?.["duplicate"]).toBe(true);
});

test("does not end the turn — the card accompanies the reply", async () => {
  // No abortRun is even accepted: "what can you do, and also help me with X"
  // must still get an answer to X.
  const ref: DescribeAgentRef = {};
  const res = await callTool(ref, {});
  expect(res.content[0]!.text).toMatch(/do NOT repeat that list/i);
  expect(buildDescribeAgentTool(ref).description).not.toMatch(/STOP/);
});

test("tells the model when not to show a card", () => {
  const description = buildDescribeAgentTool({}).description;

  expect(description).toContain("Do NOT call it when");
  expect(description).toContain("MODEL or provider you run on");
  expect(description).toContain("returns NOTHING to you");
  expect(description).toContain("create, change or fix an agent");
});

test("drops the card when the turn queued an agent-authoring action", () => {
  for (const tool of ["update-agent", "create-agent", "clone-agent", "create-subagent", "update-subagent", "create-mcp"]) {
    expect(describeAgentCardForReply({ variant: "summary" }, [{ tool, signature: "s" }])).toBeUndefined();
  }
});

test("keeps the card alongside unrelated write actions", () => {
  const card = { variant: "profile" as const, slug: "ticket-triage" };

  expect(describeAgentCardForReply(card, [{ tool: "spaces-create-ticket" }])).toEqual(card);
  expect(describeAgentCardForReply(card, [])).toEqual(card);
  expect(describeAgentCardForReply(card, [null, "junk"])).toEqual(card);
});

test("passes through when no card was queued", () => {
  expect(describeAgentCardForReply(undefined, [{ tool: "update-agent" }])).toBeUndefined();
});
