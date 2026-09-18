/**
 * The Spaces access card.
 *
 * It exists because the connector-suggestion path silently produced nothing for
 * a host credential: that path resolves each serverType against the connector
 * catalog, and `webfetch-host:<host>` has no row there by design. The card was
 * skipped, the run stayed parked, and the user in Spaces saw an agent saying it
 * was stuck with no way to unstick it. These assertions pin the pieces that
 * make the card actually answerable.
 */

import { describe, expect, it } from "vitest";
import { buildHostAccessFlow } from "./builder.js";

const flow = buildHostAccessFlow({
  host: "bitbucket.example.net",
  reasonText: "listing branches — got a login page instead",
  screenKey: "u1-bitbucket.example.net",
  agentSlug: "orchestrator",
  userId: "u1",
  conversationId: "conv-1",
  channelId: "chan-1",
});

const byId = (id: string): Record<string, unknown> =>
  (flow.components.find((c) => c.id === id)?.props ?? {}) as Record<string, unknown>;

describe("buildHostAccessFlow", () => {
  it("routes to the host-access handler and carries who it is for", () => {
    // Without actionType the flow-action router has nothing to dispatch on, and
    // without userId it cannot check that the person pressing Save is the
    // person the card was addressed to.
    expect(flow.data?.["actionType"]).toBe("host-access");
    expect(flow.data?.["host"]).toBe("bitbucket.example.net");
    expect(flow.data?.["userId"]).toBe("u1");
    expect(flow.data?.["conversationId"]).toBe("conv-1");
    expect(flow.data?.["agentSlug"]).toBe("orchestrator");
  });

  it("collects the credential in a password field, not a plain input", () => {
    const input = byId("credential");
    expect(input["type"]).toBe("password");
    expect(input["required"]).toBe(true);
    // The card is the first place the user learns who can see this.
    expect(String(input["helperText"])).toContain("only you");
  });

  it("offers all three ways a credential can be sent", () => {
    const options = byId("scheme")["options"] as Array<{ value: string }>;
    expect(options.map((o) => o.value).sort()).toEqual(["bearer", "cookie", "header"]);
    expect(byId("scheme")["defaultValue"]).toBe("bearer");
  });

  it("submits with the actionId the handler matches on", () => {
    const action = byId("save")["action"] as { type: string; actionId: string };
    expect(action.type).toBe("submit");
    expect(action.actionId).toBe("host-access-save");
  });

  it("shows the agent's reason and the host to the user", () => {
    const text = String(byId("why")["content"]);
    expect(text).toContain("listing branches");
    expect(text).toContain("bitbucket.example.net");
  });

  it("still renders without a reason", () => {
    const bare = buildHostAccessFlow({ host: "api.example.net", screenKey: "k", userId: "u1" });
    expect(String((bare.components.find((c) => c.id === "why")?.props as { content: string }).content))
      .toContain("api.example.net");
  });
});
