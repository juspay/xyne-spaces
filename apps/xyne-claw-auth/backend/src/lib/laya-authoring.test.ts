import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  buildGapShortlist,
  defaultEmptyHubs,
  AUTHORING_PACK_VERSION,
} from "./laya-authoring.js";
import { clearLayaHealthCache } from "./laya-client.js";
import { bm25Rank } from "./bm25.js";

void describe("laya-authoring", () => {
  const prev = process.env["LAYA_SUGGEST"];

  before(() => {
    process.env["LAYA_SUGGEST"] = "shadow";
    clearLayaHealthCache();
  });
  after(() => {
    if (prev === undefined) delete process.env["LAYA_SUGGEST"];
    else process.env["LAYA_SUGGEST"] = prev;
    clearLayaHealthCache();
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

  void it("bm25 returns empty when query has no overlap (no first-N spray)", () => {
    const hits = bm25Rank("zzzznonexistent", [
      { id: "a", text: "slack channels standup" },
      { id: "b", text: "github pull requests" },
    ]);
    assert.equal(hits.length, 0);
  });

  void it("buildGapShortlist returns slack for a slack job and empty for unrelated", async () => {
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
    assert.ok(
      gap.shortlistIds.some((id) => id.includes("slack")) ||
        gap.fallback === "down" ||
        gap.fallback === "empty",
    );
    assert.ok(gap.catalog.integrations.length <= catalog.integrations.length);
    assert.equal(AUTHORING_PACK_VERSION, "authoring-pack-v2");

    const emptyGap = await buildGapShortlist({
      intent: "zzzz totally unrelated gibberish xyzzy",
      catalog,
      skills: [{ slug: "api-design-review", name: "API design review", description: "api design" }],
      emptyHubs: ["skill"],
      surface: "hub",
    });
    // No first-item spray — zero BM25 score → empty skill shortlist.
    assert.equal(emptyGap.skillSlugs.length, 0);
  });
});
