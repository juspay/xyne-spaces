import type { FieldFacts } from '@xyne/shared';
import { config } from '@/config/env';
import type {
  ClientEncryptionConfig,
  ComposeInput,
  ComposeItemResult,
  DeriveFactsInput,
  EncryptBatchItem,
  EncryptedFieldConfig,
  EncryptionProvider,
  FileChunksResult,
  GenerateStorageKeyInput,
  OpenFileChunksInput,
  ProvisionEntityInput,
  ProvisionEntityResult,
  SealEventInput,
  SealFileChunksInput,
  StorageObjectKey,
  TransformRequestInput,
  TransformRequestResult,
  TransitCaller,
  TransitEncryptResult,
  TransitServerKeys,
  YSweetSocketKey,
  YSweetDocKey,
  SealYSweetDocKeyInput,
} from './types';

function unsupported(operation: string): never {
  throw new Error(`Encryption provider does not support "${operation}"`);
}

const provider: EncryptionProvider = {
  async getClientConfig(): Promise<ClientEncryptionConfig> {
    if (!config.enc.clientEncryptionEnabled && !config.enc.apiClientEncryptionEnabled) {
      return {
        encryptedFields: {},
        clientEncryptionEnabled: false,
        apiClientEncryptionEnabled: false,
      };
    }
    return unsupported('getClientConfig');
  },

  async getEncryptedFieldsConfig(): Promise<Record<string, EncryptedFieldConfig>> {
    if (!config.enc.enableDbEncryption && !config.enc.enableDbDecryption) return {};
    return unsupported('getEncryptedFieldsConfig');
  },

  async getClientEncryptedMutators(): Promise<string[]> {
    if (!config.enc.apiClientEncryptionEnabled) return [];
    return unsupported('getClientEncryptedMutators');
  },

  async getTransitServerKeys(): Promise<TransitServerKeys> {
    return unsupported('getTransitServerKeys');
  },

  async registerTransitClientKey(_sessionId: string, _clientKey: string): Promise<TransitServerKeys> {
    return unsupported('registerTransitClientKey');
  },

  async transitClientKey(_sessionId: string): Promise<string | undefined> {
    if (!config.enc.clientEncryptionEnabled && !config.enc.apiClientEncryptionEnabled) return undefined;
    return unsupported('transitClientKey');
  },

  async mintYSweetSocketKey(_sessionId: string, _docId: string): Promise<YSweetSocketKey> {
    return unsupported('mintYSweetSocketKey');
  },

  async encryptBatch(items: EncryptBatchItem[]): Promise<string[]> {
    if (!config.enc.enableDbEncryption) return items.map((item) => item.value);
    return unsupported('encryptBatch');
  },

  async decryptBatch(values: string[]): Promise<string[]> {
    if (!config.enc.enableDbEncryption) return values;
    return unsupported('decryptBatch');
  },

  async encryptResponse<T>(body: T, _caller: TransitCaller): Promise<TransitEncryptResult<T>> {
    if (!config.enc.apiClientEncryptionEnabled) return { body };
    return unsupported('encryptResponse');
  },

  async decryptRequest<T>(body: T, _caller: TransitCaller): Promise<T> {
    if (!config.enc.apiClientEncryptionEnabled) return body;
    return unsupported('decryptRequest');
  },

  async transformRequest<T>(input: TransformRequestInput<T>): Promise<TransformRequestResult<T>> {
    if (!config.enc.apiClientEncryptionEnabled) return { body: input.body };
    return unsupported('transformRequest');
  },

  async deriveFacts(_input: DeriveFactsInput): Promise<FieldFacts[]> {
    return unsupported('deriveFacts');
  },

  async compose(_input: ComposeInput): Promise<ComposeItemResult[]> {
    return unsupported('compose');
  },

  async transformResponse<T>(body: T, _caller: TransitCaller): Promise<TransitEncryptResult<T>> {
    if (!config.enc.apiClientEncryptionEnabled) return { body };
    return unsupported('transformResponse');
  },

  async initializeOrg(_orgId: string): Promise<void> {
    if (!config.enc.orgProvisionEnabled) return;
    return unsupported('initializeOrg');
  },

  async provisionEntity(_input: ProvisionEntityInput): Promise<void> {
    if (!config.enc.workspaceProvisionEnabled) return;
    return unsupported('provisionEntity');
  },

  async backfillEntities(_items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]> {
    if (!config.enc.workspaceProvisionEnabled) {
      return _items.map((item) => ({
        entityId: item.entityId,
        entityType: item.entityType,
        ok: false,
        message: 'Workspace encryption is not enabled',
      }));
    }
    return unsupported('backfillEntities');
  },

  async generateStorageKey(_input: GenerateStorageKeyInput): Promise<StorageObjectKey> {
    return unsupported('generateStorageKey');
  },

  async unwrapStorageKeys(wrappedKeys: string[]): Promise<Buffer[]> {
    if (wrappedKeys.length === 0) return [];
    return unsupported('unwrapStorageKeys');
  },

  async sealYSweetDocKey(_input: SealYSweetDocKeyInput): Promise<YSweetDocKey> {
    return unsupported('sealYSweetDocKey');
  },


  async sealEvent(_input: SealEventInput): Promise<{ sealed: string }> {
    return unsupported('sealEvent');
  },
  async sealFileChunks(_input: SealFileChunksInput): Promise<FileChunksResult> {
    return unsupported('sealFileChunks');
  },

  async openFileChunksForTransit(_input: OpenFileChunksInput): Promise<FileChunksResult> {
    return unsupported('openFileChunksForTransit');
  },


  async getTransitClientManifest(
    _params: { tag: string } & TransitCaller,
  ): Promise<{ clientManifest: string } | null> {
    if (!config.enc.apiClientEncryptionEnabled) return null;
    return unsupported('getTransitClientManifest');
  },
};

export function getEncryptionProvider(): EncryptionProvider {
  return provider;
}
