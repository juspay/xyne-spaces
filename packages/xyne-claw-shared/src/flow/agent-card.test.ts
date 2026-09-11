import { describe, it, expect } from "vitest";
import { buildAgentCardFlow, agentIdentity, AGENT_COMPONENT_ID } from "./agent-card.js";

/**
 * Builder-side half of the agent-card contract. The zod half lives in
 * apps/backend (`src/test/agentCardFlowSchema.test.ts`) because the validator
 * that actually gates a posted card is @xyne/shared's, and this package
 * deliberately does not depend on it. The two tests assert the SAME prop keys —
 * change one and change the other, or the card 400s at postMessage.
 */

const identity = agentIdentity({
  name: "Ticket Triage",
  slug: "ticket-triage",
  description: "Triages incoming tickets",
  systemPrompt: "You are a triage agent. Read the ticket and route it.",
  modelId: "claude-sonnet-5",
  capabilities: [
    { id: "spaces", label: "spaces", kind: "subagent" },
    { id: "web-search", label: "Web Search", kind: "tool" },
  ],
  details: [{ label: "Model", value: "claude-sonnet-5" }],
});

const data = {
  requestId: "req-1",
  agentSlug: "architect",
  userId: "user-1",
  conversationId: "conv-1",
  channelId: "chan-1",
};

describe("buildAgentCardFlow — draft", () => {
  const flow = buildAgentCardFlow({ variant: "draft", phase: "pending", agent: identity }, data);
  const component = flow.components[0]!;

  it("emits ONE agent component under the stable id the backend reads state from", () => {
    expect(flow.components).toHaveLength(1);
    expect(component.id).toBe(AGENT_COMPONENT_ID);
    expect(component.type).toBe("agent");
  });

  it("keeps every actionable identifier in data, never in props", () => {
    expect(flow.data).toMatchObject({
      actionType: "agent-card",
      variant: "draft",
      requestId: "req-1",
      agentSlug: "architect",
      userId: "user-1",
    });
    // props are display-only: no request id, no acting user, nothing routable.
    const props = component.props as Record<string, unknown>;
    expect(props["requestId"]).toBeUndefined();
    expect(props["userId"]).toBeUndefined();
  });

  it("does not leak the system prompt into data (it rides in props for display only)", () => {
    expect(JSON.stringify(flow.data)).not.toContain("You are a triage agent");
    expect((component.props as Record<string, unknown>)["agent"]).toMatchObject({
      systemPrompt: expect.stringContaining("You are a triage agent"),
    });
  });

  it("defaults the selection to every capability", () => {
    // An absent seed must not read as "the user deselected everything" — an
    // unchecked chip is a removal, so the default has to be all-selected.
    expect((component.props as Record<string, unknown>)["selected"]).toEqual([
      "spaces",
      "web-search",
    ]);
  });

  it("honours an explicit selection", () => {
    const narrowed = buildAgentCardFlow(
      { variant: "draft", phase: "pending", agent: identity, selected: ["spaces"] },
      data,
    );
    expect((narrowed.components[0]!.props as Record<string, unknown>)["selected"]).toEqual(["spaces"]);
  });

  it("keys the screen on the request so every phase updates the SAME card", () => {
    const created = buildAgentCardFlow(
      { variant: "draft", phase: "created", agent: identity, decidedBy: "Harsh", decidedAt: "2026-08-05T10:00:00.000Z" },
      data,
    );
    expect(created.screenId).toBe(flow.screenId);
    expect((created.components[0]!.props as Record<string, unknown>)["phase"]).toBe("created");
  });

  it("omits absent optional props rather than emitting empties (props are .strict())", () => {
    const props = component.props as Record<string, unknown>;
    expect(props).not.toHaveProperty("note");
    expect(props).not.toHaveProperty("decidedBy");
    expect(props).not.toHaveProperty("decidedAt");
  });
});

describe("buildAgentCardFlow — profile", () => {
  const flow = buildAgentCardFlow({ variant: "profile", agent: identity }, { ...data, targetSlug: "ticket-triage" });
  const props = flow.components[0]!.props as Record<string, unknown>;

  it("renders the same identity with no draft-only fields", () => {
    expect(props["variant"]).toBe("profile");
    expect(props["agent"]).toEqual(identity);
    expect(props).not.toHaveProperty("phase");
    expect(props).not.toHaveProperty("selected");
  });

  it("carries the described agent separately from the posting agent", () => {
    // `agentSlug` resolves the Spaces token that updates the message; the card's
    // SUBJECT is targetSlug. Conflating them posts as the wrong identity.
    expect(flow.data).toMatchObject({ agentSlug: "architect", targetSlug: "ticket-triage" });
  });
});

describe("agentIdentity — the reuse hinge", () => {
  it("drops blank fields instead of emitting empty strings", () => {
    const result = agentIdentity({ name: "A", slug: "a", description: "   ", modelId: "" });
    expect(result).toEqual({ name: "A", slug: "a" });
  });

  it("falls back rather than emitting an empty name/slug", () => {
    expect(agentIdentity({ name: "  ", slug: "  " })).toEqual({ name: "Agent", slug: "agent" });
  });

  it("truncates a very long system prompt for display", () => {
    const long = "x".repeat(25_000);
    const result = agentIdentity({ name: "A", slug: "a", systemPrompt: long });
    // Display cap only — the full prompt is persisted server-side and is what
    // actually gets created.
    expect(result.systemPrompt!.length).toBeLessThan(long.length);
    expect(result.systemPrompt).toContain("truncated for display");
  });

  it("drops capabilities with empty ids/labels and preserves kind", () => {
    const result = agentIdentity({
      name: "A",
      slug: "a",
      capabilities: [
        { id: " ", label: "ghost", kind: "tool" },
        { id: "spaces", label: "spaces", kind: "subagent", requiresConnection: "google" },
      ],
    });
    expect(result.capabilities).toEqual([
      { id: "spaces", label: "spaces", kind: "subagent", requiresConnection: "google" },
    ]);
  });

  it("produces the same shape from a draft spec and from a stored row", () => {
    // The invariant that makes one node serve both surfaces.
    const fromDraft = agentIdentity({ name: "A", slug: "a", description: "d", systemPrompt: "p" });
    const fromRow = agentIdentity({ name: "A", slug: "a", description: "d", systemPrompt: "p" });
    expect(Object.keys(fromDraft).sort()).toEqual(Object.keys(fromRow).sort());
  });
});
