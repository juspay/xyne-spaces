import { describe, it, expect } from "vitest";
import {
  agentDraftIdentityError,
  applyDraftEdits,
  draftToolTokens,
  narrowToKeptCapabilities,
  expandMcpRequests,
  identityFromAgentRow,
  identityFromDraftSpec,
  isConnectorServerType,
  isValidAgentSlug,
  parseAgentDraftEdits,
  resolveAgentCapabilities,
  specWithAppliedEdits,
  toConfigTools,
  toolIdsFromConfig,
  unknownToolsNote,
  type DraftAgentSpec,
  type ResolvedDraftExtras,
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
      slug: "custom:web",
      label: "Web",
      kind: "custom",
      connected: true,
      readTools: [{ slug: "web-search", name: "Web Search", description: "", riskLevel: "read" }],
      writeTools: [],
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
  it("buckets agent slugs as callable agents, not unknown", async () => {
    const resolved = await resolveAgentCapabilities(["spaces", "ask-ai"], catalog, undefined, [
      { slug: "ask-ai", name: "Ask AI", description: "Workspace assistant" },
    ]);
    expect(resolved.callableAgents).toEqual(["ask-ai"]);
    expect(resolved.unknown).toEqual([]);
    expect(resolved.capabilities.find((c) => c.id === "ask-ai")).toEqual({
      id: "ask-ai",
      label: "Ask AI",
      kind: "tool",
      group: "agent",
      description: "Workspace assistant",
    });
  });

  it("still reports an agent slug as unknown when no options are supplied", async () => {
    const resolved = await resolveAgentCapabilities(["ask-ai"], catalog);
    expect(resolved.callableAgents).toEqual([]);
    expect(resolved.unknown).toEqual(["ask-ai"]);
  });

  it("prefers a catalog match over an agent of the same name", async () => {
    const resolved = await resolveAgentCapabilities(["spaces"], catalog, undefined, [
      { slug: "spaces", name: "Spaces Agent" },
    ]);
    expect(resolved.subagents).toEqual(["spaces"]);
    expect(resolved.callableAgents).toEqual([]);
  });

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
      { id: "spaces", label: "spaces", kind: "subagent", group: "subagent", iconKey: "xyne-spaces" },
      {
        id: "web-search",
        label: "Web Search",
        kind: "tool",
        group: "builtin",
        parentId: "custom:web",
        parentLabel: "Web",
      },
    ]);
  });

  it("tags MCP tools with the integration they belong to, so the card groups them", async () => {
    const resolved = await resolveAgentCapabilities(
      ["xyne-spaces__spaces-search", "xyne-spaces__spaces-create-ticket"],
      catalog,
    );
    expect(
      resolved.capabilities.map((c) => ({ id: c.id, parentId: c.parentId, parentLabel: c.parentLabel })),
    ).toEqual([
      { id: "xyne-spaces__spaces-search", parentId: "xyne-spaces", parentLabel: "Xyne Spaces" },
      { id: "xyne-spaces__spaces-create-ticket", parentId: "xyne-spaces", parentLabel: "Xyne Spaces" },
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
      { id: "gateway:jira/primary", label: "Jira (primary)", kind: "tool", group: "mcp" },
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
      group: "subagent",
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
    expect(toConfigTools({ subagents: [], direct: [], gateway: [], custom: [], callableAgents: [] })).toEqual({});
    expect(toConfigTools({ subagents: ["spaces"], direct: [], gateway: [], custom: [], callableAgents: [] })).toEqual({ subagents: ["spaces"] });
    expect(toConfigTools({ subagents: [], direct: ["xyne-spaces__spaces-search"], gateway: [], custom: [], callableAgents: [] })).toEqual({ direct: ["xyne-spaces__spaces-search"] });
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
    callableAgents: [],
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

describe("parseAgentDraftEdits", () => {
  it("ignores anything that is not an object of edits", () => {
    expect(parseAgentDraftEdits(undefined)).toBeUndefined();
    expect(parseAgentDraftEdits("tools")).toBeUndefined();
    expect(parseAgentDraftEdits(["spaces"])).toBeUndefined();
    expect(parseAgentDraftEdits({})).toBeUndefined();
  });

  it("keeps the five tool buckets, trimmed, and drops non-strings", () => {
    const edits = parseAgentDraftEdits({
      toolSelection: { subagents: [" spaces ", 7, ""], direct: ["reddit__search"], junk: ["x"] },
    });
    expect(edits?.toolSelection).toEqual({
      subagents: ["spaces"],
      direct: ["reddit__search"],
      gateway: [],
      custom: [],
      callableAgents: [],
    });
  });

  it("reads a cleared model as an explicit empty pin", () => {
    expect(parseAgentDraftEdits({ modelId: null })?.modelId).toBe("");
    expect(parseAgentDraftEdits({ modelId: "  kimi-latest " })?.modelId).toBe("kimi-latest");
    expect(parseAgentDraftEdits({ modelId: 12 })).toBeUndefined();
  });
});

describe("applyDraftEdits", () => {
  const spec = {
    name: "Reddit Reader",
    slug: "read-reddit",
    description: "",
    systemPrompt: "You read reddit.",
    modelId: "kimi-latest",
    tools: ["spaces"],
  } as DraftAgentSpec;
  const extras: ResolvedDraftExtras = { providerOrder: ["claude"], unknownProviders: [] };

  it("leaves the draft untouched when nothing was edited", () => {
    expect(applyDraftEdits(spec, extras)).toEqual({
      modelId: "kimi-latest",
      providerOrder: ["claude"],
      unknownProviders: [],
    });
  });

  it("flattens an edited selection across buckets and dedupes", () => {
    const applied = applyDraftEdits(spec, extras, {
      toolSelection: {
        subagents: ["spaces"],
        direct: ["reddit__search", "reddit__search"],
        custom: ["web-search"],
      },
    });
    expect(applied.requestedTools).toEqual(["spaces", "reddit__search", "web-search"]);
  });

  it("normalizes edited providers and reports the ones Xyne does not offer", () => {
    const applied = applyDraftEdits(spec, extras, { providerOrder: ["anthropic", "gemini"] });
    expect(applied.providerOrder).toEqual(["claude"]);
    expect(applied.unknownProviders).toEqual(["gemini"]);
  });

  it("clears the model pin when the user picks the platform default", () => {
    expect(applyDraftEdits(spec, extras, { modelId: "" }).modelId).toBe("");
  });

  it("carries a retyped identity through", () => {
    const applied = applyDraftEdits(spec, extras, {
      name: "Reddit Digest",
      slug: "reddit-digest",
      description: "Summarises reddit.",
      systemPrompt: "You summarise reddit.",
    });
    expect(specWithAppliedEdits(spec, applied)).toMatchObject({
      name: "Reddit Digest",
      slug: "reddit-digest",
      description: "Summarises reddit.",
      systemPrompt: "You summarise reddit.",
    });
  });

  it("keeps the drafted identity for fields the user did not touch", () => {
    const applied = applyDraftEdits(spec, extras, { name: "Reddit Digest" });
    const draft = specWithAppliedEdits(spec, applied);
    expect(draft.name).toBe("Reddit Digest");
    expect(draft.slug).toBe("read-reddit");
    expect(draft.systemPrompt).toBe("You read reddit.");
  });
});

describe("parseAgentDraftEdits — identity", () => {
  it("trims and lowercases a retyped identifier", () => {
    expect(parseAgentDraftEdits({ slug: "  Reddit-Digest " })?.slug).toBe("reddit-digest");
  });

  it("reads each identity field and ignores non-strings", () => {
    const edits = parseAgentDraftEdits({
      name: "  Reddit Digest ",
      description: " Summarises reddit. ",
      systemPrompt: " You summarise reddit. ",
      slug: 7,
    });
    expect(edits).toEqual({
      name: "Reddit Digest",
      description: "Summarises reddit.",
      systemPrompt: "You summarise reddit.",
    });
  });

  it("caps a pasted prompt rather than rejecting it", () => {
    const edits = parseAgentDraftEdits({ systemPrompt: "x".repeat(200_000) });
    expect(edits?.systemPrompt).toHaveLength(100_000);
  });
});

describe("agentDraftIdentityError", () => {
  it("passes an untouched draft", () => {
    expect(agentDraftIdentityError(undefined)).toBeUndefined();
    expect(agentDraftIdentityError({ modelId: "kimi-latest" })).toBeUndefined();
  });

  it("rejects an emptied name or prompt", () => {
    expect(agentDraftIdentityError({ name: "" })).toBe("The agent needs a name.");
    expect(agentDraftIdentityError({ systemPrompt: "" })).toBe("The agent needs a system prompt.");
  });

  it("allows an emptied description — that clears the field", () => {
    expect(agentDraftIdentityError({ description: "" })).toBeUndefined();
  });

  it("rejects an identifier the create route would refuse", () => {
    expect(agentDraftIdentityError({ slug: "Reddit Digest" })).toContain("isn't a valid identifier");
    expect(agentDraftIdentityError({ slug: "read--reddit" })).toContain("isn't a valid identifier");
    expect(agentDraftIdentityError({ slug: "-reddit" })).toContain("isn't a valid identifier");
    expect(agentDraftIdentityError({ slug: "read-reddit" })).toBeUndefined();
  });
});

describe("expandMcpRequests", () => {
  it("grants the integration's own tools when a connector is named as an MCP", () => {
    const { tokens, unknown } = expandMcpRequests(["xyne-spaces"], catalog);
    expect(tokens).toEqual(["spaces-search", "spaces-create-ticket"]);
    expect(unknown).toEqual([]);
  });

  it("matches on the display label too, since that is what users type", () => {
    expect(expandMcpRequests(["Xyne Spaces"], catalog).tokens).toEqual([
      "spaces-search",
      "spaces-create-ticket",
    ]);
  });

  it("keeps a gateway as its own selection key rather than expanding it", () => {
    expect(expandMcpRequests(["gateway:jira/primary"], catalog).tokens).toEqual([
      "gateway:jira/primary",
    ]);
  });

  it("reports connectors this workspace does not have", () => {
    const { tokens, unknown } = expandMcpRequests(["notion"], catalog);
    expect(tokens).toEqual([]);
    expect(unknown).toEqual(["notion"]);
  });

  it("never expands a custom tool group — those are built-in tools, not MCPs", () => {
    expect(expandMcpRequests(["custom:web"], catalog).unknown).toEqual(["custom:web"]);
  });

  it("dedupes a connector named twice", () => {
    expect(expandMcpRequests(["xyne-spaces", "Xyne Spaces"], catalog).tokens).toHaveLength(2);
  });
});

describe("a named MCP lands in tools.direct, not tools.subagents", () => {
  it("resolves the expanded tokens into the MCP bucket", async () => {
    const spec = {
      name: "Ultron",
      slug: "ultron",
      description: "",
      systemPrompt: "You are Ultron.",
      tools: [],
      mcps: ["xyne-spaces"],
    } as DraftAgentSpec;

    const resolved = await resolveAgentCapabilities(draftToolTokens(spec, catalog), catalog);
    expect(resolved.direct).toEqual(["spaces-search", "spaces-create-ticket"]);
    expect(resolved.subagents).toEqual([]);
    expect(resolved.unknown).toEqual([]);
    expect(resolved.capabilities.every((c) => c.parentLabel === "Xyne Spaces")).toBe(true);
  });

  it("still grants the subagent when the same name is listed under tools", async () => {
    const spec = {
      name: "Ultron",
      slug: "ultron",
      description: "",
      systemPrompt: "You are Ultron.",
      tools: ["spaces"],
    } as DraftAgentSpec;

    const resolved = await resolveAgentCapabilities(draftToolTokens(spec, catalog), catalog);
    expect(resolved.subagents).toEqual(["spaces"]);
    expect(resolved.direct).toEqual([]);
  });
});

describe("direct tool lookup", () => {
  it("accepts the tool NAME the agent's Toolbox picker writes, not just the slug", async () => {
    const bySlug = await resolveAgentCapabilities(["xyne-spaces__spaces-search"], catalog);
    const byName = await resolveAgentCapabilities(["spaces-search"], catalog);
    expect(bySlug.direct).toEqual(["xyne-spaces__spaces-search"]);
    expect(byName.direct).toEqual(["spaces-search"]);
    expect(byName.unknown).toEqual([]);
  });
});

describe("narrowToKeptCapabilities", () => {
  const requested = ["a", "b", "c"];

  it("grants everything when the user never touched the selection", () => {
    expect(narrowToKeptCapabilities(requested, undefined, requested)).toEqual(requested);
  });

  it("drops a tool the card showed and the user unchecked", () => {
    expect(narrowToKeptCapabilities(requested, ["a", "c"], requested)).toEqual(["a", "c"]);
  });

  it("keeps tools the card never displayed, so the display cap cannot silently un-grant them", () => {
    // The card renders at most MAX_CAPABILITIES chips; "c" fell off the end, so
    // its absence from the kept list is truncation, not a decision.
    expect(narrowToKeptCapabilities(requested, ["a", "b"], ["a", "b"])).toEqual(requested);
  });
});
