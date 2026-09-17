import { createHash } from "node:crypto";
import type { IndexBlob, IndexKind } from "./types.js";

/**
 * Render stage: an agent row becomes searchable documents.
 *
 * Pure and side-effect free — everything here is a function of the row, so the
 * output can be diffed against what the bank holds without touching the bank.
 *
 * Content is prose, not JSON. The embedding model reads text: a serialized
 * object spends its budget on punctuation and embeds structure rather than
 * meaning.
 */

/** Source row — the shape `agentRepository` returns with tools and skills included. */
export interface AgentRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: string;
  enabled: boolean;
  delegationTier: string;
  orgId: string;
  systemPrompt: string;
  activePromptVersion: number | null;
  updatedAt: Date;
  config: unknown;
  skills?: Array<{ skill: { slug: string; name: string; description: string | null } }>;
  /** Granted tools from the join table. Distinct from `config.tools` — most
   *  agents use one or the other, and integration-heavy agents use this one. */
  tools?: Array<{ tool: { slug: string; name: string | null } }>;
  collections?: unknown[];
}

export function tagsFor(slug: string, kind: IndexKind): string[] {
  return [`agent:${slug}`, `kind:${kind}`];
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * The content hash rides in a tag as well as in metadata.
 *
 * Hindsight's list endpoint returns tags but not metadata, so a tag is the only
 * way to read back what is stored without a recall — which is what lets sync
 * skip unchanged blobs and the dashboard report staleness, both without any
 * mirror of the bank in Postgres.
 */
export function hashTag(hash: string): string {
  return `hash:${hash}`;
}

export function readHashTag(tags: string[] | undefined): string | null {
  return readTag(tags, "hash:");
}

export function readKindTag(tags: string[] | undefined): string | null {
  return readTag(tags, "kind:");
}

export function readAgentTag(tags: string[] | undefined): string | null {
  return readTag(tags, "agent:");
}

/**
 * One tag per granted tool, so a caller can require a capability as an exact
 * filter instead of hoping the embedding surfaces it. Derived from the agent's
 * actual grants, so the vocabulary tracks the fleet rather than a fixed list.
 */
export function capabilityTag(tool: string): string {
  return `cap:${tool}`;
}

export function readCapabilityTags(tags: string[] | undefined): string[] {
  return (tags ?? []).filter((t) => t.startsWith("cap:")).map((t) => t.slice("cap:".length));
}

/** Prompt version rides in a tag for the same reason the hash does — metadata
 *  does not survive a list read, and the UI compares it against the live row.
 *  An unversioned prompt gets no tag, so absent reads back as absent rather than
 *  as version zero, which would look like drift against a live `null`. */
export function promptVersionTag(version: number | null): string | null {
  return version === null ? null : `promptVersion:${version}`;
}

export function readPromptVersionTag(tags: string[] | undefined): number | null {
  const raw = readTag(tags, "promptVersion:");
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readTag(tags: string[] | undefined, prefix: string): string | null {
  const tag = (tags ?? []).find((t) => t.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : null;
}

/** Flattens `config.tools` into one list of granted tool names. */
export function configToolNames(config: unknown): string[] {
  const tools = (config as { tools?: Record<string, unknown> } | null)?.tools;
  if (!tools) return [];
  return ["direct", "custom", "gateway", "subagents"]
    .flatMap((k) => (Array.isArray(tools[k]) ? (tools[k] as unknown[]) : []))
    .filter((t): t is string => typeof t === "string");
}

/**
 * Every tool the agent holds, from both places grants are stored.
 *
 * `config.tools` carries the built-in palette; the `agent_tools` join table
 * carries catalog grants, which is where integration-heavy agents keep all of
 * theirs. Reading only one leaves the agents with the most distinctive
 * capabilities looking like they have none.
 */
export function toolNames(agent: Pick<AgentRow, "config" | "tools">): string[] {
  const granted = (agent.tools ?? []).map((t) => t.tool.slug);
  return [...new Set([...configToolNames(agent.config), ...granted])];
}

/**
 * Tool slugs are machine names — `spaces-vespa-search` embeds poorly where
 * "workspace search" embeds well. Splitting on separators recovers most of the
 * meaning without a hand-maintained mapping that would rot as tools are added.
 */
export function capabilityPhrases(tools: string[]): string[] {
  const seen = new Set<string>();
  for (const tool of tools) {
    const phrase = tool.replace(/[-_.]+/g, " ").trim().toLowerCase();
    if (phrase) seen.add(phrase);
  }
  return [...seen];
}

/**
 * How many tools the identity document names.
 *
 * Every granted tool still becomes a `cap:` tag, so exact filtering is
 * unaffected — this caps only the prose. Listing all of them made the tool
 * names ~70% of the document, which pushed the description far enough into the
 * noise that adding words to it barely moved the embedding. The document exists
 * to say what the agent is for; the tags say what it can reach.
 */
const IDENTITY_TOOL_LIMIT = 12;

function renderReach(tools: string[]): string | null {
  if (tools.length === 0) return null;
  const named = capabilityPhrases(tools.slice(0, IDENTITY_TOOL_LIMIT)).join(", ");
  const rest = tools.length - IDENTITY_TOOL_LIMIT;
  return rest > 0 ? `Can reach: ${named}, and ${rest} more` : `Can reach: ${named}`;
}

function line(label: string, value: string | undefined): string | null {
  return value && value.trim() ? `${label}: ${value.trim()}` : null;
}

function renderIdentity(agent: AgentRow): string {
  const tools = toolNames(agent);
  const skills = (agent.skills ?? []).map((s) => s.skill.name || s.skill.slug);
  return [
    `Agent: ${agent.slug} (${agent.name})`,
    line("Purpose", agent.description ?? undefined),
    renderReach(tools),
    skills.length ? `Skills: ${skills.join(", ")}` : null,
    (agent.collections?.length ?? 0) > 0 ? `Knowledge: ${agent.collections?.length} collection(s)` : null,
    `Scope: ${agent.scope} | Enabled: ${agent.enabled}`,
  ]
    .filter((v): v is string => v !== null)
    .join("\n");
}

function baseMetadata(agent: AgentRow, kind: IndexKind): Record<string, string> {
  return {
    agentId: agent.id,
    slug: agent.slug,
    orgId: agent.orgId,
    kind,
    updatedAt: agent.updatedAt.toISOString(),
  };
}

function blob(agent: AgentRow, kind: IndexKind, content: string, extra: Record<string, string> = {}): IndexBlob {
  const contentHash = hashContent(content);
  return {
    kind,
    content,
    contentHash,
    tags: [...tagsFor(agent.slug, kind), hashTag(contentHash)],
    metadata: { ...baseMetadata(agent, kind), ...extra, contentHash },
  };
}

/**
 * True when an agent is a caller rather than a delegation target. The index is
 * a catalogue of agents work can be handed to, and an orchestrator hands work
 * out — indexing one lets it discover itself, and its routing-flavoured prompt
 * matches routing-flavoured needs strongly enough to crowd out real candidates.
 */
export function isIndexable(agent: AgentRow): boolean {
  return agent.delegationTier !== "orchestrator";
}

/**
 * The documents an agent should have in the index.
 *
 * `usage` is rendered separately by the usage-pattern synthesizer and is not
 * derived from the agent row, so it never appears here — sync only replaces the
 * kinds it is given, leaving any stored `usage` entry untouched.
 */
export function renderAgentBlobs(agent: AgentRow): IndexBlob[] {
  if (!isIndexable(agent)) return [];

  const identity = blob(agent, "identity", renderIdentity(agent));
  identity.tags.push(...toolNames(agent).map(capabilityTag));
  const blobs = [identity];

  const prompt = agent.systemPrompt?.trim();
  if (prompt) {
    const persona = blob(agent, "persona", prompt, {
      promptVersion: String(agent.activePromptVersion ?? 0),
    });
    const versionTag = promptVersionTag(agent.activePromptVersion);
    if (versionTag) persona.tags.push(versionTag);
    blobs.push(persona);
  }
  return blobs;
}
