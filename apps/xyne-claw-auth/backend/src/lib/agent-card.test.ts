import { describe, it, expect } from "vitest";
import {
  identityFromAgentRow,
  identityFromDraftSpec,
  isConnectorServerType,
  isValidAgentSlug,
  resolveAgentCapabilities,
  toConfigTools,
  toolIdsFromConfig,
  unknownToolsNote,
} from "./agent-card.js";
import type { AvailableToolsCatalog } from "../routes/tools.js";

// Minimal catalog shaped like buildAvailableToolsCatalog's output. It includes
// subagents, custom tools, MCP integration tools and gateway integrations so the
// resolver can round-trip every agent.config.tools bucket.
const catalog = {
  subagents: [
    { name: "spaces", description: "", serverType: "xyne-spaces", progressLabel: "", progressLabels: [], source: "builtin" },
    { name: "google", description: "", serverType: "google", progressLabel: "", progressLabels: [], source: "builtin" },
  ],
  mcpServers: [],
  writeTools: [],
  customGroups: [
    { source: "custom:web", tools: [{ slug: "web-search", name: "Web Search" }] },
    { source: "custom:report", tools: [{ slug: "create-html-report", name: "Create Report" }] },
  ],
  serverTools: {},
  integrations: [
    {
      slug: "xyne-spaces",
      label: "Xyne Spaces",
      kind: "mcp",
      connected: true,
      readTools: [{ slug: "xyne-spaces__spaces-search", name: "spaces-search", description: "", riskLevel: "read" }],
      writeTools: [{ slug: "xyne-spaces__spaces-create-ticket", name: "spaces-create-ticket", description: "", riskLevel: "write" }],
      usageCount: 0,
    },
    {
      slug: "gateway:jira/primary",
      label: "Jira (primary)",
      kind: "gateway",
      connected: true,
      readTools: [{ slug: "gateway:jira/primary__search", name: "search", description: "", riskLevel: "read" }],
      writeTools: [],
      usageCount: 0,
    },
  ],
} as unknown as AvailableToolsCatalog;

describe("resolveAgentCapabilities", () => {
  it("buckets exact subagent names and custom tool slugs", async () => {
    const resolved = await resolveAgentCapabilities(["spaces", "web-search"], catalog);
    expect(resolved.subagents).toEqual(["spaces"]);
    expect(resolved.custom).toEqual(["web-search"]);
    expect(resolved.direct).toEqual([]);
    expect(resolved.gateway).toEqual([]);
    expect(resolved.unknown).toEqual([]);
    expect(resolved.capabilities).toEqual([
      // iconKey is the subagent's serverType, NOT its name — the brand asset for
      // "spaces" lives under "xyne-spaces", so the renderer must be told which
      // key to use rather than guessing from the label.
      { id: "spaces", label: "spaces", kind: "subagent", iconKey: "xyne-spaces" },
      { id: "web-search", label: "Web Search", kind: "tool" },
    ]);
  });

  it("persists source-scoped MCP tool slugs into tools.direct", async () => {
    const resolved = await resolveAgentCapabilities(
      ["spaces", "xyne-spaces__spaces-search", "xyne-spaces__spaces-create-ticket"],
      catalog,
    );
    expect(resolved.subagents).toEqual(["spaces"]);
    expect(resolved.direct).toEqual(["xyne-spaces__spaces-search", "xyne-spaces__spaces-create-ticket"]);
    expect(resolved.unknown).toEqual([]);
    expect(resolved.capabilities.map((c) => c.id)).toEqual([
      "spaces",
      "xyne-spaces__spaces-search",
      "xyne-spaces__spaces-create-ticket",
    ]);
  });

  it("persists gateway integration slugs into tools.gateway", async () => {
    const resolved = await resolveAgentCapabilities(["gateway:jira/primary"], catalog);
    expect(resolved.gateway).toEqual(["gateway:jira/primary"]);
    expect(resolved.capabilities).toEqual([
      { id: "gateway:jira/primary", label: "Jira (primary)", kind: "tool" },
    ]);
  });

  it("reports truly unmatched tokens", async () => {
    const resolved = await resolveAgentCapabilities(["spaces", "invented-tool"], catalog);
    expect(resolved.subagents).toEqual(["spaces"]);
    expect(resolved.custom).toEqual([]);
    expect(resolved.unknown).toEqual(["invented-tool"]);
    expect(unknownToolsNote(resolved.unknown)).toContain("invented-tool");
  });

  it("is case- and whitespace-exact (a near miss is reported, never silently matched)", async () => {
    const resolved = await resolveAgentCapabilities(["Spaces", " web-search "], catalog);
    // Trimmed, but not case-folded: "Spaces" is not the subagent "spaces".
    expect(resolved.custom).toEqual(["web-search"]);
    expect(resolved.unknown).toEqual(["Spaces"]);
  });

  it("dedupes and drops blanks", async () => {
    const resolved = await resolveAgentCapabilities(["spaces", "spaces", "", "  "], catalog);
    expect(resolved.subagents).toEqual(["spaces"]);
    expect(resolved.capabilities).toHaveLength(1);
  });

  it("omits the connection hint when no user is given", async () => {
    // The hint is about a specific person's account; without one there is
    // nothing truthful to say, so no chip is flagged.
    const resolved = await resolveAgentCapabilities(["google"], catalog);
    expect(resolved.capabilities[0]).toEqual({
      id: "google",
      label: "google",
      kind: "subagent",
      iconKey: "google",
    });
  });
});

describe("toolIdsFromConfig", () => {
  it("flattens the two capability buckets back into a flat id list", () => {
    // The profile card round-trips: config.tools → ids → resolved capabilities,
    // so a live agent's card shows exactly what it was granted.
    expect(
      toolIdsFromConfig({
        tools: {
          subagents: ["spaces", "google"],
          direct: ["xyne-spaces__spaces-search"],
          gateway: ["gateway:jira/primary"],
          custom: ["web-search"],
        },
      }),
    ).toEqual(["spaces", "google", "xyne-spaces__spaces-search", "gateway:jira/primary", "web-search"]);
  });

  it("ignores malformed config", () => {
    expect(toolIdsFromConfig({ tools: { subagents: "not-an-array" } })).toEqual([]);
    expect(toolIdsFromConfig(null)).toEqual([]);
    expect(toolIdsFromConfig({})).toEqual([]);
  });
});

describe("toConfigTools", () => {
  it("omits empty buckets so a tool-less agent gets {}", () => {
    expect(toConfigTools({ subagents: [], direct: [], gateway: [], custom: [] })).toEqual({});
    expect(toConfigTools({ subagents: ["spaces"], direct: [], gateway: [], custom: [] })).toEqual({ subagents: ["spaces"] });
    expect(toConfigTools({ subagents: [], direct: ["xyne-spaces__spaces-search"], gateway: [], custom: [] })).toEqual({ direct: ["xyne-spaces__spaces-search"] });
  });
});

describe("unknownToolsNote", () => {
  it("says nothing when everything matched", () => {
    expect(unknownToolsNote([])).toBeUndefined();
  });

  it("caps the list rather than spilling a wall of text onto the card", () => {
    const note = unknownToolsNote(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(note).toContain("+2 more");
  });
});

describe("isValidAgentSlug", () => {
  it.each(["a", "ticket-triage", "pr-report-2"])("accepts %s", slug => {
    expect(isValidAgentSlug(slug)).toBe(true);
  });

  it.each(["", "-lead", "trail-", "double--dash", "Upper", "has space", "a".repeat(81)])(
    "rejects %s",
    slug => {
      expect(isValidAgentSlug(slug)).toBe(false);
    },
  );
});

describe("identity builders", () => {
  const resolved = {
    capabilities: [{ id: "spaces", label: "spaces", kind: "subagent" as const }],
    subagents: ["spaces"],
    direct: [],
    gateway: [],
    custom: [],
    unknown: [],
  };

  it("produce the SAME shape from a draft spec and from a persisted row", () => {
    // The reuse invariant: the card a user approves and the card that later
    // describes the created agent must be built from one shape, or the two
    // surfaces drift apart field by field.
    const fromDraft = identityFromDraftSpec(
      {
        name: "Ticket Triage",
        slug: "ticket-triage",
        description: "Triages tickets",
        systemPrompt: "You are a triage agent.",
        modelId: "claude-sonnet-5",
        tools: ["spaces"],
      },
      resolved,
    );
    const fromRow = identityFromAgentRow(
      {
        name: "Ticket Triage",
        slug: "ticket-triage",
        description: "Triages tickets",
        systemPrompt: "You are a triage agent.",
        modelId: "claude-sonnet-5",
      },
      resolved,
    );
    expect(fromDraft).toEqual(fromRow);
  });

  it("emits no detail rows — slug and model render in the card header", () => {
    // The card shows "@slug · model" in its header, so repeating them as
    // key/value rows under the description showed the same two facts twice.
    // `details` stays available for rows that have nowhere else to go.
    const identity = identityFromAgentRow(
      { name: "A", slug: "a", systemPrompt: "p", modelId: "claude-sonnet-5" },
      resolved,
    );
    expect(identity.details).toBeUndefined();
    // The model is still on the identity — the header reads it directly.
    expect(identity.modelId).toBe("claude-sonnet-5");
  });
});

describe("isConnectorServerType", () => {
  it("accepts real MCP connector types", () => {
    expect(isConnectorServerType("github")).toBe(true);
    expect(isConnectorServerType("xyne-spaces")).toBe(true);
  });

  it("rejects custom-tool sources and blanks", () => {
    // The artifacts subagent reports "custom:create-ppt" as its serverType. It
    // has no brand asset and can never match a user_mcp_connections row, so
    // treating it as a connector flagged that chip unconnected forever and gave
    // it an icon key that 404s into a meaningless monogram.
    expect(isConnectorServerType("custom:create-ppt")).toBe(false);
    expect(isConnectorServerType("")).toBe(false);
    expect(isConnectorServerType(undefined)).toBe(false);
  });
});
