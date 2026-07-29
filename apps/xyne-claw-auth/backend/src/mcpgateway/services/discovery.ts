/**
 * Discovery Service
 * Service and tool discovery for agents
 */

import * as registryDb from "../db/registry.js";
import type { Service, Tool, BackendInfo } from "../types/index.js";

export interface ServiceListResult {
  services: Array<Service & { tools: Tool[] }>;
  count: number;
}

export interface BackendListResult {
  backends: Record<string, BackendInfo>;
  count: number;
}

/**
 * List all services and their tools for a tenant
 */
export async function listServicesForTenant(
  tenantUniqueId: string
): Promise<ServiceListResult> {
  const services = await registryDb.listServices(tenantUniqueId);

  const mappedServices = services.map((s) => ({
    ...s,
    tools: s.tools || [],
  }));

  return {
    services: mappedServices,
    count: mappedServices.length,
  };
}

/**
 * Get all backends for a specific service
 */
export async function getServiceBackends(
  tenantUniqueId: string,
  serviceName: string
): Promise<BackendListResult> {
  const services = await registryDb.getServiceBackends(tenantUniqueId, serviceName);

  const backendMap: Record<string, BackendInfo> = {};

  for (const service of services) {
    backendMap[service.backendId] = {
      backendId: service.backendId,
      backendUrl: service.backendUrl,
      tools: service.tools || [],
      tenantId: service.tenantId,
    };
  }

  return {
    backends: backendMap,
    count: Object.keys(backendMap).length,
  };
}

/**
 * Check if tenant exists
 */
export async function tenantExists(tenantUniqueId: string): Promise<boolean> {
  return registryDb.tenantExists(tenantUniqueId);
}

/**
 * Get all tools for a tenant as flat list
 */
export async function getAllToolsForTenant(
  tenantUniqueId: string
): Promise<
  Array<
    Tool & {
      serviceName: string;
      backendId: string;
    }
  >
> {
  const { services } = await listServicesForTenant(tenantUniqueId);

  const allTools: Array<
    Tool & {
      serviceName: string;
      backendId: string;
    }
  > = [];

  for (const service of services) {
    for (const tool of service.tools) {
      allTools.push({
        ...tool,
        serviceName: service.serviceName,
        backendId: service.backendId,
      });
    }
  }

  return allTools;
}
