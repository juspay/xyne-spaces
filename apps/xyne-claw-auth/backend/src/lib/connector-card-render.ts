import {
  buildMcpSuggestFlow,
  buildProviderSuggestFlow,
  withSpacesAppId,
  type FlowDefinition,
} from "xyne-claw-shared";
import { SUPPORTED_PROVIDERS } from "../constants.js";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { userProviderCredentialsRepository } from "../repositories/index.js";
import { isVisibleToUser, parseConnectorMeta } from "../routes/servers.js";
import { availabilityForServerIds } from "./connector-availability.js";
import {
  connectorTypesFromText,
  connectorTypesUserAskedFor,
  wantsConnectorRoster,
} from "./connector-hints.js";
import { postFlowCard, type FlowCardTarget } from "./flow-card-delivery.js";
import {
  PROVIDER_CONNECT_METHOD,
  PROVIDER_DESCRIPTIONS,
  PROVIDER_LABELS,
  providersUserAskedFor,
  stripAddressedAgentMention,
  unsupportedProvidersFromText,
  wantsProviderRoster,
} from "./provider-hints.js";

const log = createLogger("connector-card");

/** How many roster rows a "what connectors exist?" card samples. */
const MCP_SUGGEST_ROSTER_SAMPLE = 5;
/** Cap on server-inferred connector types, so a vague task cannot flood the card. */
const MCP_SUGGEST_INFERRED_MAX = 3;

export interface PendingConnectorSuggestions {
  serverTypes: string[];
  listAll?: boolean | undefined;
  inferred?: boolean | undefined;
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

/**
 * Compose the connector suggestion the card is built from. The model's own ask
 * wins; otherwise the server reads the user's words, because the model
 * routinely misses the moment — most often by assuming a connector is already
 * connected, which is exactly when the offer matters most.
 */
export function resolveConnectorSuggestions(
  fromModel: PendingConnectorSuggestions | undefined,
  taskText: string,
): PendingConnectorSuggestions | undefined {
  if (fromModel) return fromModel;
  // Fail-safe: a suggestion is never worth costing the user their answer.
  let inferredTypes: string[] = [];
  try {
    inferredTypes = connectorTypesFromText(taskText, { includeKeywords: true }).slice(
      0,
      MCP_SUGGEST_INFERRED_MAX,
    );
  } catch (err) {
    log.warn("[mcp-suggest] connector inference failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (wantsConnectorRoster(taskText)) return { serverTypes: [], listAll: true, inferred: true };
  if (inferredTypes.length > 0) return { serverTypes: inferredTypes, inferred: true };
  return undefined;
}

/**
 * Connector suggestion card. Display + client-side connect only — there is no
 * server-side action or terminal state for this card on any surface.
 */
export async function renderConnectorSuggestCard(args: {
  suggestions: PendingConnectorSuggestions;
  blockedConnectors: string[] | undefined;
  taskText: string;
  id: ConnectorCardIdentity;
  target: FlowCardTarget;
}): Promise<FlowDefinition | null> {
  const { suggestions, id } = args;
  // Roster mode: the user asked what exists, so the SERVER picks the sample —
  // the model must not decide which connectors represent the catalog.
  const listAll = suggestions.listAll === true;
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

  const inferred = suggestions.inferred === true;
  // Derived from the user's own words, never from the model's claim.
  const askedToConnect = new Set(connectorTypesUserAskedFor(args.taskText));

  const connectors = ordered
    .filter((row) => {
      if (listAll || askedToConnect.has(row.type)) return true;
      if (availability.personal.has(row.id)) return false;
      if (availability.agent.has(row.id) || availability.org.has(row.id)) return blockedTypes.has(row.type);
      return true;
    })
    .map((row) => ({
      serverType: row.type,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      connected: availability.personal.has(row.id) || availability.agent.has(row.id) || availability.org.has(row.id),
    }));

  if (connectors.length === 0) {
    log.info(
      `[mcp-suggest] skipped — none of ${suggestions.serverTypes.join(", ")} are known connectors`,
    );
    return null;
  }

  const flow = withSpacesAppId(
    buildMcpSuggestFlow({
      connectors,
      ...(suggestions.title
        ? { title: suggestions.title }
        : listAll
          ? { title: "Connectors you can add" }
          : {}),
      ...(listAll ? { browseAll: true } : {}),
      ...(inferred && !suggestions.title ? { title: "Connect to unlock this" } : {}),
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
 * AI provider suggestion card. The roster is a fixed list in code, so intent is
 * read from the user's own message and the model never participates. A provider
 * we do not offer is named back as unsupported rather than dropped, so the reply
 * cannot promise a card that will never render.
 */
export async function renderProviderSuggestCard(args: {
  taskText: string;
  id: ConnectorCardIdentity;
  target: FlowCardTarget;
}): Promise<FlowDefinition | null> {
  const { id } = args;
  const askText = stripAddressedAgentMention(args.taskText, id.agentSlug);
  const namedProviders = providersUserAskedFor(askText);
  const unsupported = unsupportedProvidersFromText(askText);
  const providerRoster = wantsProviderRoster(askText);

  if (namedProviders.length === 0 && !providerRoster) {
    if (unsupported.length > 0) {
      log.info(`[provider-suggest] unsupported only: ${unsupported.join(", ")} — no card`);
    }
    return null;
  }

  const creds = await userProviderCredentialsRepository.listByUser(id.userId).catch(() => []);
  const connectedByProvider = new Map(creds.map((c) => [c.provider, c] as const));

  const shown = providerRoster ? [...SUPPORTED_PROVIDERS] : namedProviders;
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
      title: providerRoster ? "AI providers you can connect" : "Connect this provider",
      ...(providerRoster ? { browseAll: true, totalCount: SUPPORTED_PROVIDERS.length } : {}),
      ...(unsupported.length > 0
        ? {
            reason: `${unsupported.join(", ")} ${unsupported.length === 1 ? "is" : "are"} not available on Xyne.`,
          }
        : {}),
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
