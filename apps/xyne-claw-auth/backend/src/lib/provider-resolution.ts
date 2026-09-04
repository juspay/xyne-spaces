import {
  userAgentConfigRepository,
  userProviderCredentialsRepository,
  agentProviderCredentialsRepository,
  userSubagentConfigRepository,
} from "../repositories/index.js";
import {
  resolveSubagentProviderMode,
  KNOWN_PROVIDERS,
  buildProviderConfig,
  agentDefaultSpeed,
  providerConfigForSpeed,
  applyFastModeModels,
  type ModelSpeed,
  type ProviderConfig,
  type SubagentProviderMode,
} from "./agent-provider-config.js";
import { errMsg } from "./errors.js";
import { isLocalHarnessProvider } from "xyne-claw-shared";
import { createLogger } from "../logger.js";

const defaultLog = createLogger("provider-resolution");

type ResolutionLogger = Pick<ReturnType<typeof createLogger>, "info" | "warn">;

export interface ProviderResolutionInput {
  targetUserId: string;
  agent: { id?: string; orgId?: string | null; slug: string };
  agentRow?: { id?: string; config?: unknown } | null;
  conversationId?: string | undefined;
  log?: ResolutionLogger;
}

export interface ProviderResolution {
  resolvedParentProvider?: string | undefined;
  runtimeProviderOrder: string[];
  providerConfigs: Record<string, ProviderConfig>;
  providerScope: Record<string, "user" | "agent">;
  subagentProviders: Record<string, string>;
  subagentProviderMode: SubagentProviderMode;
  userDeferredToAgent: boolean;
  personalProvider?: string | undefined;
  rawPersonalProvider?: string | undefined;
  agentLevelProvider?: string | undefined;
  agentProviderOrder: string[];
  mentionSpeed: ModelSpeed;
}

type SharedCredRow = { sharedCredentialId?: string | null };

export async function resolveProvidersForDispatch(
  input: ProviderResolutionInput,
): Promise<ProviderResolution> {
  const { targetUserId, agent, agentRow } = input;
  const log = input.log ?? defaultLog;

  const userAgentConfig = agent.orgId
    ? await userAgentConfigRepository.findByUserAndAgent(targetUserId, agent.orgId, agent.slug).catch(() => null)
    : null;
  const rawPersonalProvider = userAgentConfig?.provider;
  const selectedPersonalProvider = rawPersonalProvider && rawPersonalProvider !== "spaces" ? rawPersonalProvider : undefined;
  const personalProvider = isLocalHarnessProvider(selectedPersonalProvider) ? undefined : selectedPersonalProvider;
  const userDeferredToAgent = rawPersonalProvider === "spaces";

  const mentionSpeed = agentDefaultSpeed(agentRow?.config);
  const mentionSpeedConfig = providerConfigForSpeed(agentRow?.config, mentionSpeed);
  const agentLevelProvider = mentionSpeedConfig["provider"] as string | undefined;
  const rawProviderOrder = mentionSpeedConfig["providerOrder"];
  const agentProviderOrder: string[] = Array.isArray(rawProviderOrder)
    ? rawProviderOrder.filter((p): p is string => typeof p === "string" && KNOWN_PROVIDERS.has(p))
    : [];

  const allCreds = await userProviderCredentialsRepository.listByUser(targetUserId).catch(() => []);
  const credsByProvider = new Map(allCreds.map((c) => [c.provider, c] as const));

  const agentCreds = agentRow?.id
    ? await agentProviderCredentialsRepository.listByAgent(agentRow.id).catch(() => [])
    : [];
  const agentCredsByProvider = new Map(agentCreds.map((c) => [c.provider, c] as const));

  const subagentConfigs = await userSubagentConfigRepository.listByUser(targetUserId).catch(() => []);
  const subagentProviders: Record<string, string> = {};
  for (const s of subagentConfigs) subagentProviders[s.subagentName] = s.provider;
  const subagentProviderMode = resolveSubagentProviderMode(agentRow?.config);

  const providerConfigs: Record<string, ProviderConfig> = {};
  const providerScope: Record<string, "user" | "agent"> = {};
  const addConfigs = (rows: Map<string, unknown>, scope: "user" | "agent") => {
    for (const [provider, row] of rows) {
      if (providerConfigs[provider]) continue;
      const cfg = buildProviderConfig(provider, row as Parameters<typeof buildProviderConfig>[1]);
      if (cfg) {
        providerConfigs[provider] = cfg;
        providerScope[provider] = scope;
      }
    }
  };
  if (!userDeferredToAgent) addConfigs(credsByProvider, "user");
  addConfigs(agentCredsByProvider, "agent");
  applyFastModeModels(providerConfigs, agentRow?.config, mentionSpeed);

  // No OAuth-bearer refreshable creds remain: Claude + Codex OAuth were
  // removed; claude/codex credentials are plain API keys (no expiry, no
  // refresh). Copilot OAuth is GitHub's — refreshed through its own path.
  const hasCreds = (p: string | undefined): p is string => !!p && !!providerConfigs[p];

  const runtimeProviderOrder: string[] = [];
  for (const p of [personalProvider, ...agentProviderOrder, agentLevelProvider]) {
    if (p === "spaces") break;
    if (hasCreds(p) && !runtimeProviderOrder.includes(p)) runtimeProviderOrder.push(p);
  }
  const resolvedParentProvider = runtimeProviderOrder[0];

  log.info(`Provider resolution: parent=${resolvedParentProvider ?? "spaces"} scope=${resolvedParentProvider ? (providerScope[resolvedParentProvider] ?? "fallback") : "platform"} creds=[${Object.keys(providerConfigs).join(",")}] order=[${runtimeProviderOrder.join(",")}] subagentOverrides=${JSON.stringify(subagentProviders)} subagentProviderMode=${subagentProviderMode}`);

  return {
    resolvedParentProvider,
    runtimeProviderOrder,
    providerConfigs,
    providerScope,
    subagentProviders,
    subagentProviderMode,
    userDeferredToAgent,
    personalProvider,
    rawPersonalProvider,
    agentLevelProvider,
    agentProviderOrder,
    mentionSpeed,
  };
}
