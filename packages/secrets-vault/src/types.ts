/**
 * DB column is a plain Prisma `String` (this codebase's convention — see
 * DESIGN.md and e.g. Ticket.statusV2 in schema.prisma — no Prisma `enum`,
 * since enums are hard to evolve across a dual write). The real type lives
 * here in code as an actual TS enum, matching the TicketStatusV2 pattern in
 * packages/shared/src/zero/types.ts: the `data`/`where` shapes below only
 * accept enum members (nobody can construct or query for a row with an
 * arbitrary string), and rows read back out keep `string` at the type level
 * (that's genuinely what PrismaClient returns for a String column) — cast
 * with `as EncryptionImpl`/etc. at the read site when you need to branch on
 * it, same as `currentTicket.statusV2 as TicketStatusV2` in
 * ticketRepository.ts. Add an `Object.values(...).includes(...)` runtime
 * guard wherever a value originates from external/API input rather than
 * from this package's own writes (see ticketController.ts:724) — not
 * needed yet here since nothing external sets these three fields directly.
 */
export enum EncryptionImpl {
  GENERIC = 'generic',
  CUSTOM = 'custom',
}

export enum RotationState {
  IDLE = 'idle',
  CLAIMED = 'claimed',
}

export enum SecretVersionStatus {
  PENDING = 'pending',
  LIVE = 'live',
  RETIRED = 'retired',
  REVOKED = 'revoked',
  FAILED = 'failed',
}

export interface EncryptionAdapter {
  encrypt(plaintext: string, aad: string): Promise<string>;
  decrypt(packed: string, aad: string): Promise<string>;
}

export interface SecretDefinitionRow {
  id: string;
  name: string;
  rotationState: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SecretVersionRow {
  id: string;
  secretId: string;
  version: number;
  value: string;
  encryptionImpl: string;
  status: string;
  createdAt: Date;
  verifiedAt: Date | null;
  retiredAt: Date | null;
}

/**
 * Minimal structural shape of the two Prisma model delegates this package needs.
 * Deliberately not importing `@prisma/client` here — the generated client lives
 * in apps/backend (schema owner); callers pass their own instance, which
 * satisfies this shape structurally.
 */
export interface VaultPrismaClient {
  secretDefinition: {
    findUnique(args: { where: { name: string } }): Promise<SecretDefinitionRow | null>;
    create(args: {
      data: { name: string; createdBy: string; rotationState: RotationState };
    }): Promise<SecretDefinitionRow>;
  };
  secretVersion: {
    findFirst(args: {
      where: { secretId: string; status: SecretVersionStatus };
    }): Promise<SecretVersionRow | null>;
    create(args: {
      data: {
        secretId: string;
        version: number;
        value: string;
        encryptionImpl: EncryptionImpl;
        status: SecretVersionStatus;
      };
    }): Promise<SecretVersionRow>;
  };
}
