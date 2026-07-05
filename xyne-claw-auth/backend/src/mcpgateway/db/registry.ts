/**
 * Registry Database Operations
 * Service registry CRUD operations using Prisma
 */

import { prisma } from "../../db.js";
import type { Service, Tool } from "../types/index.js";

/**
 * Create or update a service registration
 */
export async function upsertService(
  tenantUniqueId: string,
  serviceName: string,
  backendId: string,
  backendUrl: string,
  tools: Tool[],
  xAuthHeaderName: string | null,
  tokenEndpointUrl: string | null,
  tenantId: string = tenantUniqueId
): Promise<void> {
  await prisma.serviceRegistry.upsert({
    where: {
      unique_service_backend_tenant: {
        tenantUniqueId,
        serviceName,
        backendId,
      },
    },
    update: {
      backendUrl,
      tools: tools as unknown as import("@prisma/client").Prisma.JsonArray,
      xAuthHeaderName,
      tokenEndpointUrl,
    },
    create: {
      tenantId,
      tenantUniqueId,
      serviceName,
      backendId,
      backendUrl,
      tools: tools as unknown as import("@prisma/client").Prisma.JsonArray,
      xAuthHeaderName,
      tokenEndpointUrl,
      registeredAt: new Date(),
    },
  });
}

/**
 * Delete a service by backendId
 */
export async function deleteService(
  tenantUniqueId: string,
  backendId: string
): Promise<{ serviceName: string } | null> {
  // Get service name first for return
  const service = await prisma.serviceRegistry.findFirst({
    where: {
      tenantUniqueId,
      backendId,
    },
    select: {
      serviceName: true,
    },
  });

  if (!service) {
    return null;
  }

  await prisma.serviceRegistry.deleteMany({
    where: {
      tenantUniqueId,
      backendId,
    },
  });

  return { serviceName: service.serviceName };
}

/**
 * Delete all backends for a service by serviceName
 */
export async function deleteServiceByName(
  tenantUniqueId: string,
  serviceName: string
): Promise<{ deletedCount: number } | null> {
  // Check if any services exist first
  const count = await prisma.serviceRegistry.count({
    where: {
      tenantUniqueId,
      serviceName,
    },
  });

  if (count === 0) {
    return null;
  }

  await prisma.serviceRegistry.deleteMany({
    where: {
      tenantUniqueId,
      serviceName,
    },
  });

  return { deletedCount: count };
}

/**
 * Get service by tenant, service name, and optional backendId
 */
export async function getService(
  tenantUniqueId: string,
  serviceName: string,
  backendId?: string
): Promise<Service | null> {
  const service = await prisma.serviceRegistry.findFirst({
    where: {
      tenantUniqueId,
      serviceName,
      ...(backendId && { backendId }),
    },
  });

  if (!service) {
    return null;
  }

  return mapToService(service);
}

/**
 * Get all backends for a service
 */
export async function getServiceBackends(
  tenantUniqueId: string,
  serviceName: string
): Promise<Service[]> {
  const services = await prisma.serviceRegistry.findMany({
    where: {
      tenantUniqueId,
      serviceName,
    },
    orderBy: {
      backendId: "asc",
    },
  });

  return services.map(mapToService);
}

/**
 * List all services for a tenant
 */
export async function listServices(tenantUniqueId: string): Promise<Service[]> {
  const services = await prisma.serviceRegistry.findMany({
    where: {
      tenantUniqueId,
    },
    orderBy: [{ serviceName: "asc" }, { backendId: "asc" }],
  });

  return services.map(mapToService);
}

/**
 * Check if tenant has any services
 */
export async function tenantExists(tenantUniqueId: string): Promise<boolean> {
  const count = await prisma.serviceRegistry.count({
    where: {
      tenantUniqueId,
    },
  });

  return count > 0;
}

/**
 * Map database row to Service type
 */
function mapToService(
  row: import("../types/index.js").ServiceRegistryRow
): Service {
  return {
    serviceName: row.serviceName,
    backendId: row.backendId,
    backendUrl: row.backendUrl,
    tools: Array.isArray(row.tools)
      ? (row.tools as Tool[])
      : typeof row.tools === "string"
      ? JSON.parse(row.tools)
      : [],
    tenantId: row.tenantUniqueId,
    serviceRegistryTenantId: row.tenantId,
    ...(row.xAuthHeaderName ? { xAuthHeaderName: row.xAuthHeaderName } : {}),
    ...(row.tokenEndpointUrl ? { tokenEndpointUrl: row.tokenEndpointUrl } : {}),
  };
}
