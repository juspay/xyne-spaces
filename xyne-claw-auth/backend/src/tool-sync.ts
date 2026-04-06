import { prisma } from "./db.js";
import { listToolsForUser } from "./mcp/runner.js";
import type { Prisma } from "@prisma/client";

export async function syncToolsForServer(
  userId: string,
  serverType: string,
  serverName: string,
  credentials: Record<string, unknown>,
): Promise<number> {
  const result = await listToolsForUser(userId, serverType, serverName, credentials);
  let count = 0;

  for (const tool of result.tools) {
    const slug = `${serverType}__${tool.name}`;
    await prisma.tool.upsert({
      where: { slug },
      create: {
        slug,
        name: tool.name,
        description: tool.description,
        source: `mcp:${serverType}`,
        inputSchema: tool.inputSchema as Prisma.InputJsonValue,
      },
      update: {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Prisma.InputJsonValue,
      },
    });
    count++;
  }

  console.log(`[tool-sync] Registered ${count} tools from ${serverType}`);
  return count;
}
