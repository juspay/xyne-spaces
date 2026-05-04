import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { listToolsForUser, callTool } from "../mcp/runner.js";
import { hasConnectorDefinition, resolveConnectorDefinition } from "../mcp/connector-definitions.js";
import { BITBUCKET_CUSTOM_TOOLS, handleUploadPrScreenshot } from "../mcp/adapters/bitbucket.js";
import { GRAFANA_CUSTOM_TOOLS, handleGrafanaQueryLogs, handleGrafanaListMetrics, handleGrafanaQueryMetrics, handleGrafanaQueryDatabase } from "../mcp/adapters/grafana.js";

function signAction(action: Record<string, unknown>): string {
  return crypto.createHmac("sha256", CONFIG.encryptionKey).update(JSON.stringify(action)).digest("hex");
}

export function verifyActionSignature(action: Record<string, unknown>, signature: string): boolean {
  const expected = signAction(action);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

const router = Router();

router.get("/:userId/mcp/tools", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;

    const connections = await prisma.userMcpConnection.findMany({
      where: { userId },
      include: { mcpServer: true },
    });

    const results = await Promise.allSettled(
      connections.map(async (c) => {
        if (!(await hasConnectorDefinition(c.mcpServer.type))) {
          return null;
        }

        const decrypted = decrypt(c.encryptedCreds, c.iv, c.authTag, CONFIG.encryptionKey);
        const credentials = JSON.parse(decrypted) as Record<string, unknown>;

        return listToolsForUser(userId, c.mcpServer.type, c.mcpServer.name, credentials);
      }),
    );

    const data = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof listToolsForUser>> | null> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((v): v is Awaited<ReturnType<typeof listToolsForUser>> => v !== null);

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

    if (errors.length > 0) {
      console.error("[mcp/tools] Some servers failed to list tools:", errors);
    }

    // Inject custom tools for servers that have them
    const hasBitbucket = data.some((s) => s.serverType === "bitbucket");
    if (hasBitbucket) {
      const bbServer = data.find((s) => s.serverType === "bitbucket");
      if (bbServer) {
        (bbServer.tools as typeof BITBUCKET_CUSTOM_TOOLS).push(...BITBUCKET_CUSTOM_TOOLS);
      }
    }

    // Inject Grafana custom tools based on DB connections, not MCP server success
    // (MCP server may fail due to uvx/token issues but custom tools work independently)
    const grafanaConn = connections.find((c) => c.mcpServer.type === "grafana");
    if (grafanaConn) {
      let gfServer = data.find((s) => s.serverType === "grafana");
      if (!gfServer) {
        // MCP server failed — create a stub so custom tools still appear
        gfServer = { serverType: "grafana", serverName: grafanaConn.mcpServer.name, tools: [], writeTools: [] };
        data.push(gfServer);
      }
      (gfServer.tools as typeof GRAFANA_CUSTOM_TOOLS).push(...GRAFANA_CUSTOM_TOOLS);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("[mcp/tools] error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:userId/mcp/call", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { serverType, tool, params, permission } = req.body as {
      serverType?: string;
      tool?: string;
      params?: Record<string, unknown>;
      permission?: string;
    };

    if (!serverType || typeof serverType !== "string") {
      res.status(400).json({ success: false, error: "serverType is required" });
      return;
    }

    if (!tool || typeof tool !== "string") {
      res.status(400).json({ success: false, error: "tool is required" });
      return;
    }

    if (!(await hasConnectorDefinition(serverType))) {
      res.status(400).json({ success: false, error: `No adapter for server type: ${serverType}` });
      return;
    }

    const connection = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServer: { type: serverType } },
      include: { mcpServer: true },
    });

    if (!connection) {
      res.status(404).json({ success: false, error: `No connection found for user and server type: ${serverType}` });
      return;
    }

    const decrypted = decrypt(
      connection.encryptedCreds,
      connection.iv,
      connection.authTag,
      CONFIG.encryptionKey,
    );
    const credentials = JSON.parse(decrypted) as Record<string, unknown>;

    // Write tools always require approval — cannot be overridden by agent config
    const definition = await resolveConnectorDefinition(serverType);
    const isWriteTool = definition?.writeTools?.includes(tool) ?? false;
    const effectivePermission = isWriteTool ? "ask" : (permission ?? "allow");

    console.log(`[mcp/call] user=${userId} server=${serverType} tool=${tool} permission=${effectivePermission}${isWriteTool ? " (write-tool, forced ask)" : ""}`);

    if (effectivePermission === "ask") {
      const action = { serverType, tool, params: params ?? {}, userId };
      const signature = signAction(action);
      res.json({ success: true, data: { content: `Action queued for approval: ${tool}`, pendingAction: { ...action, signature } } });
      return;
    }

    // Handle custom tools locally instead of forwarding to MCP server
    if (serverType === "bitbucket" && tool === "upload-pr-screenshot") {
      const content = await handleUploadPrScreenshot(credentials, params ?? {});
      res.json({ success: true, data: { content } });
      return;
    }

    // Handle Grafana custom tools locally
    if (serverType === "grafana" && tool.startsWith("grafana-")) {
      try {
        let content: string;
        const p = params ?? {};
        switch (tool) {
          case "grafana-query-logs": content = await handleGrafanaQueryLogs(credentials, p); break;
          case "grafana-list-metrics": content = await handleGrafanaListMetrics(credentials, p); break;
          case "grafana-query-metrics": content = await handleGrafanaQueryMetrics(credentials, p); break;
          case "grafana-query-database": content = await handleGrafanaQueryDatabase(credentials, p); break;
          default: content = `Unknown grafana tool: ${tool}`;
        }
        res.json({ success: true, data: { content } });
      } catch (err) {
        res.json({ success: true, data: { content: `Error: ${err instanceof Error ? err.message : String(err)}` } });
      }
      return;
    }

    // Handle spaces-trigger-agent locally — call /run to start the target agent
    if (serverType === "xyne-spaces" && tool === "spaces-trigger-agent") {
      const p = params ?? {};
      const targetAgent = p["targetAgent"] as string;
      const task = p["task"] as string;
      const convId = p["conversationId"] as string | undefined;
      const chanId = p["channelId"] as string | undefined;

      if (!targetAgent || !task) {
        res.status(400).json({ success: false, error: "targetAgent and task are required" });
        return;
      }

      try {
        const runUrl = `${CONFIG.selfUrl}/claw/api/v1/run`;
        const runRes = await fetch(runUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            task: `${task}\n\n## Session Metadata\n- channelId: ${chanId ?? "unknown"}\n- conversationId: ${convId ?? "unknown"}`,
            agentSlug: targetAgent,
            ...(chanId ? { channelId: chanId } : {}),
            // Don't pass conversationId — it causes session resume with prior agent context.
            // Session Metadata is injected into the task text instead.
            callbackUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/result`,
          }),
        });

        const runBody = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };

        if (!runBody.success) {
          res.json({ success: true, data: { content: `Failed to trigger ${targetAgent}: ${runBody.error ?? "unknown error"}` } });
          return;
        }

        // Store session context for the callback
        const { setSession } = await import("./webhook.js");
        const targetAgentRow = await prisma.agent.findUnique({ where: { slug: targetAgent } });
        if (targetAgentRow?.spacesAppToken && targetAgentRow.spacesAppId && chanId && convId) {
          const appToken = decrypt(
            ...targetAgentRow.spacesAppToken.split(":") as [string, string, string],
            CONFIG.encryptionKey,
          );
          await setSession(runBody.sessionId!, {
            mentionedUserId: targetAgentRow.spacesAppUserId ?? "",
            senderId: userId,
            senderName: "",
            channelId: chanId,
            channelName: chanId,
            conversationId: convId,
            task,
            agentSlug: targetAgent,
            responseMode: "conversation",
            appToken,
            spacesAppId: targetAgentRow.spacesAppId,
            spacesAppUserId: targetAgentRow.spacesAppUserId ?? "",
          });
        }

        console.log(`[mcp/trigger-agent] Triggered ${targetAgent} → session ${runBody.sessionId}`);
        res.json({ success: true, data: { content: `Triggered ${targetAgent}. Session: ${runBody.sessionId}` } });
      } catch (err) {
        console.error("[mcp/trigger-agent] error:", err);
        res.json({ success: true, data: { content: `Failed to trigger ${targetAgent}: ${err instanceof Error ? err.message : "unknown"}` } });
      }
      return;
    }

    const result = await callTool(userId, serverType, credentials, tool, params ?? {});

    res.json({ success: true, data: result });
  } catch (err) {
    console.error("[mcp/call] error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * POST /:userId/actions/sign
 * Sign a write-tool action so it can be verified on approval.
 * Called by xyne-claw for custom write tools (e.g. Google tools).
 */
router.post("/:userId/actions/sign", (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { serverType, tool, params } = req.body as {
      serverType?: string;
      tool?: string;
      params?: Record<string, unknown>;
    };

    if (!serverType || !tool) {
      res.status(400).json({ success: false, error: "serverType and tool are required" });
      return;
    }

    const action = { serverType, tool, params: params ?? {}, userId };
    const signature = signAction(action);

    console.log(`[actions/sign] Signed write action: user=${userId} server=${serverType} tool=${tool}`);

    res.json({ success: true, data: { ...action, signature } });
  } catch (err) {
    console.error("[actions/sign] error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as mcpRouter };
