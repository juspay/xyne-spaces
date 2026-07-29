/**
 * Registration Service
 * Business logic for service registration and deregistration
 */

import { prisma } from "../../db.js";
import * as registryDb from "../db/registry.js";
import * as tokenCache from "../cache/token-cache.js";
import { assertSafeOutboundUrl } from "./http-client.js";
import type {
  ServiceRegistration,
  Service,
} from "../types/index.js";

export interface RegistrationResult {
  success: boolean;
  message: string;
}

export interface DeregistrationResult {
  success: boolean;
  message: string;
}

function normalizeAndValidateBackendUrl(rawBackendUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawBackendUrl);
  } catch {
    throw new Error("Invalid backendUrl: must be an absolute URL");
  }

  const isProd = process.env.NODE_ENV === "production";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && !isProd)) {
    throw new Error(isProd
      ? "Invalid backendUrl protocol: only https is allowed in production"
      : "Invalid backendUrl protocol: only http/https are allowed");
  }

  if (!parsed.hostname) {
    throw new Error("Invalid backendUrl: hostname is required");
  }

  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeAndValidateTokenEndpointPath(rawTokenEndpointUrl: string): string {
  const trimmed = rawTokenEndpointUrl.trim();
  if (!trimmed) {
    throw new Error("Invalid tokenEndpointUrl: empty value is not allowed");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error("Invalid tokenEndpointUrl: absolute URLs are not allowed; use a relative path");
  }

  if (!trimmed.startsWith("/")) {
    throw new Error("Invalid tokenEndpointUrl: must start with '/'");
  }

  const endpoint = new URL(trimmed, "https://placeholder.local");
  if (!endpoint.pathname.startsWith("/")) {
    throw new Error("Invalid tokenEndpointUrl path");
  }

  return `${endpoint.pathname}${endpoint.search}`;
}

/**
 * Register a new service with the gateway
 */
export async function registerService(
  tenantUniqueId: string,
  registration: ServiceRegistration
): Promise<RegistrationResult> {
  const {
    serviceName,
    backendId,
    backendUrl,
    tools,
    xAuthHeaderName,
    tokenEndpointUrl,
  } = registration;

  // Validate required fields
  if (!serviceName || !backendId || !backendUrl || !tools || !Array.isArray(tools)) {
    throw new Error("Missing required fields: serviceName, backendId, backendUrl, tools");
  }

  const normalizedBackendUrl = normalizeAndValidateBackendUrl(backendUrl);
  const normalizedTokenEndpointUrl =
    typeof tokenEndpointUrl === "string" && tokenEndpointUrl.trim().length > 0
      ? normalizeAndValidateTokenEndpointPath(tokenEndpointUrl)
      : null;

  // Fail fast at registration time so invalid/unsafe destinations are never persisted.
  await assertSafeOutboundUrl(normalizedBackendUrl);
  if (normalizedTokenEndpointUrl) {
    await assertSafeOutboundUrl(`${normalizedBackendUrl}${normalizedTokenEndpointUrl}`);
  }

  // Use transaction for atomic operations
  await prisma.$transaction(async () => {
    // Upsert service registry
    await registryDb.upsertService(
      tenantUniqueId,
      serviceName,
      backendId,
      normalizedBackendUrl,
      tools,
      xAuthHeaderName || null,
      normalizedTokenEndpointUrl,
      tenantUniqueId
    );
  });

  return {
    success: true,
    message: `Service ${backendId} registered with ${tools.length} tools`,
  };
}

/**
 * Deregister a service from the gateway (removes all backends for the service)
 */
export async function deregisterService(
  tenantUniqueId: string,
  serviceName: string
): Promise<DeregistrationResult> {
  if (!serviceName) {
    throw new Error("Missing serviceName");
  }

  const result = await registryDb.deleteServiceByName(tenantUniqueId, serviceName);

  if (!result || result.deletedCount === 0) {
    throw new Error(`Service not found: ${serviceName}`);
  }

  // Remove cached auth tokens after registry deletion.
  await tokenCache.invalidateServiceTokens(tenantUniqueId, serviceName);

  return {
    success: true,
    message:
      `Service ${serviceName} deregistered (${result.deletedCount} backends removed, ` +
      `auth cache invalidated)`,
  };
}

/**
 * Get service details
 */
export async function getService(
  tenantUniqueId: string,
  serviceName: string,
  backendId?: string
): Promise<Service | null> {
  return registryDb.getService(tenantUniqueId, serviceName, backendId);
}

/**
 * List all services for a tenant
 */
export async function listServices(tenantUniqueId: string): Promise<Service[]> {
  return registryDb.listServices(tenantUniqueId);
}
