import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { EnvKmsConnector } from './connectors/env-kms-connector';
import { GcpKmsConnector } from './connectors/gcp-kms-connector';

let kmsProviderInstance: KmsProvider | null = null;

export interface KmsContext {
  keyId?: string;
  orgId?: string;
  entityType?: string;
  entityId?: string;
  sessionId?: string;
}

export interface KmsProvider {
  getOrCreateOrgKeyRef?(orgId: string, keyRingRef: string): Promise<string>;
  wrapKey(plaintextKey: Buffer, keyRef: string, context?: KmsContext): Promise<Buffer>;
  unwrapKey(wrappedKey: Buffer, keyRef: string, context?: KmsContext): Promise<Buffer>;
}

export type WrappingTarget =
  | {
    provider: 'env';
    keyRef: string;
  }
  | {
    provider: 'gcp-kms';
    keyRingRef: string;
  };

export function createKmsProvider(): KmsProvider | null {
  if (kmsProviderInstance) {
    return kmsProviderInstance;
  }

  switch (config.enc.kmsProvider) {
    case 'env':
      if (!config.enc.envMasterKeyHex) {
        logger.info('kms: no env master key configured, encryption disabled');
        return null;
      }
      kmsProviderInstance = new EnvKmsConnector(config.enc.envMasterKeyHex);
      return kmsProviderInstance;
    case 'gcp-kms':
      kmsProviderInstance = new GcpKmsConnector();
      return kmsProviderInstance;
    default:
      logger.warn(`kms: unknown provider '${config.enc.kmsProvider}'`);
      return null;
  }
}

export function getPlatformWrappingTarget(): WrappingTarget {
  switch (config.enc.kmsProvider) {
    case 'env':
      if (!config.enc.envMasterKeyHex) {
        throw new Error('Env KMS master key is not configured');
      }
      return {
        provider: 'env',
        keyRef: 'env-master-key',
      };
    case 'gcp-kms':
      if (!config.enc.gcpKmsKeyRingRef) {
        throw new Error('GCP KMS key ring ref is not configured');
      }
      return {
        provider: 'gcp-kms',
        keyRingRef: config.enc.gcpKmsKeyRingRef,
      };
    default:
      throw new Error(`Unsupported KMS provider '${config.enc.kmsProvider}'`);
  }
}
