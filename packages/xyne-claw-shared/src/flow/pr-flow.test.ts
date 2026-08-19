import { describe, it, expect } from "vitest";
import { buildPrFlow, prScreenId, PR_COMPONENT_ID, type PrCardInput } from "./pr-flow.js";

/** Pull the single `pr` component out of a built flow. */
function prComponent(flow: ReturnType<typeof buildPrFlow>) {
  expect(flow.components).toHaveLength(1);
  const c = flow.components[0]!;
  expect(c.id).toBe(PR_COMPONENT_ID);
  expect(c.type).toBe("pr");
  return c.props as Record<string, unknown>;
}

const base: PrCardInput = { provider: "github", status: "created", title: "Fix the thing" };

describe("buildPrFlow", () => {
  it("emits a minimal created card with required props only", () => {
    const props = prComponent(buildPrFlow(base));
    expect(props["status"]).toBe("created");
    expect(props["provider"]).toBe("github");
    expect(props["title"]).toBe("Fix the thing");
    // Optional fields absent (not emitted as undefined/"").
    expect(props).not.toHaveProperty("url");
    expect(props).not.toHaveProperty("ticketId");
    expect(props).not.toHaveProperty("desc");
    expect(props).not.toHaveProperty("detailsUrl");
    expect(Object.keys(props).sort()).toEqual(["provider", "status", "title"]);
  });

  it("emits all optional fields when provided", () => {
    const props = prComponent(
      buildPrFlow({
        provider: "bitbucket",
        status: "merged",
        title: "XYNE-1234 fix login",
        url: "https://bitbucket.org/xyne/spaces/pull-requests/42",
        ticketId: "XYNE-1234",
        desc: "root cause + fix",
        detailsUrl: "https://tickets/XYNE-1234",
      }),
    );
    expect(props).toMatchObject({
      provider: "bitbucket",
      status: "merged",
      title: "XYNE-1234 fix login",
      url: "https://bitbucket.org/xyne/spaces/pull-requests/42",
      ticketId: "XYNE-1234",
      desc: "root cause + fix",
      detailsUrl: "https://tickets/XYNE-1234",
    });
  });

  it("tags flow.data with kind:'pr' and merges opts.data", () => {
    const flow = buildPrFlow(base, { data: { conversationId: "c1", agentSlug: "doctor" } });
    expect(flow.data).toMatchObject({ kind: "pr", conversationId: "c1", agentSlug: "doctor" });
  });

  it("defaults the card title to 'Pull Request'", () => {
    expect(buildPrFlow(base).title).toBe("Pull Request");
    expect(buildPrFlow(base, { title: "PR" }).title).toBe("PR");
  });

  describe("screenId (one evolving card per PR)", () => {
    it("is stable across status transitions for the same identity", () => {
      const identity = { repo: "juspay/xyne-spaces", number: 112 };
      const created = buildPrFlow({ ...base, status: "created" }, { identity });
      const merged = buildPrFlow({ ...base, status: "merged" }, { identity });
      expect(created.screenId).toBe(merged.screenId);
      expect(created.screenId).toBe("agent-pr-github-juspay-xyne-spaces-112");
    });

    it("prefers an explicit opts.screenId over identity derivation", () => {
      const flow = buildPrFlow(base, { screenId: "agent-pr-custom", identity: { number: 9 } });
      expect(flow.screenId).toBe("agent-pr-custom");
    });

    it("falls back to a slug of the url when number is absent", () => {
      const url = "https://github.com/juspay/xyne-spaces/pull/7";
      const flow = buildPrFlow({ ...base, url });
      expect(flow.screenId).toBe(prScreenId({ provider: "github", url }));
      expect(flow.screenId).toBe("agent-pr-github-com-juspay-xyne-spaces-pull-7");
    });

    it("prScreenId is pure — same identity in, same id out", () => {
      const id = { provider: "gitlab" as const, repo: "grp/proj", number: "5" };
      expect(prScreenId(id)).toBe(prScreenId(id));
      expect(prScreenId(id)).toBe("agent-pr-gitlab-grp-proj-5");
    });

    it("degrades to a bare id when no identity is available", () => {
      expect(prScreenId({})).toBe("agent-pr");
    });
  });

  describe("webhook-driven statuses", () => {
    it("emits a 'declined' card (webhook-only terminal status)", () => {
      const props = prComponent(buildPrFlow({ ...base, status: "declined" }));
      expect(props["status"]).toBe("declined");
    });

    it("emits merged/deleted status cards", () => {
      expect(prComponent(buildPrFlow({ ...base, status: "merged" }))["status"]).toBe("merged");
      expect(prComponent(buildPrFlow({ ...base, status: "deleted" }))["status"]).toBe("deleted");
    });

    it("keeps a stable base screenId across created → merged → declined for one identity", () => {
      // The durable binding is keyed on this base screenId; the webhook route
      // suffixes it per status to post distinct artifacts, so the base must stay
      // identity-stable no matter which status is rendered.
      const identity = { repo: "XYN/spaces", number: 42 };
      const created = buildPrFlow({ ...base, provider: "bitbucket", status: "created" }, { identity });
      const merged = buildPrFlow({ ...base, provider: "bitbucket", status: "merged" }, { identity });
      const declined = buildPrFlow({ ...base, provider: "bitbucket", status: "declined" }, { identity });
      expect(created.screenId).toBe(merged.screenId);
      expect(merged.screenId).toBe(declined.screenId);
      expect(created.screenId).toBe("agent-pr-bitbucket-xyn-spaces-42");
    });
  });
});
