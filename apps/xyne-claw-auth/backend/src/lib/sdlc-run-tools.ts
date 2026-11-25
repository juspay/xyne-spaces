import { sdlcAgentToolProfile, withSdlcToolsConfig, type AgentToolsConfig } from "xyne-claw-shared";
import { tools as xyneSpacesTools } from "../mcp/servers/xyne-spaces-tools.js";
import { redisService } from "../redis.js";

export const SDLC_AGENT_TOOL_PROFILE = sdlcAgentToolProfile(xyneSpacesTools.map((tool) => tool.name));

const SDLC_RUN_TTL_SECONDS = 86400;
const sdlcRunKey = (sessionId: string) => `sdlc-run:${sessionId}`;
const sdlcRunActorKey = (sessionId: string) => `sdlc-run-actor:${sessionId}`;

export interface SdlcRunActor {
  workspaceId: string;
  actorUserId: string;
}

/** start-run adds the SDLC tools to the config it sends claw; this lets the MCP gate admit the same run. */
export async function markSdlcRun(sessionId: string, channelId: string, actor?: SdlcRunActor): Promise<void> {
  const redis = redisService.getConnection();
  await redis.set(sdlcRunKey(sessionId), channelId, "EX", SDLC_RUN_TTL_SECONDS);
  if (actor) await redis.set(sdlcRunActorKey(sessionId), JSON.stringify(actor), "EX", SDLC_RUN_TTL_SECONDS);
}

/** Who the run's SDLC calls act for, from its verified context; null when it has none. */
export async function sdlcRunActor(sessionId: string): Promise<SdlcRunActor | null> {
  // Only markSdlcRun writes it; a corrupt value throws, failing the call closed.
  const raw = await redisService.getConnection().get(sdlcRunActorKey(sessionId)).catch(() => null);
  return raw ? (JSON.parse(raw) as SdlcRunActor) : null;
}

/** The hub a run started in, or null when it did not start in one. */
export async function sdlcRunChannelId(sessionId: string): Promise<string | null> {
  return redisService.getConnection().get(sdlcRunKey(sessionId)).catch(() => null);
}

/** The gate's view of the SDLC tools for a run: the agent's stored selection plus the SDLC profile when the run is in a hub. */
export async function withSdlcRunTools(
  config: AgentToolsConfig | undefined,
  sessionId: string,
): Promise<AgentToolsConfig | undefined> {
  if (!config) return config;
  const isSdlcRun = await redisService.getConnection().exists(sdlcRunKey(sessionId)).catch(() => 0);
  return isSdlcRun ? withSdlcToolsConfig(config as Record<string, unknown>, SDLC_AGENT_TOOL_PROFILE) as AgentToolsConfig : config;
}
