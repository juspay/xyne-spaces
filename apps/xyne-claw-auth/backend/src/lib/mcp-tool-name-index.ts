import { createLogger } from "../logger.js";
import { redisService } from "../redis.js";
import type { McpToolInfo } from "../mcp/types.js";
import { errMsg } from "./errors.js";

const log = createLogger("mcp-tool-name-index");

export type KnownMcpTool = Pick<McpToolInfo, "name" | "selectionKey">;

const KEY_PREFIX = "claw:mcp-tool-names";
const TTL_SECONDS = 3 * 24 * 60 * 60;

function indexKey(userId: string, serverType: string): string {
  return `${KEY_PREFIX}:${userId}:${serverType}`;
}

function parseKnownTools(raw: string | null): KnownMcpTool[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const tools: KnownMcpTool[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const name = (item as Record<string, unknown>)["name"];
      const selectionKey = (item as Record<string, unknown>)["selectionKey"];
      if (typeof name !== "string" || !name) continue;
      tools.push(typeof selectionKey === "string" && selectionKey ? { name, selectionKey } : { name });
    }
    return tools;
  } catch {
    return null;
  }
}

export async function loadKnownMcpTools(
  userId: string,
  serverTypes: ReadonlyArray<string>,
): Promise<Map<string, KnownMcpTool[]>> {
  const known = new Map<string, KnownMcpTool[]>();
  if (serverTypes.length === 0) return known;
  try {
    const raws = await redisService.getConnection().mget(...serverTypes.map((type) => indexKey(userId, type)));
    serverTypes.forEach((type, i) => {
      const tools = parseKnownTools(raws[i] ?? null);
      if (tools) known.set(type, tools);
    });
  } catch (err) {
    log.warn(`[mcp-tool-name-index] load failed userId=${userId}: ${errMsg(err)}`);
  }
  return known;
}

export async function recordKnownMcpTools(
  userId: string,
  serverType: string,
  tools: ReadonlyArray<KnownMcpTool>,
): Promise<void> {
  if (tools.length === 0) return;
  const payload = tools.map((tool) => (tool.selectionKey ? { name: tool.name, selectionKey: tool.selectionKey } : { name: tool.name }));
  try {
    await redisService.getConnection().set(indexKey(userId, serverType), JSON.stringify(payload), "EX", TTL_SECONDS);
  } catch (err) {
    log.warn(`[mcp-tool-name-index] record failed userId=${userId} server=${serverType}: ${errMsg(err)}`);
  }
}
