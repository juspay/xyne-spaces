import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { hasConnectorDefinition, resolveConnectorDefinition } from "../mcp/connector-definitions.js";
import { syncToolsForServer } from "../tool-sync.js";
import { requireClawAdmin } from "../middleware/agent-acl.js";

const router = Router();

// List available subagents, MCP servers, and direct tools for agent creation
router.get("/available", async (_req: Request, res: Response) => {
  try {
    const { SUBAGENT_DEFINITIONS } = await import("xyne-claw-shared");

    // Get MCP servers (available integrations)
    const servers = await prisma.mcpServer.findMany({ orderBy: { name: "asc" } });

    // Get all tools grouped by source
    const tools = await prisma.tool.findMany({ orderBy: [{ source: "asc" }, { name: "asc" }] });

    // Subagents from shared definitions. Expose progressLabel (first entry for
    // legacy frontend consumers) + progressLabels (array for clients that want variety).
    const subagents = SUBAGENT_DEFINITIONS.map((d) => ({
      name: d.name,
      description: d.description,
      serverType: d.serverType,
      progressLabel: d.progressLabels[0] ?? "",
      progressLabels: d.progressLabels,
    }));

    // Direct tools = tools marked as write tools in adapters
    const writeTools: Array<{ name: string; source: string }> = [];
    for (const server of servers) {
      const definition = await resolveConnectorDefinition(server.type);
      for (const toolName of definition?.writeTools ?? []) {
        writeTools.push({ name: toolName, source: server.type });
      }
    }

    // Custom tool sources (pgm, google, research-agent, etc.)
    const customSources = [...new Set(tools.filter((t) => t.source.startsWith("custom:")).map((t) => t.source))];
    const customGroups = customSources.map((source) => ({
      source,
      tools: tools.filter((t) => t.source === source).map((t) => ({ slug: t.slug, name: t.name })),
    }));

    // Group all tools by MCP server type (for subagent:tool cascading selector)
    const serverTools: Record<string, Array<{ slug: string; name: string }>> = {};
    // From DB (synced tools) — strip "mcp:" prefix to match subagent serverType
    for (const tool of tools) {
      if (tool.source.startsWith("custom:")) continue;
      const key = tool.source.startsWith("mcp:") ? tool.source.slice(4) : tool.source;
      const list = serverTools[key] ?? [];
      if (!list.some((t) => t.name === tool.name)) list.push({ slug: tool.slug, name: tool.name });
      serverTools[key] = list;
    }
    // Ensure write tools from adapters are included even if not synced
    for (const server of servers) {
      const type = server.type;
      const definition = await resolveConnectorDefinition(type);
      const list = serverTools[type] ?? [];
      for (const toolName of definition?.writeTools ?? []) {
        if (!list.some((t) => t.name === toolName)) list.push({ slug: toolName, name: toolName });
      }
      serverTools[type] = list;
    }
    // Include custom tool groups
    for (const group of customSources) {
      const groupTools = tools.filter((t) => t.source === group).map((t) => ({ slug: t.slug, name: t.name }));
      if (groupTools.length > 0) serverTools[group] = groupTools;
    }

    res.json({
      success: true,
      data: { subagents, mcpServers: servers, writeTools, customGroups, serverTools },
    });
  } catch (err) {
    console.error("[tools] available error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const tools = await prisma.tool.findMany({
      orderBy: [{ source: "asc" }, { name: "asc" }],
    });
    res.json({ success: true, data: tools });
  } catch (err) {
    console.error("[tools] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/sync", requireClawAdmin, async (_req: Request, res: Response) => {
  try {
    // Find all connections grouped by server type, pick one per type
    const connections = await prisma.userMcpConnection.findMany({
      include: { mcpServer: true },
      distinct: ["mcpServerId"],
    });

    let totalSynced = 0;
    const errors: string[] = [];

    for (const conn of connections) {
      if (!(await hasConnectorDefinition(conn.mcpServer.type))) continue;

      try {
        const decrypted = decrypt(conn.encryptedCreds, conn.iv, conn.authTag, CONFIG.encryptionKey);
        const credentials = JSON.parse(decrypted) as Record<string, unknown>;
        const count = await syncToolsForServer(conn.userId, conn.mcpServer.type, conn.mcpServer.name, credentials);
        totalSynced += count;
      } catch (err) {
        const msg = `${conn.mcpServer.type}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        console.error(`[tools/sync] ${msg}`);
      }
    }

    // Also ensure builtin tools exist
    const builtins = [
      { slug: "builtin__bash", name: "bash", description: "Execute shell commands", source: "builtin" },
      { slug: "builtin__read", name: "read", description: "Read files", source: "builtin" },
      { slug: "builtin__write", name: "write", description: "Write files", source: "builtin" },
      { slug: "builtin__edit", name: "edit", description: "Edit files", source: "builtin" },
      { slug: "builtin__grep", name: "grep", description: "Search file contents with regex", source: "builtin" },
      { slug: "builtin__find", name: "find", description: "Find files by pattern", source: "builtin" },
      { slug: "builtin__ls", name: "ls", description: "List directory contents", source: "builtin" },
    ];

    for (const b of builtins) {
      await prisma.tool.upsert({
        where: { slug: b.slug },
        create: b,
        update: { name: b.name, description: b.description },
      });
    }
    totalSynced += builtins.length;

    // Sync custom tools from shared registry (pgm, google, research-agent, etc.)
    const { getAllCustomTools } = await import("xyne-claw-shared");
    const customTools = getAllCustomTools();
    for (const ct of customTools) {
      await prisma.tool.upsert({
        where: { slug: ct.slug },
        create: {
          slug: ct.slug,
          name: ct.name,
          description: ct.description,
          source: ct.source,
          inputSchema: ct.inputSchema as unknown as import("@prisma/client").Prisma.InputJsonValue,
        },
        update: {
          name: ct.name,
          description: ct.description,
          source: ct.source,
          inputSchema: ct.inputSchema as unknown as import("@prisma/client").Prisma.InputJsonValue,
        },
      });
    }
    totalSynced += customTools.length;

    res.json({ success: true, data: { synced: totalSynced, errors } });
  } catch (err) {
    console.error("[tools/sync] error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as toolsRouter };
