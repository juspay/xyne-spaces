/**
 * Upserts all custom tools from the shared registry into the `tool` table on startup.
 *
 * This ensures any newly-added entry in xyne-claw-shared/src/tools/registry.ts
 * shows up in the agent edit UI immediately after a backend restart, without
 * requiring an admin to call POST /tools/sync.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { SKIP_CATALOG_SOURCES } from "./catalog-skip.js";

import { createLogger } from "./logger.js";
const log = createLogger("bootstrap-tools");

export async function bootstrapCustomTools(): Promise<void> {
  try {
    await prisma.$connect();
    const { getAllCustomTools } = await import("xyne-claw-shared");
    // google/microsoft are NOT in-process custom tools anymore — they run as
    // per-user OAuth MCP connectors (type "google"/"microsoft"; see
    // mcp/servers/google-server.ts). Their tool defs still live in the shared
    // registry (the MCP server reuses them), but they must NOT be seeded into
    // the `tool` catalog as `custom:*` or the agent-config UI lists them under
    // "custom tools" instead of under connectors. tool-sync surfaces them as
    // `mcp:google`/`mcp:microsoft` instead. (Filter shared with routes/tools.ts
    // via catalog-skip.ts so the two upsert paths can't drift.)
    const customTools = getAllCustomTools().filter((ct) => !SKIP_CATALOG_SOURCES.has(ct.source));
    let upserted = 0;
    for (const ct of customTools) {
      await prisma.tool.upsert({
        where: { slug: ct.slug },
        create: {
          slug: ct.slug,
          name: ct.name,
          description: ct.description,
          source: ct.source,
          inputSchema: ct.inputSchema as unknown as Prisma.InputJsonValue,
        },
        update: {
          name: ct.name,
          description: ct.description,
          source: ct.source,
          inputSchema: ct.inputSchema as unknown as Prisma.InputJsonValue,
        },
      });
      upserted++;
    }

    log.info(`[bootstrap-tools] upserted ${upserted} custom tools from shared registry`);
  } catch (err) {
    log.error("[bootstrap-tools] failed:", err);
  }
}
