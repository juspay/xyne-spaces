import { sdlcAgentToolProfile, withSdlcToolsConfig, type AgentToolsConfig } from "xyne-claw-shared";
import { tools as xyneSpacesTools } from "../mcp/servers/xyne-spaces-tools.js";
import { redisService } from "../redis.js";

export const SDLC_AGENT_TOOL_PROFILE = sdlcAgentToolProfile(xyneSpacesTools.map((tool) => tool.name));

const SDLC_RUN_TTL_SECONDS = 86400;
const sdlcRunKey = (sessionId: string) => `sdlc-run:${sessionId}`;

/** start-run adds the SDLC tools to the config it sends claw; this lets the MCP gate admit the same run. */
export async function markSdlcRun(sessionId: string, channelId: string): Promise<void> {
  await redisService.getConnection().set(sdlcRunKey(sessionId), channelId, "EX", SDLC_RUN_TTL_SECONDS);
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
