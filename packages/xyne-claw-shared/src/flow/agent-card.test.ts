import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildAgentCardFlow, agentIdentity, AGENT_COMPONENT_ID } from "./agent-card.js";

/**
 * Builder-side half of the agent-card contract. The zod half lives in
 * apps/backend (`src/test/agentCardFlowSchema.test.ts`) because the validator
 * that actually gates a posted card is @xyne/shared's, and this package
 * deliberately does not depend on it. The two tests assert the SAME prop keys —
 * change one and change the other, or the card 400s at postMessage.
 *
 * These cases cover the NATIVE `agent` component, which only ships once the
 * dashboard half is deployed — hence the flag. The primitive fallback that runs
 * by default until then has its own describe block at the bottom.
 */

// Set at MODULE scope, not only in beforeEach: the describe blocks below build
// their flows in the describe body, which vitest evaluates during collection —
// before any hook runs. beforeEach additionally covers the cases that build
// inside an `it`.
process.env["SPACES_SUPPORTS_AGENT_CARD"] = "true";
beforeEach(() => {
  process.env["SPACES_SUPPORTS_AGENT_CARD"] = "true";
});
afterEach(() => {
  delete process.env["SPACES_SUPPORTS_AGENT_CARD"];
});

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

/**
 * Default path until the dashboard ships AgentNode. apps/backend validates every
 * posted flow against @xyne/shared's strict union, so an `agent` component is a
 * 400 at postMessage — not a blank card. These assert the fallback stays
 * round-trip compatible with flow-action.ts.
 */
describe("buildAgentCardFlow — primitive fallback (agent component not deployed)", () => {
  beforeEach(() => {
    delete process.env["SPACES_SUPPORTS_AGENT_CARD"];
  });

  const draft = () =>
    buildAgentCardFlow({ variant: "draft", phase: "pending", agent: identity }, data);

  it("emits no `agent` component — every type is one the deployed schema accepts", () => {
    const types = new Set(draft().components.map((c) => c.type));
    expect(types.has("agent")).toBe(false);
    for (const t of types) {
      expect(["heading", "text", "multiselect", "button", "divider"]).toContain(t);
    }
  });

  it("keeps the capability picker on props.name = AGENT_COMPONENT_ID", () => {
    // FlowUI keys state.values by props.name, and flow-action.ts reads
    // values[AGENT_COMPONENT_ID]. A rename here silently drops the user's edits.
    const picker = draft().components.find((c) => c.type === "multiselect");
    expect(picker).toBeDefined();
    expect((picker!.props as Record<string, unknown>)["name"]).toBe(AGENT_COMPONENT_ID);
    expect((picker!.props as Record<string, unknown>)["defaultValue"]).toEqual(["spaces", "web-search"]);
    expect((picker!.props as Record<string, unknown>)["options"]).toEqual([
      { label: "spaces", value: "spaces" },
      { label: "Web Search", value: "web-search" },
    ]);
  });

  it("uses the exact actionIds flow-action.ts accepts", () => {
    const actionIds = draft()
      .components.filter((c) => c.type === "button")
      .map((c) => ((c.props as Record<string, unknown>)["action"] as Record<string, unknown>)["actionId"]);
    expect(actionIds).toEqual(["agent-draft-approve", "agent-draft-decline"]);
  });

  it("carries the same data block as the native path — one authorization surface", () => {
    process.env["SPACES_SUPPORTS_AGENT_CARD"] = "true";
    const native = draft().data;
    delete process.env["SPACES_SUPPORTS_AGENT_CARD"];
    expect(draft().data).toEqual(native);
  });

  it("keeps the screenId stable across paths so a phase update lands in place", () => {
    process.env["SPACES_SUPPORTS_AGENT_CARD"] = "true";
    const nativeId = draft().screenId;
    delete process.env["SPACES_SUPPORTS_AGENT_CARD"];
    expect(nativeId).toBeTruthy();
    expect(draft().screenId).toBe(nativeId);
  });

  it("drops the buttons once the draft is decided", () => {
    const created = buildAgentCardFlow(
      { variant: "draft", phase: "created", agent: identity, decidedBy: "Anurag" },
      data,
    );
    expect(created.components.some((c) => c.type === "button")).toBe(false);
    expect(created.components.some((c) => c.type === "multiselect")).toBe(false);
    expect(JSON.stringify(created)).toContain("Agent created");
  });

  it("renders a profile read-only — no picker, no buttons", () => {
    const profile = buildAgentCardFlow({ variant: "profile", agent: identity }, data);
    expect(profile.components.some((c) => c.type === "button")).toBe(false);
    expect(profile.components.some((c) => c.type === "multiselect")).toBe(false);
    expect(JSON.stringify(profile)).toContain("Web Search");
  });
});
