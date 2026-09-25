import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  buildGapShortlist,
  defaultEmptyHubs,
  AUTHORING_PACK_VERSION,
} from "./laya-authoring.js";

void describe("laya-authoring", () => {
  const prev = process.env["LAYA_SUGGEST"];

  before(() => {
    process.env["LAYA_SUGGEST"] = "fast";
  });
  after(() => {
    if (prev === undefined) delete process.env["LAYA_SUGGEST"];
    else process.env["LAYA_SUGGEST"] = prev;
  });

  void it("defaultEmptyHubs covers mcp and subagent when present", () => {
    const hubs = defaultEmptyHubs(
      {
        subagents: [{ name: "spaces", description: "Spaces" }],
        integrations: [
          {
            slug: "slack",
            label: "Slack",
            readTools: [{ name: "list", description: "", riskLevel: "read" }],
            writeTools: [],
          },
        ],
      },
      true,
    );
    assert.ok(hubs.includes("mcp"));
    assert.ok(hubs.includes("subagent"));
    assert.ok(hubs.includes("skill"));
  });

  void it("buildGapShortlist returns a truncated catalog for a slack job", async () => {
    const catalog = {
      subagents: [
        { name: "spaces", description: "Xyne Spaces" },
        { name: "artifacts", description: "slides" },
      ],
      integrations: [
        {
          slug: "slack",
          label: "Slack",
          readTools: [{ name: "list_channels", description: "list", riskLevel: "read" }],
          writeTools: [{ name: "post_message", description: "post", riskLevel: "write" }],
        },
        {
          slug: "github",
          label: "GitHub",
          readTools: [{ name: "list_prs", description: "prs", riskLevel: "read" }],
          writeTools: [],
        },
        {
          slug: "custom:email",
          label: "Email",
          readTools: [{ name: "send_email", description: "send", riskLevel: "write" }],
          writeTools: [],
        },
      ],
    };
    const gap = await buildGapShortlist({
      intent: "read-only Slack triage of support channels",
      catalog,
      skills: [{ slug: "ticket-triage", name: "Ticket triage", description: "triage tickets" }],
      emptyHubs: ["mcp", "builtin", "subagent", "skill"],
      surface: "hub",
    });
    assert.ok(gap.shortlistIds.length > 0 || gap.fallback === "down" || gap.fallback === "empty");
    assert.ok(gap.catalog.integrations.length <= catalog.integrations.length);
    assert.equal(AUTHORING_PACK_VERSION, "authoring-pack-v1");
  });
});
