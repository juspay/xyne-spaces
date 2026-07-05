/**
 * Discovery Controller
 * Handles service discovery and listing HTTP requests
 */

import type { Response } from "express";
import * as discoveryService from "../services/discovery.js";
import type { GatewayRequest } from "../middleware/gateway-auth.js";

/**
 * GET /gateway/registry/list
 */
export async function listServices(req: GatewayRequest, res: Response): Promise<void> {
  const exists = await discoveryService.tenantExists(req.tenantId!);
  if (!exists) {
    const header = req.headers["x-tenant-id"];
    const tenantIdStr = Array.isArray(header) ? header[0] : header;
    res.status(401).json({ success: false, error: `Tenant not found: ${tenantIdStr}` });
    return;
  }

  const { services, count } = await discoveryService.listServicesForTenant(req.tenantId!);

  res.json({
    success: true,
    tenantId: req.tenantId,
    serviceCount: count,
    services,
  });
}

/**
 * GET /gateway/registry/service/:serviceName
 */
export async function getService(req: GatewayRequest, res: Response): Promise<void> {
  const serviceName = req.params.serviceName;
  if (!serviceName) {
    res.status(400).json({ success: false, error: "Missing serviceName" });
    return;
  }

  const exists = await discoveryService.tenantExists(req.tenantId!);
  if (!exists) {
    const header = req.headers["x-tenant-id"];
    const tenantIdStr = Array.isArray(header) ? header[0] : header;
    res.status(401).json({ success: false, error: `Tenant not found: ${tenantIdStr}` });
    return;
  }

  const { backends, count } = await discoveryService.getServiceBackends(req.tenantId!, serviceName as string);

  if (count === 0) {
    res.status(404).json({
      success: false,
      error: `Service not found: ${serviceName}`,
      serviceName,
      tenantId: req.tenantId,
    });
    return;
  }

  res.json({
    success: true,
    tenantId: req.tenantId,
    serviceName,
    backendCount: count,
    backends,
  });
}
