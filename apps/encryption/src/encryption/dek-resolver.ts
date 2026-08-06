import crypto from 'crypto';
import { Prisma } from '../generated/prisma/index.js';
import { config } from '@/config/env';
import { createKmsProvider, getPlatformWrappingTarget } from './kms';
import { EnvKmsConnector } from './connectors/env-kms-connector';
import { GcpKmsConnector } from './connectors/gcp-kms-connector';
import { getRawPrismaClient } from '@/database/prisma';
import { logger } from '@/utils/logger';

type ActiveKeyRow = {
  dekId: string;
  configId: string;
  orgId: string;
  entityType: string;
  entityId: string;
  wrappedDek: Buffer;
  wrappingProvider: string;
  wrappingKeyRef: string;
  status: string;
  activatedAt: Date;
  createdAt: Date;
  rotatedAt: Date | null;
  deactivatedAt: Date | null;
};

type EncryptionConfigRow = {
  id: string;
  orgId: string;
  provider: string;
  masterKeyRef: string;
  useCustomerManagedKey: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type EffectiveWrappingTarget = {
  configId: string;
  provider: string;
  keyRef: string;
};

export type ResolvedServerKey = {
  keyId: string;
  orgId: string;
  entityType: string;
  entityId: string;
  plaintextKey: Buffer;
};

const ACTIVE_STATUS = 'ACTIVE';
const INACTIVE_STATUS = 'INACTIVE';
const DEK_ID_BYTES = 8;

function entityCacheKey(entityType: string, entityId: string): string {
  return JSON.stringify([entityType, entityId]);
}

class LruMap<TKey, TValue> {
  private readonly store = new Map<TKey, TValue>();

  constructor(
    private readonly maxEntries: number,
  ) {}

  get(key: TKey): TValue | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  set(key: TKey, value: TValue): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, value);
  }
}

function compactDekId(): string {
  return crypto.randomBytes(DEK_ID_BYTES).toString('base64url');
}

function toActiveKeyRow(row: {
  dekId: string;
  configId: string;
  entityType: string;
  entityId: string;
  wrappedDek: Uint8Array;
  status: string;
  activatedAt: Date;
  createdAt: Date;
  rotatedAt: Date | null;
  deactivatedAt: Date | null;
  config: {
    orgId: string;
    provider: string;
    masterKeyRef: string;
  };
}): ActiveKeyRow {
  return {
    dekId: row.dekId,
    configId: row.configId,
    orgId: row.config.orgId,
    entityType: row.entityType,
    entityId: row.entityId,
    wrappedDek: Buffer.from(row.wrappedDek),
    wrappingProvider: row.config.provider,
    wrappingKeyRef: row.config.masterKeyRef,
    status: row.status,
    activatedAt: row.activatedAt,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
    deactivatedAt: row.deactivatedAt,
  };
}

export class EntityServerKeyResolver {
  private readonly prisma = getRawPrismaClient();
  private readonly kms = createKmsProvider();
  private envMigrationKms: EnvKmsConnector | null = null;
  private gcpHistoryKms: GcpKmsConnector | null = null;
  private readonly activeKeyByEntity = new LruMap<string, ActiveKeyRow>(
    config.enc.dekCacheMaxEntries,
  );
  private readonly plaintextKeyById = new LruMap<string, ResolvedServerKey>(
    config.enc.dekCacheMaxEntries,
  );

  private ensureKms() {
    if (!this.kms) {
      throw new Error('KMS provider not available');
    }
    return this.kms;
  }

  private ensureEnvMigrationKms(): EnvKmsConnector {
    if (this.envMigrationKms) {
      return this.envMigrationKms;
    }
    if (!config.enc.envMasterKeyHex) {
      throw new Error('ENC_ENV_MASTER_KEY_HEX is required to migrate env-wrapped DEKs to GCP KMS');
    }

    this.envMigrationKms = new EnvKmsConnector(config.enc.envMasterKeyHex);
    return this.envMigrationKms;
  }

  private keyMatchesBackfillTarget(row: ActiveKeyRow, target: EffectiveWrappingTarget): boolean {
    return row.wrappingProvider === target.provider && row.wrappingKeyRef === target.keyRef;
  }

  private kmsForStoredProvider(provider: string) {
    if (provider === config.enc.kmsProvider) {
      return this.ensureKms();
    }
    if (provider === 'env') {
      return this.ensureEnvMigrationKms();
    }
    if (provider === 'gcp-kms') {
      this.gcpHistoryKms ??= new GcpKmsConnector();
      return this.gcpHistoryKms;
    }
    throw new Error(`Unsupported stored wrapping provider '${provider}'`);
  }

  private assertOrgMatch(row: ActiveKeyRow, orgId: string): void {
    if (row.orgId !== orgId) {
      throw new Error(`Entity ${row.entityType}:${row.entityId} encryption key belongs to a different org`);
    }
  }

  private async rewrapExistingDek(row: ActiveKeyRow, target: EffectiveWrappingTarget): Promise<ActiveKeyRow> {
    const plaintextKey = await this.kmsForStoredProvider(row.wrappingProvider).unwrapKey(
      row.wrappedDek,
      row.wrappingKeyRef,
      {
        keyId: row.dekId,
        orgId: row.orgId,
        entityType: row.entityType,
        entityId: row.entityId,
      },
    );

    const wrappedDek = await this.ensureKms().wrapKey(plaintextKey, target.keyRef, {
      keyId: row.dekId,
      orgId: row.orgId,
      entityType: row.entityType,
      entityId: row.entityId,
    });

    const updated = toActiveKeyRow(await this.prisma.orgDataEncryptionKey.update({
      where: { dekId: row.dekId },
      data: {
        wrappedDek,
        configId: target.configId,
        status: ACTIVE_STATUS,
        rotatedAt: null,
        deactivatedAt: null,
      },
      include: { config: true },
    }));

    this.plaintextKeyById.set(updated.dekId, {
      keyId: updated.dekId,
      orgId: updated.orgId,
      entityType: updated.entityType,
      entityId: updated.entityId,
      plaintextKey,
    });
    this.activeKeyByEntity.set(entityCacheKey(updated.entityType, updated.entityId), updated);
    logger.info('entity encryption backfill rewrote active key successfully', {
      entityId: updated.entityId,
      entityType: updated.entityType,
      orgId: updated.orgId,
      keyId: updated.dekId,
      wrappingProvider: updated.wrappingProvider,
      wrappingKeyRef: updated.wrappingKeyRef,
    });
    return updated;
  }

  async backfillActiveKeyForEntity(entityId: string, orgId: string, entityType: string): Promise<ActiveKeyRow> {
    const existing = await this.fetchActiveKeyRow(entityId, entityType);
    if (!existing) {
      logger.info('entity encryption backfill found no active key; provisioning new key', { entityId, entityType });
      const provisioned = await this.provisionKeyForEntity(entityId, orgId, entityType);
      logger.info('entity encryption backfill provisioned new active key', {
        entityId,
        entityType,
        orgId: provisioned.orgId,
        keyId: provisioned.dekId,
        wrappingProvider: provisioned.wrappingProvider,
        wrappingKeyRef: provisioned.wrappingKeyRef,
      });
      return provisioned;
    }

    this.assertOrgMatch(existing, orgId);
    const wrappingTarget = await this.getEffectiveWrappingTarget(existing.orgId);
    if (this.keyMatchesBackfillTarget(existing, wrappingTarget)) {
      logger.info('entity encryption backfill found active key already on target wrapping key', {
        entityId,
        entityType,
        orgId: existing.orgId,
        keyId: existing.dekId,
        wrappingProvider: existing.wrappingProvider,
        wrappingKeyRef: existing.wrappingKeyRef,
      });
      this.activeKeyByEntity.set(entityCacheKey(entityType, entityId), existing);
      return existing;
    }

    logger.info('entity encryption backfill rewriting active key to target wrapping key', {
      entityId,
      entityType,
      orgId: existing.orgId,
      keyId: existing.dekId,
      currentWrappingProvider: existing.wrappingProvider,
      currentWrappingKeyRef: existing.wrappingKeyRef,
      targetWrappingProvider: config.enc.kmsProvider,
      targetWrappingKeyRef: wrappingTarget.keyRef,
    });
    return await this.rewrapExistingDek(existing, wrappingTarget);
  }

  async getActiveKeyForEntity(entityId: string, entityType: string): Promise<ResolvedServerKey> {
    const cacheKey = entityCacheKey(entityType, entityId);
    const cached = this.activeKeyByEntity.get(cacheKey);
    if (cached) {
      return this.getPlaintextKeyFromRow(cached);
    }
    const row = await this.fetchActiveKeyRow(entityId, entityType);
    if (!row) {
      throw new Error(`No active server key found for entity ${entityType}:${entityId}`);
    }
    this.activeKeyByEntity.set(cacheKey, row);
    return this.getPlaintextKeyFromRow(row);
  }

  async getKeyById(keyId: string): Promise<ResolvedServerKey> {
    const cached = this.plaintextKeyById.get(keyId);
    if (cached) {
      return cached;
    }

    const row = await this.prisma.orgDataEncryptionKey.findUnique({
      where: { dekId: keyId },
      include: { config: true },
    });

    if (!row) {
      throw new Error(`No server key found for keyId=${keyId}`);
    }

    return this.getPlaintextKeyFromRow(toActiveKeyRow(row));
  }

  private async fetchActiveKeyRow(entityId: string, entityType: string): Promise<ActiveKeyRow | null> {
    const row = await this.prisma.orgDataEncryptionKey.findFirst({
      where: {
        entityType,
        entityId,
        status: ACTIVE_STATUS,
      },
      orderBy: {
        activatedAt: 'desc',
      },
      include: { config: true },
    });

    return row ? toActiveKeyRow(row) : null;
  }

  private async fetchEncryptionConfig(orgId: string): Promise<EncryptionConfigRow | null> {
    return this.prisma.orgEncryptionConfig.findFirst({
      where: {
        orgId,
        status: ACTIVE_STATUS,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        orgId: true,
        provider: true,
        masterKeyRef: true,
        useCustomerManagedKey: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getEffectiveWrappingTarget(orgId: string): Promise<EffectiveWrappingTarget> {
    const configRow = await this.fetchEncryptionConfig(orgId);
    if (configRow?.useCustomerManagedKey) {
      throw new Error(`Customer-managed wrapping is not supported for org ${orgId}`);
    }
    const platformTarget = getPlatformWrappingTarget();
    const kms = this.ensureKms();
    let keyRef: string;

    if (platformTarget.provider === 'gcp-kms') {
      if (!kms.getOrCreateOrgKeyRef) {
        throw new Error('GCP KMS provider does not support org key creation');
      }
      keyRef = await kms.getOrCreateOrgKeyRef(orgId, platformTarget.keyRingRef);
    } else {
      keyRef = platformTarget.keyRef;
    }

    let effectiveConfig = configRow;
    if (!effectiveConfig || effectiveConfig.masterKeyRef !== keyRef || effectiveConfig.provider !== platformTarget.provider) {
      effectiveConfig = await this.prisma.$transaction(async (tx) => {
        await tx.orgEncryptionConfig.updateMany({
          where: { orgId, status: ACTIVE_STATUS },
          data: { status: INACTIVE_STATUS },
        });
        return tx.orgEncryptionConfig.create({
          data: {
            orgId,
            provider: platformTarget.provider,
            masterKeyRef: keyRef,
            useCustomerManagedKey: false,
            providerConfig: Prisma.JsonNull,
            status: ACTIVE_STATUS,
          },
          select: {
            id: true,
            orgId: true,
            provider: true,
            masterKeyRef: true,
            useCustomerManagedKey: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      });
    }

    return {
      configId: effectiveConfig.id,
      provider: platformTarget.provider,
      keyRef,
    };
  }

  async initializeOrgEncryption(orgId: string): Promise<EffectiveWrappingTarget> {
    return this.getEffectiveWrappingTarget(orgId);
  }

  async wrapSessionKeyForOrg(
    orgId: string,
    plaintextKey: Buffer,
    sessionId: string,
  ): Promise<{ keyRef: string; wrappedKey: Buffer }> {
    const wrappingTarget = await this.getEffectiveWrappingTarget(orgId);
    const wrappedKey = await this.ensureKms().wrapKey(plaintextKey, wrappingTarget.keyRef, {
      orgId,
      sessionId,
    });

    return {
      keyRef: wrappingTarget.keyRef,
      wrappedKey,
    };
  }

  async unwrapSessionKeyForOrg(
    keyRef: string,
    wrappedKey: Buffer,
    sessionId: string,
    orgId?: string,
  ): Promise<Buffer> {
    return this.ensureKms().unwrapKey(wrappedKey, keyRef, {
      orgId,
      sessionId,
    });
  }

  private async getPlaintextKeyFromRow(row: ActiveKeyRow): Promise<ResolvedServerKey> {
    const cached = this.plaintextKeyById.get(row.dekId);
    if (cached) {
      return cached;
    }

    const plaintextKey = await this.kmsForStoredProvider(row.wrappingProvider).unwrapKey(row.wrappedDek, row.wrappingKeyRef, {
      keyId: row.dekId,
      orgId: row.orgId,
      entityType: row.entityType,
      entityId: row.entityId,
    });

    const resolved = {
      keyId: row.dekId,
      orgId: row.orgId,
      entityType: row.entityType,
      entityId: row.entityId,
      plaintextKey,
    };

    this.plaintextKeyById.set(row.dekId, resolved);
    this.activeKeyByEntity.set(entityCacheKey(row.entityType, row.entityId), row);
    return resolved;
  }

  async provisionKeyForEntity(entityId: string, orgId: string, entityType: string): Promise<ActiveKeyRow> {
    const cacheKey = entityCacheKey(entityType, entityId);
    const existing = await this.fetchActiveKeyRow(entityId, entityType);
    if (existing) {
      this.assertOrgMatch(existing, orgId);
      this.activeKeyByEntity.set(cacheKey, existing);
      return existing;
    }

    const plaintextKey = crypto.randomBytes(32);
    const wrappingTarget = await this.getEffectiveWrappingTarget(orgId);
    const wrappedDek = await this.ensureKms().wrapKey(plaintextKey, wrappingTarget.keyRef, {
      orgId,
      entityType,
      entityId,
    });
    const now = new Date();
    const keyId = compactDekId();

    try {
      const inserted = toActiveKeyRow(await this.prisma.orgDataEncryptionKey.create({
        data: {
          dekId: keyId,
          configId: wrappingTarget.configId,
          entityType,
          entityId,
          wrappedDek,
          status: ACTIVE_STATUS,
          activatedAt: now,
          createdAt: now,
        },
        include: { config: true },
      }));

      this.activeKeyByEntity.set(cacheKey, inserted);
      return inserted;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    const activeAfterRace = await this.fetchActiveKeyRow(entityId, entityType);
    if (!activeAfterRace) {
      throw new Error(`Failed to provision active server key for entity ${entityType}:${entityId}`);
    }

    this.assertOrgMatch(activeAfterRace, orgId);
    this.activeKeyByEntity.set(cacheKey, activeAfterRace);
    return activeAfterRace;
  }
}

export const entityServerKeyResolver = new EntityServerKeyResolver();
