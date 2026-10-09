import {
  buildMcpSuggestFlow,
  buildProviderSuggestFlow,
  withSpacesAppId,
  type FlowDefinition,
} from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { userProviderCredentialsRepository } from "../repositories/index.js";
import { isVisibleToUser, parseConnectorMeta } from "../routes/servers.js";
import { availabilityForServerIds } from "./connector-availability.js";
import { postFlowCard, type FlowCardTarget } from "./flow-card-delivery.js";
import {
  PROVIDER_CONNECT_METHOD,
  PROVIDER_DESCRIPTIONS,
  PROVIDER_LABELS,
  normalizeProviderName,
  SUPPORTED_PROVIDERS,
} from "./provider-hints.js";

const log = createLogger("connector-card");

/** How many roster rows a "what connectors exist?" card samples. */
const MCP_SUGGEST_ROSTER_SAMPLE = 5;

/**
 * What the agent's `suggest-connectors` call queued (claw → callback payload).
 * The ONLY source of a connector card: the server never infers one from the
 * user's words — the agent knows its tools, what failed, and what the user asked.
 */
export interface PendingConnectorSuggestions {
  serverTypes: string[];
  listAll?: boolean | undefined;
  title?: string | undefined;
}

/** Identity the suggest cards are built from. `channelId` is "" on Xyne AI. */
export interface ConnectorCardIdentity {
  agentSlug: string | undefined;
  agentOrgId?: string | null | undefined;
  userId: string;
  conversationId: string;
  channelId: string;
  spacesAppId: string | undefined;
}

export interface ResolvedConnectorSuggestions {
  connectors: Array<{ serverType: string; name: string; description?: string; connected: boolean }>;
  /** The roster ("what can I connect?") rather than named suggestions. */
  listAll: boolean;
  totalCount?: number;
}

/**
 * Connector suggestion card. Display + client-side connect only — there is no
 * server-side action or terminal state for this card on any surface.
 *
 * A connector this user/agent already reaches (personal, agent-pinned or
 * org-shared credentials) is dropped — offering to connect it again is noise —
 * unless one of its calls failed with 401/403 this turn (`blockedConnectors`):
 * then the working credential is not working, and reconnecting is the fix.
 *
 * This resolves WHICH connectors the card offers — the half every surface
 * shares; messaging channels render the same list as buttons
 * (surfaces/messaging/widgets.ts). Null when nothing is left to offer.
 */
export async function resolveSuggestedConnectors(args: {
  suggestions: PendingConnectorSuggestions;
  blockedConnectors: string[] | undefined;
  id: Pick<ConnectorCardIdentity, "agentSlug" | "agentOrgId" | "userId">;
}): Promise<ResolvedConnectorSuggestions | null> {
  const { suggestions, id } = args;
  // Roster mode: the user asked what exists, so the SERVER picks the sample —
  // the model must not decide which connectors represent the catalog.
  // Named connectors win over the roster — mirrors the suggest-connectors tool,
  // for payloads from older claw builds that sent both.
  const listAll = suggestions.listAll === true && suggestions.serverTypes.length === 0;
  const totalCount = listAll
    ? await prisma.mcpServer.count({ where: { enabled: true } })
    : undefined;

  const candidates = listAll
    ? await prisma.mcpServer.findMany({
        where: { enabled: true },
        select: { id: true, type: true, name: true, description: true, connectorMeta: true },
        orderBy: { name: "asc" },
      })
    : await prisma.mcpServer.findMany({
        where: { type: { in: suggestions.serverTypes }, enabled: true },
        select: { id: true, type: true, name: true, description: true, connectorMeta: true },
      });
  const visibleRows = candidates.filter((row) =>
    isVisibleToUser(parseConnectorMeta(row.connectorMeta), id.userId),
  );
  const rows = listAll ? visibleRows.slice(0, MCP_SUGGEST_ROSTER_SAMPLE) : visibleRows;
  const byType = new Map(rows.map((row) => [row.type, row]));

  const availability = await availabilityForServerIds(
    id.userId,
    rows.map((r) => r.id),
    { agentSlug: id.agentSlug, agentOrgId: id.agentOrgId },
  );
  const blockedTypes = new Set(args.blockedConnectors ?? []);

  // Roster mode is already ordered by the query; otherwise preserve the model's
  // ordering, since it ranked them by relevance.
  const ordered = listAll
    ? rows
    : suggestions.serverTypes
        .map((type) => byType.get(type))
        .filter((row): row is NonNullable<typeof row> => !!row);

  const covered = (serverId: string): boolean =>
    availability.personal.has(serverId) || availability.agent.has(serverId) || availability.org.has(serverId);

  const connectors = ordered
    // The roster lists everything with its state; a named suggestion keeps a
    // covered connector only when its credential just failed.
    .filter((row) => listAll || !covered(row.id) || blockedTypes.has(row.type))
    .map((row) => ({
      serverType: row.type,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      connected: covered(row.id),
    }));

  if (connectors.length === 0) {
    log.info(
      `[mcp-suggest] skipped — ${suggestions.serverTypes.join(", ")}: unknown, hidden, or already connected`,
    );
    return null;
  }
  return { connectors, listAll, ...(totalCount !== undefined ? { totalCount } : {}) };
}

export async function renderConnectorSuggestCard(args: {
  suggestions: PendingConnectorSuggestions;
  blockedConnectors: string[] | undefined;
  id: ConnectorCardIdentity;
  target: FlowCardTarget;
}): Promise<FlowDefinition | null> {
  const { suggestions, id } = args;
  const resolved = await resolveSuggestedConnectors(args);
  if (!resolved) return null;
  const { connectors, listAll, totalCount } = resolved;

  const flow = withSpacesAppId(
    buildMcpSuggestFlow({
      connectors,
      ...(suggestions.title
        ? { title: suggestions.title }
        : listAll
          ? { title: "Connectors you can add" }
          : {}),
      ...(listAll ? { browseAll: true } : {}),
      ...(totalCount !== undefined ? { totalCount } : {}),
      screenKey: `${id.userId}-${connectors.map((c) => c.serverType).join("-")}`,
      ...(id.agentSlug ? { agentSlug: id.agentSlug } : {}),
      userId: id.userId,
      conversationId: id.conversationId,
      channelId: id.channelId,
    }),
    id.spacesAppId,
  );
  const posted = await postFlowCard(flow, args.target);
  log.info(`[mcp-suggest] posted ${connectors.length} connector cards conv=${id.conversationId}`);
  return posted;
}

/**
 * What the agent's `suggest-providers` call queued (claw -> callback payload).
 * The ONLY source of a provider card: the server never reads the user's words.
 */
export interface PendingProviderSuggestions {
  providers: string[];
  listAll?: boolean | undefined;
  title?: string | undefined;
}

/**
 * AI provider suggestion card. Display + client-side connect only.
 *
 * A provider the user is already connected to is dropped — offering to connect
 * it again is noise — EXCEPT on a roster ask (`listAll`), where seeing what is
 * already connected is the point of asking. `spaces` is the built-in default
 * and counts as connected everywhere.
 */
export async function renderProviderSuggestCard(args: {
  suggestions: PendingProviderSuggestions;
  id: ConnectorCardIdentity;
  target: FlowCardTarget;
}): Promise<FlowDefinition | null> {
  const { id, suggestions } = args;
  // Named providers win over the roster, mirroring suggest-providers.
  const listAll = suggestions.listAll === true && suggestions.providers.length === 0;
  const named = listAll
    ? []
    : [
        ...new Set(
          suggestions.providers
            .map((name) => normalizeProviderName(name))
            .filter((match): match is NonNullable<typeof match> => match !== null),
        ),
      ];

  if (named.length === 0 && !listAll) {
    log.info(`[provider-suggest] skipped — no known provider in [${suggestions.providers.join(", ")}]`);
    return null;
  }

  const creds = await userProviderCredentialsRepository.listByUser(id.userId).catch(() => []);
  const connectedByProvider = new Map(creds.map((c) => [c.provider, c] as const));
  const isConnected = (provider: string): boolean =>
    provider === "spaces" || connectedByProvider.has(provider);

  const shown = (listAll ? [...SUPPORTED_PROVIDERS] : named).filter(
    (provider) => listAll || !isConnected(provider),
  );

  if (shown.length === 0) {
    log.info(`[provider-suggest] skipped — ${named.join(", ")}: already connected`);
    return null;
  }

  const providers = shown.map((provider) => {
    const cred = connectedByProvider.get(provider);
    return {
      provider,
      name: PROVIDER_LABELS[provider] ?? provider,
      ...(PROVIDER_DESCRIPTIONS[provider]
        ? { description: PROVIDER_DESCRIPTIONS[provider] as string }
        : {}),
      connected: provider === "spaces" ? true : !!cred,
      ...(cred?.sharedCredentialId ? { sharedName: "Shared with your org" } : {}),
      ...(PROVIDER_CONNECT_METHOD[provider]
        ? {
            connectMethod: PROVIDER_CONNECT_METHOD[provider] as
              | "oauth"
              | "device"
              | "api_key"
              | "none",
          }
        : {}),
    };
  });

  const flow = withSpacesAppId(
    buildProviderSuggestFlow({
      providers,
      title:
        suggestions.title?.trim() ||
        (listAll ? "AI providers you can connect" : "Connect this provider"),
      ...(listAll ? { browseAll: true, totalCount: SUPPORTED_PROVIDERS.length } : {}),
      screenKey: `${id.userId}-${shown.join("-")}`,
      ...(id.agentSlug ? { agentSlug: id.agentSlug } : {}),
      userId: id.userId,
      conversationId: id.conversationId,
      channelId: id.channelId,
    }),
    id.spacesAppId,
  );
  const posted = await postFlowCard(flow, args.target);
  log.info(`[provider-suggest] posted ${providers.length} provider cards conv=${id.conversationId}`);
  return posted;
}
