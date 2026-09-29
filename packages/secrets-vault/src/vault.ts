import { EncryptionImpl, SecretVersionStatus, RotationState } from './types.js';
import type { EncryptionAdapter, VaultPrismaClient } from './types.js';

export interface SecretsVaultDeps {
  prisma: VaultPrismaClient;
  encryptionAdapters: Record<EncryptionImpl, EncryptionAdapter>;
  isGenericEncryptionEnabled: () => boolean;
  cacheTtlMs?: number;
  allocateVersion: (secretDefinitionId: string) => Promise<number>;
}

export type AddVersionResult =
  | { status: SecretVersionStatus.ACTIVE; version: number }
  | { status: SecretVersionStatus.FAILED; version: number };

/** Thrown when a claim on SecretDefinition.rotationState loses the race — someone else is already rotating this secret. */
export class RotationInProgressError extends Error {
  constructor(name: string) {
    super(`Secret "${name}" is already being rotated by another request`);
    this.name = 'RotationInProgressError';
  }
}

/** Thrown when revokeActiveVersion's expectedVersion doesn't match what's actually active — someone else changed it first. */
export class ActiveVersionMismatchError extends Error {
  constructor(name: string, expectedVersion: number, actualVersion: number) {
    super(
      `Secret "${name}": expected version ${expectedVersion} to be active, but version ${actualVersion} is — refusing to revoke`,
    );
    this.name = 'ActiveVersionMismatchError';
  }
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
    const version = await deps.allocateVersion(definition.id);
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

  /**
   * Cutover primitive: retires whatever is currently active for this secret
   * and activates `version` instead. Used both by addVersion's forward
   * cutover and (in the future) by an explicit rollback to an older version —
   * same mechanism, either direction.
   */
  async function setActiveVersion(secretDefinitionId: string, version: number): Promise<void> {
    await deps.prisma.secretVersion.updateMany({
      where: { secretDefinitionId, status: SecretVersionStatus.ACTIVE },
      data: { status: SecretVersionStatus.RETIRED, retiredAt: new Date() },
    });
    await deps.prisma.secretVersion.updateMany({
      where: { secretDefinitionId, version },
      data: { status: SecretVersionStatus.ACTIVE, verifiedAt: new Date() },
    });
  }

  /**
   * Adds a new candidate version to an existing secret, verifies it, and
   * cuts over on success. On failure the new version is marked "failed" and
   * the currently-active version is left untouched — nothing to roll back
   * because nothing changed. `verify` is supplied by the caller (looked up
   * from their own secretConfig registry) — this package has no opinion on
   * which secret maps to which check.
   */
  async function addVersion(input: {
    name: string;
    value: string;
    updatedBy: string;
    verify: (value: string) => Promise<boolean>;
  }): Promise<AddVersionResult> {
    const definition = await deps.prisma.secretDefinition.findUnique({
      where: { name: input.name },
    });
    if (!definition) {
      throw new Error(`Secret "${input.name}" does not exist`);
    }

    // CAS claim: only one caller can hold this secret's rotation lock at a
    // time. The WHERE clause (not a prior read) is what Postgres evaluates
    // atomically — see DESIGN.md for the full B1/B2 walkthrough.
    const claimed = await deps.prisma.secretDefinition.updateMany({
      where: { id: definition.id, rotationState: RotationState.IDLE },
      data: { rotationState: RotationState.CLAIMED },
    });
    if (claimed.count !== 1) {
      throw new RotationInProgressError(input.name);
    }

    try {
      const impl = activeEncryptionImpl();
      const adapter = adapterFor(impl);
      const version = await deps.allocateVersion(definition.id);
      const encrypted = await adapter.encrypt(input.value, aadFor(definition.id, version));

      await deps.prisma.secretVersion.create({
        data: {
          secretDefinitionId: definition.id,
          version,
          value: encrypted,
          encryptionImpl: impl,
          status: SecretVersionStatus.PENDING,
        },
      });

      const passed = await input.verify(input.value);

      if (!passed) {
        await deps.prisma.secretVersion.updateMany({
          where: { secretDefinitionId: definition.id, version },
          data: { status: SecretVersionStatus.FAILED },
        });
        return { status: SecretVersionStatus.FAILED, version };
      }

      await setActiveVersion(definition.id, version);
      await deps.prisma.secretDefinition.update({
        where: { id: definition.id },
        data: { updatedBy: input.updatedBy },
      });
      cache.delete(input.name);

      return { status: SecretVersionStatus.ACTIVE, version };
    } finally {
      // Release unconditionally — whether the attempt succeeded, failed
      // verification, or threw, the lock must not stay claimed forever.
      await deps.prisma.secretDefinition.updateMany({
        where: { id: definition.id },
        data: { rotationState: RotationState.IDLE },
      });
    }
  }

  /**
   * Rolls back to an older version's value. Matches how HashiCorp Vault's
   * `kv rollback` works: never reactivates the old row in place — instead
   * decrypts its value and runs it through `addVersion` as a brand-new
   * candidate, so it gets a fresh version number, goes through `verify()`
   * again (the restored credential might have been revoked at the external
   * service since it was retired), and the full history (old row included)
   * stays untouched either way. Monotonic version numbers, full audit trail.
   */
  async function rollbackToVersion(input: {
    name: string;
    version: number;
    updatedBy: string;
    verify: (value: string) => Promise<boolean>;
  }): Promise<AddVersionResult> {
    const definition = await deps.prisma.secretDefinition.findUnique({
      where: { name: input.name },
    });
    if (!definition) {
      throw new Error(`Secret "${input.name}" does not exist`);
    }

    const targetVersion = await deps.prisma.secretVersion.findUnique({
      where: {
        secretDefinitionId_version: { secretDefinitionId: definition.id, version: input.version },
      },
    });
    if (!targetVersion) {
      throw new Error(`Secret "${input.name}" has no version ${input.version}`);
    }

    const adapter = adapterFor(targetVersion.encryptionImpl as EncryptionImpl);
    const plaintext = await adapter.decrypt(
      targetVersion.value,
      aadFor(definition.id, targetVersion.version),
    );

    return addVersion({
      name: input.name,
      value: plaintext,
      updatedBy: input.updatedBy,
      verify: input.verify,
    });
  }

  /**
   * Kill-switch: flips whatever is currently active straight to "revoked,"
   * independent of any rotation attempt and without requiring a replacement
   * to be ready. Deliberately bypasses the rotationState lock — an "this
   * leaked, kill it now" action shouldn't have to wait behind an in-progress
   * rotation; the next getSecret() call simply finds no active version and
   * returns null, so callers fall back to their own env var (see DESIGN.md
   * Fallback chain) — revoking is safe by construction. Returns null if
   * there was nothing active to revoke.
   *
   * `expectedVersion` is required: the caller must confirm which version they
   * believe is active before an irreversible-ish action like this proceeds.
   * If the currently-active version has moved on since the caller last
   * checked (e.g. a rotate landed in between), this throws
   * ActiveVersionMismatchError instead of silently revoking the wrong one.
   */
  async function revokeActiveVersion(input: {
    name: string;
    expectedVersion: number;
    updatedBy: string;
  }): Promise<{ status: SecretVersionStatus.REVOKED; version: number } | null> {
    const definition = await deps.prisma.secretDefinition.findUnique({
      where: { name: input.name },
    });
    if (!definition) {
      throw new Error(`Secret "${input.name}" does not exist`);
    }

    const active = await deps.prisma.secretVersion.findFirst({
      where: { secretDefinitionId: definition.id, status: SecretVersionStatus.ACTIVE },
    });
    if (!active) return null;

    if (active.version !== input.expectedVersion) {
      throw new ActiveVersionMismatchError(input.name, input.expectedVersion, active.version);
    }

    await deps.prisma.secretVersion.updateMany({
      where: { secretDefinitionId: definition.id, version: active.version },
      data: { status: SecretVersionStatus.REVOKED, retiredAt: new Date() },
    });
    await deps.prisma.secretDefinition.update({
      where: { id: definition.id },
      data: { updatedBy: input.updatedBy },
    });
    cache.delete(input.name);

    return { status: SecretVersionStatus.REVOKED, version: active.version };
  }

  function invalidateCache(name: string): void {
    cache.delete(name);
  }

  return {
    getSecret,
    createSecret,
    addVersion,
    rollbackToVersion,
    revokeActiveVersion,
    invalidateCache,
  };
}

export type SecretsVault = ReturnType<typeof createSecretsVault>;
