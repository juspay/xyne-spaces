import type { Prisma, PrismaClient } from '@prisma/client';
import type { TicketStatusV2 } from '@xyne/shared';
import { rawQuery } from './base';

/**
 * The name of the raw-query method on a Prisma client, so callers can express "this client must
 * be able to run a raw query" in a type WITHOUT spelling the guarded identifier outside this
 * folder. See scripts/validate-no-acl-bypass.sh.
 */
export type RawQueryMethod = '$queryRaw';

/** A client that can take a `FOR UPDATE` row lock: either a transaction client or the root one. */
export type RawCapableClient = Pick<PrismaClient, RawQueryMethod> | Prisma.TransactionClient;

/**
 * Relocated from ticketRepository / ticketController / ticketStageTransitionService, which each
 * inlined the identical `SELECT "metadata", "eta" ... FOR UPDATE`. The row lock is needed because
 * eta is the extend-only baseline and a fingerprint input, so a stale read could decide against —
 * and then overwrite — a due date someone else just moved. SQL unchanged.
 */
export async function lockTicketMetadataAndEta(
  tx: Prisma.TransactionClient,
  ticketId: string,
): Promise<{ metadata: unknown; eta: Date | null } | undefined> {
  const rows = await rawQuery(
    ['Ticket'],
    'ticket eta planning: FOR UPDATE row lock so a concurrent write cannot be overwritten with a stale eta',
    () => tx.$queryRaw<{ metadata: unknown; eta: Date | null }[]>`
        SELECT "metadata", "eta"
        FROM "tickets"
        WHERE "id" = ${ticketId}
        FOR UPDATE
      `,
  );
  return rows[0];
}

/**
 * Relocated from stageEtaDeadlineWorker: same row lock, metadata only — the worker re-reads the
 * planning-risk fingerprint under the lock before acting on it. SQL unchanged.
 */
export async function lockTicketMetadata(
  tx: Prisma.TransactionClient,
  ticketId: string,
): Promise<{ metadata: unknown } | undefined> {
  const rows = await rawQuery(
    ['Ticket'],
    'stage eta deadline worker: FOR UPDATE row lock to re-read the planning-risk fingerprint',
    () => tx.$queryRaw<{ metadata: unknown }[]>`
        SELECT "metadata"
        FROM "tickets"
        WHERE "id" = ${ticketId}
        FOR UPDATE
      `,
  );
  return rows[0];
}

/**
 * Relocated from ticketRepository and flowCascadeService, which both inlined the identical
 * `SELECT "statusV2" ... FOR UPDATE` on a flow root ticket to confirm the run is still active
 * before cascading. SQL unchanged.
 */
export async function lockTicketStatusV2(
  tx: Prisma.TransactionClient,
  ticketId: string,
): Promise<{ statusV2: TicketStatusV2 } | undefined> {
  const rows = await rawQuery(
    ['Ticket'],
    'flow cascade: FOR UPDATE row lock on the flow root so its status cannot change mid-cascade',
    () => tx.$queryRaw<{ statusV2: TicketStatusV2 }[]>`
        SELECT "statusV2"
        FROM "tickets"
        WHERE "id" = ${ticketId}
        FOR UPDATE
      `,
  );
  return rows[0];
}

/**
 * Relocated from sdlc/vcs/SdlcVcsCredentialStore's `lock`: takes a `FOR UPDATE` lock on one
 * external_sources row so concurrent credential saves serialize. SQL unchanged.
 */
export async function lockExternalSourceRow(
  client: RawCapableClient,
  credentialId: string,
): Promise<void> {
  await rawQuery(
    ['ExternalSource'],
    'sdlc vcs credentials: FOR UPDATE row lock so concurrent credential saves serialize',
    () => client.$queryRaw`SELECT "id" FROM "workflow"."external_sources" WHERE "id" = ${credentialId} FOR UPDATE`,
  );
}

/**
 * Relocated from stageTransition/stageEntryApproval: locks the ticket row and re-reads the stage
 * it is actually on, so two concurrent stage-entry approvals cannot both believe they won.
 * SQL unchanged.
 */
export async function lockTicketStageName(
  tx: Prisma.TransactionClient,
  ticketId: string,
): Promise<{ stageName: string } | undefined> {
  const rows = await rawQuery(
    ['Ticket'],
    'stage entry approval: FOR UPDATE row lock so only one concurrent approval can win the stage',
    () => tx.$queryRaw<{ stageName: string }[]>`
    SELECT "stageName" FROM "tickets" WHERE "id" = ${ticketId} FOR UPDATE
  `,
  );
  return rows[0];
}

/**
 * Relocated from transcriptService: locks the call message row and reads content+metadata, so the
 * title update and the first-chunk Canvas attachment (which both merge into the same metadata
 * object) cannot discard each other's fields. SQL unchanged.
 */
export async function lockMessageContentAndMetadata(
  tx: Prisma.TransactionClient,
  messageId: string,
): Promise<{ content: string; metadata: unknown } | undefined> {
  const rows = await rawQuery(
    ['Message'],
    'call title update: FOR UPDATE row lock so concurrent metadata merges do not drop each other\'s keys',
    () => tx.$queryRaw<Array<{ content: string; metadata: unknown }>>`
      SELECT "content", "metadata" FROM "messages" WHERE "messageId" = ${messageId} FOR UPDATE
    `,
  );
  return rows[0];
}

/**
 * Relocated from callDocumentService: same row lock, metadata only — the Canvas URL write merges
 * from the latest metadata so it cannot erase a concurrent title update. SQL unchanged.
 */
export async function lockMessageMetadata(
  tx: Prisma.TransactionClient,
  messageId: string,
): Promise<{ metadata: unknown } | undefined> {
  const rows = await rawQuery(
    ['Message'],
    'call canvas url write: FOR UPDATE row lock so concurrent metadata merges do not drop each other\'s keys',
    () => tx.$queryRaw<Array<{ metadata: unknown }>>`
            SELECT "metadata"
            FROM "messages"
            WHERE "messageId" = ${messageId}
            FOR UPDATE
          `,
  );
  return rows[0];
}
