export const GATEWAY_SOURCE_PREFIX = "gateway:";

export type GatewaySourceKey = {
  serviceName: string;
  backendId: string;
  source: string;
};

export type GatewaySelectionKey = GatewaySourceKey & {
  toolName: string;
};

function decodeGatewayPart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseGatewaySource(source: string): GatewaySourceKey | null {
  if (!source.startsWith(GATEWAY_SOURCE_PREFIX)) return null;
  const parts = source.slice(GATEWAY_SOURCE_PREFIX.length).split(":");
  if (parts.length !== 2) return null;

  const [encodedServiceName, encodedBackendId] = parts;
  if (!encodedServiceName || !encodedBackendId) return null;

  const serviceName = decodeGatewayPart(encodedServiceName);
  const backendId = decodeGatewayPart(encodedBackendId);
  if (!serviceName || !backendId) return null;

  return {
    serviceName,
    backendId,
    source: `${GATEWAY_SOURCE_PREFIX}${encodedServiceName}:${encodedBackendId}`,
  };
}

export function parseGatewaySelectionKey(key: string): GatewaySelectionKey | null {
  if (!key.startsWith(GATEWAY_SOURCE_PREFIX)) return null;
  const parts = key.slice(GATEWAY_SOURCE_PREFIX.length).split(":");
  if (parts.length !== 3) return null;

  const [encodedServiceName, encodedBackendId, encodedToolName] = parts;
  if (!encodedServiceName || !encodedBackendId || !encodedToolName) return null;

  const serviceName = decodeGatewayPart(encodedServiceName);
  const backendId = decodeGatewayPart(encodedBackendId);
  const toolName = decodeGatewayPart(encodedToolName);
  if (!serviceName || !backendId || !toolName) return null;

  return {
    serviceName,
    backendId,
    toolName,
    source: `${GATEWAY_SOURCE_PREFIX}${encodedServiceName}:${encodedBackendId}`,
  };
}
