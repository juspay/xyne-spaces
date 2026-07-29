/**
 * Request Validation Middleware
 * Tenant and registration API key validation
 */

import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { SECURITY, isGatewayEnabled } from "../config/index.js";
import type { ValidationResult } from "../types/index.js";

/**
 * Validate X-Tenant-ID header
 */
export function validateTenant(tenantId: string | undefined): ValidationResult {
  if (!isGatewayEnabled) {
    return { isValid: false, error: "MCP Gateway is not configured" };
  }

  if (!tenantId) {
    return { isValid: false, error: "Missing X-Tenant-ID header" };
  }

  if (!SECURITY.ALLOWED_TENANTS.includes(tenantId)) {
    return { isValid: false, error: "Invalid tenantId" };
  }

  return { isValid: true, tenantId };
}

/**
 * Validate x-s2s-key header for registration routes.
 * Backends send this static API key when registering/deregistering.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateRegistrationApiKey(req: Request): ValidationResult {
  if (!isGatewayEnabled) {
    return { isValid: false, error: "MCP Gateway is not configured" };
  }

  const apiKey = req.headers["x-s2s-key"];
  const key = Array.isArray(apiKey) ? apiKey[0]?.trim() : apiKey?.trim();

  if (!key) {
    return { isValid: false, error: "Missing x-s2s-key header" };
  }

  if (!SECURITY.REGISTRATION_API_KEY) {
    return { isValid: false, error: "MCP Gateway registration is disabled" };
  }

  const serverBuf = Buffer.from(SECURITY.REGISTRATION_API_KEY, "utf8");
  const clientBuf = Buffer.from(key, "utf8");

  if (
    serverBuf.length !== clientBuf.length ||
    !timingSafeEqual(serverBuf, clientBuf)
  ) {
    return { isValid: false, error: "Invalid x-s2s-key" };
  }

  return { isValid: true };
}

/**
 * Extract auth email from request header
 */
export function getAuthEmail(req: Request): string | null {
  const email = req.headers["x-auth-email"] as string;
  return email || null;
}
