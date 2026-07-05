/**
 * Registration Controller
 * Handles service registration and deregistration HTTP requests
 */

import type { Response } from "express";
import * as registrationService from "../services/registration.js";
import type { GatewayRequest } from "../middleware/gateway-auth.js";
import type { ServiceRegistration } from "../types/index.js";

/**
 * POST /gateway/registry/register
 */
export async function register(req: GatewayRequest, res: Response): Promise<void> {
  const tokenEndpointUrl = req.body.tokenEndpointUrl || req.body.token_endpoint_url || req.body.tokenEndpoint;

  console.log("[gateway/register] incoming request", {
    tenantId: req.tenantId,
    serviceName: req.body.serviceName,
    backendId: req.body.backendId,
    toolCount: Array.isArray(req.body.tools) ? req.body.tools.length : 0,
    xAuthHeaderName: req.body.xAuthHeaderName || req.body["x-auth-headerName"] || null,
    hasTokenEndpointUrl: Boolean(tokenEndpointUrl),
  });

  const registration: ServiceRegistration = {
    serviceName: req.body.serviceName,
    backendId: req.body.backendId,
    backendUrl: req.body.backendUrl,
    tools: req.body.tools,
    xAuthHeaderName: req.body.xAuthHeaderName || req.body["x-auth-headerName"],
    tokenEndpointUrl,
  };

  const result = await registrationService.registerService(req.tenantId!, registration);
  res.json(result);
}

/**
 * DELETE /gateway/registry/:serviceName
 */
export async function deregister(req: GatewayRequest, res: Response): Promise<void> {
  const serviceName = req.params.serviceName;
  if (!serviceName) {
    res.status(400).json({ success: false, error: "Missing serviceName" });
    return;
  }
  const result = await registrationService.deregisterService(req.tenantId!, serviceName as string);
  res.json(result);
}
