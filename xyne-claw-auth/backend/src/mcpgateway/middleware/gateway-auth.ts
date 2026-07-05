/**
 * Gateway Authentication Middleware
 * Express middleware for tenant validation and registration API key checks
 */

import type { Request, Response, NextFunction } from "express";
import { validateTenant, validateRegistrationApiKey } from "./validation.js";

export interface GatewayRequest extends Request {
  tenantId?: string | undefined;
}

/**
 * Validate X-Tenant-ID and attach tenantId to request
 */
export function gatewayTenantAuth(
  req: GatewayRequest,
  res: Response,
  next: NextFunction
): void {
  const tenantId = req.headers["x-tenant-id"] as string;
  const validation = validateTenant(tenantId);

  if (!validation.isValid) {
    res.status(401).json({ success: false, error: validation.error });
    return;
  }

  req.tenantId = validation.tenantId;
  next();
}

/**
 * Validate registration API key for register/deregister routes.
 * Backends send x-s2s-key header when calling these endpoints.
 */
export function gatewayRegistrationAuth(
  req: GatewayRequest,
  res: Response,
  next: NextFunction
): void {
  const validation = validateRegistrationApiKey(req);

  if (!validation.isValid) {
    res.status(403).json({ success: false, error: validation.error });
    return;
  }

  next();
}
