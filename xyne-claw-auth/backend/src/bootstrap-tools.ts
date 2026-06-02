/**
 * Upserts all custom tools from the shared registry into the `tool` table on startup.
 *
 * This ensures any newly-added entry in xyne-claw-shared/src/tools/registry.ts
 * shows up in the agent edit UI immediately after a backend restart, without
 * requiring an admin to call POST /tools/sync.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

export async function bootstrapCustomTools(): Promise<void> {
  try {
    await prisma.$connect();
    const { getAllCustomTools } = await import("xyne-claw-shared");
    const customTools = getAllCustomTools();
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
    console.log(`[bootstrap-tools] upserted ${upserted} custom tools from shared registry`);
  } catch (err) {
    console.error("[bootstrap-tools] failed:", err);
  }
}
