import { Prisma } from '@prisma/client';
import { DatabaseClient } from '@/database/client';

export type RecordingRepairStatus = 'FINALIZED' | 'PROCESSING' | 'MERGED' | 'FAILED';
export type RecordingRepairReason = 'browser_offline' | 'livekit_disconnected' | 'reconnect_timeout' | 'agent_left' | 'stt_failed';

export interface RecordingRepairOutage {
  startedAt: number;
  endedAt: number;
  reasons: RecordingRepairReason[];
}

export interface RecordingRepairCaptureState {
  status: RecordingRepairStatus;
  outages: RecordingRepairOutage[];
  finalizedAt: number;
  processingError: string | null;
  mergedAt: number | null;
  retryable: boolean;
}

interface CaptureRow {
  status: RecordingRepairStatus;
  outages: unknown;
  finalizedAt: Date;
  processingError: string | null;
  mergedAt: Date | null;
  retryable: boolean;
}

function stateFromRow(row: CaptureRow): RecordingRepairCaptureState {
  return {
    status: row.status,
    outages: row.outages as RecordingRepairOutage[],
    finalizedAt: row.finalizedAt.getTime(),
    processingError: row.processingError,
    mergedAt: row.mergedAt?.getTime() ?? null,
    retryable: row.retryable,
  };
}

class RecordingRepairStateService {
  async get(callId: string, captureId: string): Promise<RecordingRepairCaptureState | null> {
    const rows = await DatabaseClient.getInstance().$queryRaw<CaptureRow[]>(Prisma.sql`
      SELECT "status", "outages", "finalizedAt", "processingError", "mergedAt", "retryable"
      FROM "public"."recording_repair_captures"
      WHERE "captureId" = ${captureId} AND "callExternalId" = ${callId}
      LIMIT 1
    `);
    return rows[0] ? stateFromRow(rows[0]) : null;
  }

  async finalize(
    callId: string,
    captureId: string,
    outages: RecordingRepairOutage[],
  ): Promise<RecordingRepairCaptureState> {
    await DatabaseClient.getInstance().$executeRaw(Prisma.sql`
      INSERT INTO "public"."recording_repair_captures"
        ("captureId", "callExternalId", "status", "outages", "finalizedAt", "updatedAt")
      VALUES
        (${captureId}, ${callId}, 'FINALIZED', ${JSON.stringify(outages)}::jsonb, NOW(), NOW())
      ON CONFLICT ("captureId") DO NOTHING
    `);
    const state = await this.get(callId, captureId);
    if (!state) throw new Error('Recording repair capture id belongs to another recording');
    return state;
  }

  async claim(callId: string, captureId: string): Promise<RecordingRepairCaptureState | null> {
    const rows = await DatabaseClient.getInstance().$queryRaw<CaptureRow[]>(Prisma.sql`
      UPDATE "public"."recording_repair_captures"
      SET "status" = 'PROCESSING', "processingError" = NULL, "updatedAt" = NOW()
      WHERE "captureId" = ${captureId}
        AND "callExternalId" = ${callId}
        AND (
          "status" = 'FINALIZED'
          OR ("status" = 'FAILED' AND "retryable" = true)
          OR ("status" = 'PROCESSING' AND "updatedAt" < NOW() - INTERVAL '5 minutes')
        )
      RETURNING "status", "outages", "finalizedAt", "processingError", "mergedAt", "retryable"
    `);
    return rows[0] ? stateFromRow(rows[0]) : null;
  }

  async markMerged(callId: string, captureId: string): Promise<void> {
    await DatabaseClient.getInstance().$executeRaw(Prisma.sql`
      UPDATE "public"."recording_repair_captures"
      SET "status" = 'MERGED', "processingError" = NULL, "mergedAt" = NOW(), "updatedAt" = NOW()
      WHERE "captureId" = ${captureId} AND "callExternalId" = ${callId}
    `);
  }

  async markFailed(
    callId: string,
    captureId: string,
    error: string,
    retryable = true,
  ): Promise<void> {
    await DatabaseClient.getInstance().$executeRaw(Prisma.sql`
      UPDATE "public"."recording_repair_captures"
      SET "status" = 'FAILED', "processingError" = ${error.slice(0, 1000)},
          "retryable" = ${retryable}, "updatedAt" = NOW()
      WHERE "captureId" = ${captureId} AND "callExternalId" = ${callId}
    `);
  }

  async findPending(): Promise<Array<{ callId: string; captureId: string }>> {
    return DatabaseClient.getInstance().$queryRaw<Array<{ callId: string; captureId: string }>>(Prisma.sql`
      SELECT "callExternalId" AS "callId", "captureId"
      FROM "public"."recording_repair_captures"
      WHERE "status" = 'FINALIZED'
         OR ("status" = 'FAILED' AND "retryable" = true)
         OR ("status" = 'PROCESSING' AND "updatedAt" < NOW() - INTERVAL '5 minutes')
      ORDER BY "finalizedAt" ASC
      LIMIT 1000
    `);
  }

  async markLiveTranscriptFinalized(callId: string): Promise<void> {
    await DatabaseClient.getInstance().$executeRaw(Prisma.sql`
      INSERT INTO "public"."recording_repair_call_states"
        ("callExternalId", "transcriptFinalizedAt", "updatedAt")
      VALUES (${callId}, NOW(), NOW())
      ON CONFLICT ("callExternalId") DO UPDATE
      SET "transcriptFinalizedAt" = EXCLUDED."transcriptFinalizedAt", "updatedAt" = NOW()
    `);
  }

  async isLiveTranscriptFinalized(callId: string): Promise<boolean> {
    const rows = await DatabaseClient.getInstance().$queryRaw<Array<{ finalized: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM "public"."recording_repair_call_states"
        WHERE "callExternalId" = ${callId}
      ) AS "finalized"
    `);
    return rows[0]?.finalized === true;
  }
}

export const recordingRepairStateService = new RecordingRepairStateService();
