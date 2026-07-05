export const GATEWAY_KEY_PREFIX = "gateway:";

export type GatewaySourceKey = {
  serviceName: string;
  backendId: string;
  source: string;
};

export type GatewayToolSelectionKey = GatewaySourceKey & {
  toolName: string;
};

export function encodeGatewayPart(value: string): string {
  return encodeURIComponent(value);
}

function decodeGatewayPart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function gatewayCatalogSource(serviceName: string, backendId: string): string {
  return `${GATEWAY_KEY_PREFIX}${encodeGatewayPart(serviceName)}:${encodeGatewayPart(backendId)}`;
}

export function gatewayToolSelectionKey(serviceName: string, backendId: string, toolName: string): string {
  return `${gatewayCatalogSource(serviceName, backendId)}:${encodeGatewayPart(toolName)}`;
}

export function parseGatewayCatalogSource(source: string): GatewaySourceKey | null {
  if (!source.startsWith(GATEWAY_KEY_PREFIX)) return null;
  const parts = source.slice(GATEWAY_KEY_PREFIX.length).split(":");
  if (parts.length !== 2) return null;

  const [encodedServiceName, encodedBackendId] = parts;
  if (!encodedServiceName || !encodedBackendId) return null;

  const serviceName = decodeGatewayPart(encodedServiceName);
  const backendId = decodeGatewayPart(encodedBackendId);
  if (!serviceName || !backendId) return null;

  return {
    serviceName,
    backendId,
    source: `${GATEWAY_KEY_PREFIX}${encodedServiceName}:${encodedBackendId}`,
  };
}

export function parseGatewayToolSelectionKey(key: string): GatewayToolSelectionKey | null {
  if (!key.startsWith(GATEWAY_KEY_PREFIX)) return null;
  const parts = key.slice(GATEWAY_KEY_PREFIX.length).split(":");
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
    source: `${GATEWAY_KEY_PREFIX}${encodedServiceName}:${encodedBackendId}`,
  };
}
