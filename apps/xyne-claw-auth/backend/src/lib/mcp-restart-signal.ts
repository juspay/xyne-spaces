import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { restartMcpServers } from "../mcp/runner.js";

const log = createLogger("mcp-restart");

const CHANNEL = "claw:mcp:restart";

let subscribed = false;

export function startMcpRestartListener(): void {
  if (subscribed) return;
  subscribed = true;
  const sub = redisService.getConnection().duplicate();
  sub
    .subscribe(CHANNEL)
    .then(() => log.info(`[mcp-restart] subscribed to ${CHANNEL}`))
    .catch((err) => {
      sub.disconnect();
      subscribed = false;
      log.error(`[mcp-restart] subscribe failed: ${errMsg(err)}`);
    });
  sub.on("message", (_channel: string, raw: string) => {
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
