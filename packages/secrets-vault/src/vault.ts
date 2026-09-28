import { EncryptionImpl, SecretVersionStatus, RotationState } from './types.js';
import type { EncryptionAdapter, VaultPrismaClient } from './types.js';

export interface SecretsVaultDeps {
  prisma: VaultPrismaClient;
  encryptionAdapters: Record<EncryptionImpl, EncryptionAdapter>;
  isGenericEncryptionEnabled: () => boolean;
  cacheTtlMs?: number;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

function aadFor(secretDefinitionId: string, version: number): string {
  return `secrets-vault:1:${secretDefinitionId}:${version}`;
}

export function createSecretsVault(deps: SecretsVaultDeps) {
  const cacheTtlMs = deps.cacheTtlMs ?? 0;
  const cache = new Map<string, CacheEntry>();

  function activeEncryptionImpl(): EncryptionImpl {
    return deps.isGenericEncryptionEnabled() ? EncryptionImpl.GENERIC : EncryptionImpl.CUSTOM;
  }

  function adapterFor(impl: EncryptionImpl): EncryptionAdapter {
    const adapter = deps.encryptionAdapters[impl];
    if (!adapter) {
      throw new Error(`No encryption adapter registered for impl "${impl}"`);
    }
    return adapter;
  }

  /**
   * Returns the decrypted active value for `name`, or null if no SecretDefinition
   * or no active SecretVersion exists. Callers are responsible for falling back to
   * their own hardcoded env var on null/throw (see DESIGN.md Fallback chain) —
   * this function does not know about env vars.
   */
  async function getSecret(name: string): Promise<string | null> {
    if (cacheTtlMs > 0) {
      const cached = cache.get(name);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }

    const definition = await deps.prisma.secretDefinition.findUnique({ where: { name } });
    if (!definition) return null;

    const activeVersion = await deps.prisma.secretVersion.findFirst({
      where: { secretDefinitionId: definition.id, status: SecretVersionStatus.ACTIVE },
    });
    if (!activeVersion) return null;

    const adapter = adapterFor(activeVersion.encryptionImpl as EncryptionImpl);
    const plaintext = await adapter.decrypt(
      activeVersion.value,
      aadFor(definition.id, activeVersion.version),
    );

    if (cacheTtlMs > 0) {
      cache.set(name, { value: plaintext, expiresAt: Date.now() + cacheTtlMs });
    }

    return plaintext;
  }

  /**
   * Creates a new SecretDefinition plus its first SecretVersion, going straight
   * to status "active" (skips verify — this is the same value already running in
   * prod via env var, per DESIGN.md). `name` must already be registered in the
   * caller's secretConfig registry; that check is the caller's responsibility,
   * not this package's — this function only touches the DB.
   */
  async function createSecret(input: {
    name: string;
    value: string;
    createdBy: string;
  }): Promise<void> {
    const definition = await deps.prisma.secretDefinition.create({
      data: {
        name: input.name,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        rotationState: RotationState.IDLE,
      },
    });

    const impl = activeEncryptionImpl();
    const adapter = adapterFor(impl);
    const version = 1;
    const encrypted = await adapter.encrypt(input.value, aadFor(definition.id, version));

    await deps.prisma.secretVersion.create({
      data: {
        secretDefinitionId: definition.id,
        version,
        value: encrypted,
        encryptionImpl: impl,
        status: SecretVersionStatus.ACTIVE,
      },
    });

    cache.delete(input.name);
  }

  function invalidateCache(name: string): void {
    cache.delete(name);
  }

  return { getSecret, createSecret, invalidateCache };
}

export type SecretsVault = ReturnType<typeof createSecretsVault>;
