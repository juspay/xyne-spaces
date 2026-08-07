import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { DisabledEncryptionProvider, DISABLED_ENCRYPTION_CAPABILITIES } from './disabled-provider';
import { HttpEncryptionProvider } from './http-provider';
import type { EncryptionCapabilities, EncryptionProvider } from './types';

type EncryptionCapability = keyof EncryptionCapabilities;

function requestedCapabilities(): EncryptionCapabilities {
  const dbEncryption = config.enc.enableDbEncryption;
  const clientEncryption = config.enc.clientEncryptionEnabled;
  const apiTransitEncryption = config.enc.apiClientEncryptionEnabled;
  return {
    dbEncryption,
    clientEncryption,
    apiTransitEncryption,
    provisioning: dbEncryption || clientEncryption || apiTransitEncryption,
  };
}

const requested = requestedCapabilities();
const httpRequested = Object.values(requested).some(Boolean);

let provider: EncryptionProvider = httpRequested
  ? new HttpEncryptionProvider({
      baseUrl: config.internal.encryptionServiceUrl,
      s2sKey: config.internal.encryptionS2sKey,
      timeoutMs: config.internal.encryptionRequestTimeoutMs,
      requiredCapabilities: requested,
    })
  : new DisabledEncryptionProvider();

let capabilities: EncryptionCapabilities | null = httpRequested
  ? null
  : DISABLED_ENCRYPTION_CAPABILITIES;

export async function initializeEncryptionProvider(): Promise<EncryptionCapabilities> {
  if (capabilities) return capabilities;
  if (!config.internal.encryptionS2sKey) {
    throw new Error('ENC_S2S_KEY is required when encryption capabilities are enabled');
  }

  const negotiated = await provider.initialize();
  const missing = (Object.keys(requested) as EncryptionCapability[])
    .filter((capability) => requested[capability] && !negotiated[capability]);
  if (missing.length > 0) {
    throw new Error(`Encryption provider is missing requested capabilities: ${missing.join(', ')}`);
  }

  capabilities = negotiated;
  logger.info('Encryption provider initialized', { provider: 'http', capabilities });
  return capabilities;
}

export function getEncryptionProvider(): EncryptionProvider {
  return provider;
}

export function getEncryptionCapabilities(): EncryptionCapabilities {
  if (!capabilities) {
    throw new Error('Encryption provider has not been initialized');
  }
  return capabilities;
}

export function isEncryptionCapabilityEnabled(capability: EncryptionCapability): boolean {
  return getEncryptionCapabilities()[capability];
}

export function setEncryptionProviderForTesting(
  nextProvider: EncryptionProvider,
  nextCapabilities: EncryptionCapabilities | null,
): void {
  provider = nextProvider;
  capabilities = nextCapabilities;
}
