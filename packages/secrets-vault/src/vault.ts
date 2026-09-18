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

function aadFor(secretId: string, version: number): string {
  return `secrets-vault:1:${secretId}:${version}`;
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
   * Returns the decrypted live value for `name`, or null if no SecretDefinition
   * or no live SecretVersion exists. Callers are responsible for falling back to
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

    const liveVersion = await deps.prisma.secretVersion.findFirst({
      where: { secretId: definition.id, status: SecretVersionStatus.LIVE },
    });
    if (!liveVersion) return null;

    const adapter = adapterFor(liveVersion.encryptionImpl as EncryptionImpl);
    const plaintext = await adapter.decrypt(
      liveVersion.value,
      aadFor(definition.id, liveVersion.version),
    );

    if (cacheTtlMs > 0) {
      cache.set(name, { value: plaintext, expiresAt: Date.now() + cacheTtlMs });
    }

    return plaintext;
  }

  /**
   * Creates a new SecretDefinition plus its first SecretVersion, going straight
   * to status "live" (skips verify — this is the same value already running in
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
      data: { name: input.name, createdBy: input.createdBy, rotationState: RotationState.IDLE },
    });

    const impl = activeEncryptionImpl();
    const adapter = adapterFor(impl);
    const version = 1;
    const encrypted = await adapter.encrypt(input.value, aadFor(definition.id, version));

    await deps.prisma.secretVersion.create({
      data: {
        secretId: definition.id,
        version,
        value: encrypted,
        encryptionImpl: impl,
        status: SecretVersionStatus.LIVE,
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
