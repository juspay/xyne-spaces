import { describe, it, expect } from "vitest";
import {
  normalizePrUrl,
  readPrBindingData,
  planScreenId,
  planExternalKey,
  readPlanBindingData,
} from "./agent-widget-binding.js";
import type { AgentWidgetBinding } from "@prisma/client";

/**
 * The whole webhook→card feature hinges on ONE join: the PR URL the agent stored
 * at card-creation time must normalize to the SAME key as the PR URL the inbound
 * Bitbucket webhook carries. Both originate from the Bitbucket Server self-link,
 * so after normalizePrUrl they must be byte-equal. These tests pin that.
 */
describe("normalizePrUrl", () => {
  it("strips protocol, lowercases, and drops trailing slashes", () => {
    expect(normalizePrUrl("HTTPS://Bitbucket.Juspay.net/projects/XYN/repos/spaces/pull-requests/42/")).toBe(
      "bitbucket.juspay.net/projects/xyn/repos/spaces/pull-requests/42",
    );
  });

  it("drops query string and fragment", () => {
    expect(
      normalizePrUrl("https://bitbucket.juspay.net/projects/XYN/repos/spaces/pull-requests/42?at=refs%2Fheads%2Fmain#comment-1"),
    ).toBe("bitbucket.juspay.net/projects/xyn/repos/spaces/pull-requests/42");
  });

  it("collapses the agent-side and webhook-side URL of the SAME PR to one key", () => {
    // Agent (from create_pull_request response, links.self href):
    const agentUrl = "https://bitbucket.juspay.net/projects/XYN/repos/spaces/pull-requests/42";
    // Webhook (extractPRContext builds `${repositoryURL}/pull-requests/${pr.id}`) —
    // may arrive http, mixed-case host, or with a trailing slash. All must match.
    const webhookUrl = "http://Bitbucket.juspay.net/projects/xyn/repos/spaces/pull-requests/42/";
    expect(normalizePrUrl(agentUrl)).toBe(normalizePrUrl(webhookUrl));
  });

  it("keeps DIFFERENT PRs distinct", () => {
    const a = normalizePrUrl("https://bitbucket.juspay.net/projects/XYN/repos/spaces/pull-requests/42");
    const b = normalizePrUrl("https://bitbucket.juspay.net/projects/XYN/repos/spaces/pull-requests/43");
    expect(a).not.toBe(b);
  });
});

/** Build a minimal binding row carrying only the fields readPrBindingData reads. */
function bindingWith(data: unknown): AgentWidgetBinding {
  return { data } as unknown as AgentWidgetBinding;
}

describe("readPrBindingData", () => {
  it("parses a well-formed pr binding blob", () => {
    const parsed = readPrBindingData(
      bindingWith({
        provider: "bitbucket",
        title: "XYN-42 fix login",
        url: "https://bitbucket.juspay.net/projects/XYN/repos/spaces/pull-requests/42",
        ticketId: "XYN-42",
        desc: "root cause + fix",
        repo: "XYN/spaces",
        number: 42,
      }),
    );
    expect(parsed).toMatchObject({
      provider: "bitbucket",
      title: "XYN-42 fix login",
      ticketId: "XYN-42",
      number: 42,
    });
  });

  it("returns null when required fields (provider/title) are missing", () => {
    expect(readPrBindingData(bindingWith({ provider: "bitbucket" }))).toBeNull();
    expect(readPrBindingData(bindingWith({ title: "no provider" }))).toBeNull();
    expect(readPrBindingData(bindingWith(null))).toBeNull();
  });
});

describe("plan binding keys", () => {
  it("derives one screenId per plan card, from the card's own messageId", () => {
    expect(planScreenId("msg-abc")).toBe("agent-plan-msg-abc");
    expect(planScreenId("msg-abc")).not.toBe(planScreenId("msg-def"));
  });

  it("scopes the conversation correlate per agent, so two agents in one thread don't collide", () => {
    expect(planExternalKey("conv-1", "credit-doctor")).not.toBe(planExternalKey("conv-1", "other-agent"));
    expect(planExternalKey("conv-1", "credit-doctor")).toBe(planExternalKey("conv-1", "credit-doctor"));
  });
});

describe("readPlanBindingData", () => {
  it("parses a well-formed plan binding blob", () => {
    const parsed = readPlanBindingData(
      bindingWith({
        todos: [
          { id: "t1", title: "Pull the failing invoices" },
          { id: "t2", title: "Reconcile against ledger" },
        ],
        title: "Credit reconciliation",
        desc: "two steps",
        document: "## Plan\n...",
        ownerUserId: "user-1",
      }),
    );
    expect(parsed).toMatchObject({
      ownerUserId: "user-1",
      title: "Credit reconciliation",
      document: "## Plan\n...",
    });
    expect(parsed?.todos).toHaveLength(2);
  });

  // The row is the ONLY source of these two facts once Redis has expired, so a
  // blob missing either can't be approved — half-resolving it would either run an
  // empty plan or let the wrong user approve.
  it("returns null without an owner or without executable todos", () => {
    expect(readPlanBindingData(bindingWith({ todos: [{ id: "t1", title: "x" }] }))).toBeNull();
    expect(readPlanBindingData(bindingWith({ todos: [], ownerUserId: "user-1" }))).toBeNull();
    expect(readPlanBindingData(bindingWith(null))).toBeNull();
  });

  it("drops malformed todo entries rather than trusting them", () => {
    const parsed = readPlanBindingData(
      bindingWith({
        todos: [{ id: "t1", title: "keep" }, { id: 7, title: "bad id" }, { id: "t3" }, null],
        ownerUserId: "user-1",
      }),
    );
    expect(parsed?.todos).toEqual([{ id: "t1", title: "keep" }]);
  });
});
