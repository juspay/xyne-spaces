/**
 * Execution Controller
 * Handles tool execution HTTP requests
 */

import type { Response } from "express";
import * as executionService from "../services/execution.js";
import { getAuthEmail } from "../middleware/validation.js";
import type { GatewayRequest } from "../middleware/gateway-auth.js";

/**
 * POST /gateway/registry/execute
 */
export async function executeTool(req: GatewayRequest, res: Response): Promise<void> {
  const authEmail = getAuthEmail(req);

  if (!authEmail) {
    res.status(401).json({ success: false, error: "Missing X-Auth-Email header" });
    return;
  }

  const { serviceName, toolName, arguments: toolArgs, backendId } = req.body;

  if (!serviceName || !toolName || !toolArgs) {
    res.status(400).json({
      success: false,
      error: "Missing required fields: serviceName, toolName, arguments",
    });
    return;
  }

  const result = await executionService.executeTool(req.tenantId!, authEmail, {
    serviceName,
    toolName,
    arguments: toolArgs,
    backendId,
  });

  if (result.success) {
    res.json(result);
  } else {
    const statusCode = result.backendStatus || 500;
    res.status(statusCode).json(result);
  }
}
