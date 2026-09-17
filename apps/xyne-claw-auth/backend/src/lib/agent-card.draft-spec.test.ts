import { test, expect } from "vitest";
import {
  draftNote,
  identityFromDraftSpec,
  parseDraftSpec,
  resolveDraftExtras,
  unknownProvidersNote,
  type DraftAgentSpec,
} from "./agent-card.js";

const EMPTY_RESOLVED = {
  capabilities: [],
  subagents: [],
  direct: [],
  gateway: [],
  custom: [],
  callableAgents: [],
  unknown: [],
};

test("every detail-page field survives the draft spec into the card identity", () => {
  const spec: DraftAgentSpec = {
    name: "Ask AI Copy",
    slug: "ask-ai-copy-7ee704",
    description: "A copy",
    systemPrompt: "Be helpful",
    modelId: "claude-sonnet-4-5",
    color: "#6366f1",
    scope: "personal",
    providerOrder: ["claude", "codex"],
    memory: { enabled: true, requiresApproval: false },
    knowledge: { scope: "COLLECTIONS", collections: ["Handbook"] },
    skills: ["pr-review"],
    tools: ["github"],
  };

  const identity = identityFromDraftSpec(
    spec,
    {
      ...EMPTY_RESOLVED,
      capabilities: [
        { id: "github", label: "GitHub", kind: "subagent", group: "subagent" },
        { id: "web-search", label: "Web Search", kind: "tool", group: "builtin" },
      ],
      subagents: ["github"],
      custom: ["web-search"],
    },
    "ask-ai",
    {
      skills: [{ id: "sk_1", name: "PR Review", description: "Reviews PRs" }],
      knowledgeSources: [{ id: "kb_1", name: "Handbook", kind: "collection" }],
      providerOrder: ["claude", "codex"],
    },
  );

  expect(identity.scope).toBe("personal");
  expect(identity.providerOrder).toEqual(["claude", "codex"]);
  expect(identity.memory).toEqual({ enabled: true, requiresApproval: false });
  expect(identity.skills).toEqual([{ id: "sk_1", name: "PR Review", description: "Reviews PRs" }]);
  expect(identity.knowledge?.scope).toBe("COLLECTIONS");
  expect(identity.knowledge?.sources).toEqual([{ id: "kb_1", name: "Handbook", kind: "collection" }]);
  expect(identity.capabilities?.map((c) => c.group)).toEqual(["subagent", "builtin"]);
});

test("knowledge scope renders even when no collection resolved", () => {
  const spec: DraftAgentSpec = {
    name: "N",
    slug: "n",
    description: "d",
    systemPrompt: "p",
    tools: [],
    knowledge: { scope: "USER" },
  };
  const identity = identityFromDraftSpec(spec, EMPTY_RESOLVED);
  expect(identity.knowledge).toEqual({ scope: "USER" });
});

test("a legacy spec with no new fields stays clean", () => {
  const spec: DraftAgentSpec = {
    name: "Old",
    slug: "old",
    description: "d",
    systemPrompt: "p",
    tools: [],
  };
  const identity = identityFromDraftSpec(spec, EMPTY_RESOLVED);
  expect(identity.skills).toBeUndefined();
  expect(identity.knowledge).toBeUndefined();
  expect(identity.memory).toBeUndefined();
  expect(identity.providerOrder).toBeUndefined();
  expect(identity.scope).toBeUndefined();
});

test("the persisted draft round-trips every field back out of proposedContent", () => {
  const spec: DraftAgentSpec = {
    name: "Ask AI Copy",
    slug: "ask-ai-copy",
    description: "A copy",
    systemPrompt: "Be helpful",
    modelId: "claude-sonnet-4-5",
    color: "#6366f1",
    scope: "global",
    providerOrder: ["claude", "codex"],
    memory: { enabled: true, requiresApproval: true },
    knowledge: { scope: "USER", collections: ["Handbook"] },
    skills: ["pr-review"],
    tools: ["github"],
    mcps: ["bitbucket"],
  };

  const parsed = parseDraftSpec(JSON.stringify(spec));
  expect(parsed).toEqual(spec);
});

test("a malformed draft loses only the bad fields, not the whole spec", () => {
  const parsed = parseDraftSpec(
    JSON.stringify({
      name: "N",
      slug: "n",
      description: "d",
      systemPrompt: "p",
      tools: [],
      skills: "not-an-array",
      knowledge: { scope: "NONSENSE", collections: [1] },
      providerOrder: "claude",
      memory: { enabled: "yes" },
      scope: "everyone",
    }),
  );

  expect(parsed?.name).toBe("N");
  expect(parsed?.skills).toBeUndefined();
  expect(parsed?.providerOrder).toBeUndefined();
  expect(parsed?.memory).toBeUndefined();
  expect(parsed?.scope).toBeUndefined();
  expect(parsed?.knowledge).toEqual({ collections: [] });
});

test("an alias the user typed reaches the card as the supported key", async () => {
  const spec: DraftAgentSpec = {
    name: "PR Agent",
    slug: "pr-agent-draft",
    description: "d",
    systemPrompt: "p",
    tools: [],
    providerOrder: ["anthropic", "gemini"],
  };

  const extras = await resolveDraftExtras(spec, null);
  expect(extras.providerOrder).toEqual(["claude"]);
  expect(extras.unknownProviders).toEqual(["gemini"]);

  const identity = identityFromDraftSpec(spec, EMPTY_RESOLVED, undefined, extras);
  expect(identity.providerOrder).toEqual(["claude"]);
});

test("the card says which providers were dropped", () => {
  expect(unknownProvidersNote(["gemini"])).toContain("gemini");
  expect(unknownProvidersNote([])).toBeUndefined();
  expect(draftNote(undefined, "b")).toBe("b");
  expect(draftNote(undefined, undefined)).toBeUndefined();
});
