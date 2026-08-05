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
  orgId: string;
  workspaceId: string;
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
  orgId: string;
  provider: string;
  kmsKeyRef: string;
  useCustomerManagedKey: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type EffectiveWrappingTarget = {
  provider: string;
  keyRef: string;
};

export type ResolvedServerKey = {
  keyId: string;
  orgId: string;
  workspaceId: string;
  plaintextKey: Buffer;
};

const ACTIVE_STATUS = 'ACTIVE';
const DEK_ID_BYTES = 8;

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
  orgId: string;
  workspaceId: string;
  wrappedDek: Uint8Array;
  wrappingProvider: string;
  wrappingKeyRef: string;
  status: string;
  activatedAt: Date;
  createdAt: Date;
  rotatedAt: Date | null;
  deactivatedAt: Date | null;
}): ActiveKeyRow {
  return {
    ...row,
    wrappedDek: Buffer.from(row.wrappedDek),
  };
}

export class WorkspaceServerKeyResolver {
  private readonly prisma = getRawPrismaClient();
  private readonly kms = createKmsProvider();
  private envMigrationKms: EnvKmsConnector | null = null;
  private gcpHistoryKms: GcpKmsConnector | null = null;
  private readonly activeKeyByWorkspace = new LruMap<string, ActiveKeyRow>(
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
      throw new Error(`Workspace ${row.workspaceId} encryption key belongs to a different org`);
    }
  }

  private async rewriteExistingKey(row: ActiveKeyRow, keyRef: string): Promise<ActiveKeyRow> {
    const plaintextKey = await this.kmsForStoredProvider(row.wrappingProvider).unwrapKey(
      row.wrappedDek,
      row.wrappingKeyRef,
      {
        keyId: row.dekId,
        orgId: row.orgId,
        workspaceId: row.workspaceId,
      },
    );

    const wrappedDek = await this.ensureKms().wrapKey(plaintextKey, keyRef, {
      keyId: row.dekId,
      orgId: row.orgId,
      workspaceId: row.workspaceId,
    });

    const updated = toActiveKeyRow(await this.prisma.orgDataEncryptionKey.update({
      where: { dekId: row.dekId },
      data: {
        wrappedDek,
        wrappingProvider: config.enc.kmsProvider,
        wrappingKeyRef: keyRef,
        status: ACTIVE_STATUS,
        rotatedAt: null,
        deactivatedAt: null,
      },
    }));

    this.plaintextKeyById.set(updated.dekId, {
      keyId: updated.dekId,
      orgId: updated.orgId,
      workspaceId: updated.workspaceId,
      plaintextKey,
    });
    this.activeKeyByWorkspace.set(updated.workspaceId, updated);
    logger.info('workspace encryption backfill rewrote active key successfully', {
      workspaceId: updated.workspaceId,
      orgId: updated.orgId,
      keyId: updated.dekId,
      wrappingProvider: updated.wrappingProvider,
      wrappingKeyRef: updated.wrappingKeyRef,
    });
    return updated;
  }

  async backfillActiveKeyForWorkspace(workspaceId: string, orgId: string): Promise<ActiveKeyRow> {
    const existing = await this.fetchActiveKeyRow(workspaceId);
    if (!existing) {
      logger.info('workspace encryption backfill found no active key; provisioning new key', { workspaceId });
      const provisioned = await this.provisionKeyForWorkspace(workspaceId, orgId);
      logger.info('workspace encryption backfill provisioned new active key', {
        workspaceId,
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
      logger.info('workspace encryption backfill found active key already on target wrapping key', {
        workspaceId,
        orgId: existing.orgId,
        keyId: existing.dekId,
        wrappingProvider: existing.wrappingProvider,
        wrappingKeyRef: existing.wrappingKeyRef,
      });
      this.activeKeyByWorkspace.set(workspaceId, existing);
      return existing;
    }

    logger.info('workspace encryption backfill rewriting active key to target wrapping key', {
      workspaceId,
      orgId: existing.orgId,
      keyId: existing.dekId,
      currentWrappingProvider: existing.wrappingProvider,
      currentWrappingKeyRef: existing.wrappingKeyRef,
      targetWrappingProvider: config.enc.kmsProvider,
      targetWrappingKeyRef: wrappingTarget.keyRef,
    });
    return await this.rewriteExistingKey(existing, wrappingTarget.keyRef);
  }

  async getActiveKeyForWorkspace(workspaceId: string): Promise<ResolvedServerKey> {
    const cached = this.activeKeyByWorkspace.get(workspaceId);
    if (cached) {
      return this.getPlaintextKeyFromRow(cached);
    }
    const row = await this.fetchActiveKeyRow(workspaceId);
    if (!row) {
      throw new Error(`No active server key found for workspace ${workspaceId}`);
    }
    this.activeKeyByWorkspace.set(workspaceId, row);
    return this.getPlaintextKeyFromRow(row);
  }

  async getKeyById(keyId: string): Promise<ResolvedServerKey> {
    const cached = this.plaintextKeyById.get(keyId);
    if (cached) {
      return cached;
    }

    const row = await this.prisma.orgDataEncryptionKey.findUnique({
      where: { dekId: keyId },
    });

    if (!row) {
      throw new Error(`No server key found for keyId=${keyId}`);
    }

    return this.getPlaintextKeyFromRow(toActiveKeyRow(row));
  }

  private async fetchActiveKeyRow(workspaceId: string): Promise<ActiveKeyRow | null> {
    const row = await this.prisma.orgDataEncryptionKey.findFirst({
      where: {
        workspaceId,
        status: ACTIVE_STATUS,
      },
      orderBy: {
        activatedAt: 'desc',
      },
    });

    return row ? toActiveKeyRow(row) : null;
  }

  private async fetchEncryptionConfig(orgId: string): Promise<EncryptionConfigRow | null> {
    return this.prisma.orgEncryptionConfig.findUnique({
      where: { orgId },
      select: {
        orgId: true,
        provider: true,
        kmsKeyRef: true,
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

    if (!configRow || configRow.kmsKeyRef !== keyRef || configRow.provider !== platformTarget.provider) {
      await this.prisma.orgEncryptionConfig.upsert({
        where: { orgId },
        create: {
          orgId,
          provider: platformTarget.provider,
          kmsKeyRef: keyRef,
          useCustomerManagedKey: false,
          providerConfig: Prisma.JsonNull,
          status: ACTIVE_STATUS,
        },
        update: {
          provider: platformTarget.provider,
          kmsKeyRef: keyRef,
          useCustomerManagedKey: false,
          status: ACTIVE_STATUS,
        },
      });
    }

    return {
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
      workspaceId: row.workspaceId,
    });

    const resolved = {
      keyId: row.dekId,
      orgId: row.orgId,
      workspaceId: row.workspaceId,
      plaintextKey,
    };

    this.plaintextKeyById.set(row.dekId, resolved);
    this.activeKeyByWorkspace.set(row.workspaceId, row);
    return resolved;
  }

  async provisionKeyForWorkspace(workspaceId: string, orgId: string): Promise<ActiveKeyRow> {
    const existing = await this.fetchActiveKeyRow(workspaceId);
    if (existing) {
      this.assertOrgMatch(existing, orgId);
      this.activeKeyByWorkspace.set(workspaceId, existing);
      return existing;
    }

    const plaintextKey = crypto.randomBytes(32);
    const wrappingTarget = await this.getEffectiveWrappingTarget(orgId);
    const wrappedDek = await this.ensureKms().wrapKey(plaintextKey, wrappingTarget.keyRef, { orgId, workspaceId });
    const now = new Date();
    const keyId = compactDekId();

    try {
      const inserted = toActiveKeyRow(await this.prisma.orgDataEncryptionKey.create({
        data: {
          dekId: keyId,
          orgId,
          workspaceId,
          wrappedDek,
          wrappingProvider: wrappingTarget.provider,
          wrappingKeyRef: wrappingTarget.keyRef,
          status: ACTIVE_STATUS,
          activatedAt: now,
          createdAt: now,
        },
      }));

      this.activeKeyByWorkspace.set(workspaceId, inserted);
      return inserted;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    const activeAfterRace = await this.fetchActiveKeyRow(workspaceId);
    if (!activeAfterRace) {
      throw new Error(`Failed to provision active server key for workspace ${workspaceId}`);
    }

    this.assertOrgMatch(activeAfterRace, orgId);
    this.activeKeyByWorkspace.set(workspaceId, activeAfterRace);
    return activeAfterRace;
  }
}

export const workspaceServerKeyResolver = new WorkspaceServerKeyResolver();
