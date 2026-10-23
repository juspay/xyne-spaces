import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { restartMcpServers, evictSessionLocal, MCP_EVICT_CHANNEL } from "../mcp/runner.js";

const log = createLogger("mcp-restart");

const CHANNEL = "claw:mcp:restart";

let subscribed = false;

export function startMcpRestartListener(): void {
  if (subscribed) return;
  subscribed = true;
  const sub = redisService.getConnection().duplicate();
  sub
    .subscribe(CHANNEL, MCP_EVICT_CHANNEL)
    .then(() => log.info(`[mcp-restart] subscribed to ${CHANNEL}, ${MCP_EVICT_CHANNEL}`))
    .catch((err) => {
      sub.disconnect();
      subscribed = false;
      log.error(`[mcp-restart] subscribe failed: ${errMsg(err)}`);
    });
  sub.on("message", (channel: string, raw: string) => {
    if (channel === MCP_EVICT_CHANNEL) {
      let userId: string | undefined;
      let serverType: string | undefined;
      let agentSlug: string | undefined;
      try {
        const parsed = JSON.parse(raw) as { userId?: unknown; serverType?: unknown; agentSlug?: unknown };
        userId = typeof parsed.userId === "string" && parsed.userId ? parsed.userId : undefined;
        serverType = typeof parsed.serverType === "string" && parsed.serverType ? parsed.serverType : undefined;
        agentSlug = typeof parsed.agentSlug === "string" && parsed.agentSlug ? parsed.agentSlug : undefined;
      } catch {
        return;
      }
      if (!userId || !serverType) return;
      evictSessionLocal(userId, serverType, agentSlug).catch((err) =>
        log.error(`[mcp-restart] evict failed: ${errMsg(err)}`),
      );
      return;
    }
    let serverType: string | undefined;
    try {
      const parsed = JSON.parse(raw) as { serverType?: unknown };
      serverType = typeof parsed.serverType === "string" && parsed.serverType ? parsed.serverType : undefined;
    } catch {
      serverType = undefined;
    }
    restartMcpServers(serverType).catch((err) => log.error(`[mcp-restart] restart failed: ${errMsg(err)}`));
  });
  sub.on("error", (err: Error) => log.error(`[mcp-restart] subscriber error: ${err.message}`));
}

export async function broadcastMcpRestart(serverType?: string): Promise<number> {
  return redisService.getConnection().publish(CHANNEL, JSON.stringify(serverType ? { serverType } : {}));
}
