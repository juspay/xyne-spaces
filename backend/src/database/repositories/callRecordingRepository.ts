import { DatabaseClient } from '../client';
import {
  Prisma,
  RecordingStatus,
  RecordingType,
  type CallRecording,
} from '@prisma/client';

export type { CallRecording };

export interface StartActiveInput {
  callId: string;          // internal calls.id (FK), NOT the externalId
  recordingType: RecordingType;
  startedBy: string;
  name?: string | null;
}

export interface StartActiveResult {
  recording: CallRecording;
  /** false when an ACTIVE recording already existed (single-active lock hit) */
  created: boolean;
}

/**
 * Repository for `call_recordings` — one row per recording session.
 * The single-active lock is the partial unique index
 * `call_recordings_one_active (call_id) WHERE status = 'RECORDING_ACTIVE'`.
 * See docs/call_recording_tech_review.md.
 */
export class CallRecordingRepository {
  private get db() {
    return DatabaseClient.getInstance();
  }

  /**
   * Idempotent start. Inserts a row born ACTIVE — the insert IS the concurrency
   * lock. If another ACTIVE recording already exists for the call, the partial
   * unique index raises P2002; we swallow it and return the existing active row
   * with created=false so the caller does not start a second egress (C3).
   */
  async startActive(input: StartActiveInput): Promise<StartActiveResult> {
    try {
      // startedAt/createdAt have no DB default (team convention) — set them here.
      const now = new Date();
      const call = await this.db.call.findUniqueOrThrow({
        where: { id: input.callId },
        select: { workspaceId: true },
      });
      const recording = await this.db.callRecording.create({
        data: {
          callId: input.callId,
          workspaceId: call.workspaceId,
          recordingType: input.recordingType,
          status: RecordingStatus.RECORDING_ACTIVE,
          startedBy: input.startedBy,
          name: input.name ?? null,
          startedAt: now,
          createdAt: now,
        },
      });
      return { recording, created: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.findActiveByCallId(input.callId);
        if (existing) return { recording: existing, created: false };
      }
      throw err;
    }
  }

  async findById(id: string): Promise<CallRecording | null> {
    return this.db.callRecording.findUnique({ where: { id } });
  }

  /** Webhook correlation key — exactly one row per egress. */
  async findByEgressId(egressId: string): Promise<CallRecording | null> {
    return this.db.callRecording.findUnique({ where: { egressId } });
  }

  /** The single ACTIVE recording for a call, if any (guarded by the partial unique index). */
  async findActiveByCallId(callId: string): Promise<CallRecording | null> {
    return this.db.callRecording.findFirst({
      where: { callId, status: RecordingStatus.RECORDING_ACTIVE },
    });
  }

  /** All non-deleted recordings for a call, newest first. */
  async listByCallId(callId: string): Promise<CallRecording[]> {
    return this.db.callRecording.findMany({
      where: { callId, status: { not: RecordingStatus.RECORDING_DELETED } },
      orderBy: { startedAt: 'desc' },
    });
  }

  /** Most recent UPLOADED recording for a call (used by the legacy single-recording download path). */
  async findLatestUploadedByCallId(callId: string): Promise<CallRecording | null> {
    return this.db.callRecording.findFirst({
      where: { callId, status: RecordingStatus.RECORDING_UPLOADED },
      orderBy: { endedAt: 'desc' },
    });
  }

  /** Of the given calls, which have at least one UPLOADED recording. Bulk hasRecording lookup. */
  async callIdsWithRecording(callIds: string[]): Promise<Set<string>> {
    if (callIds.length === 0) return new Set();
    const rows = await this.db.callRecording.findMany({
      where: { callId: { in: callIds }, status: RecordingStatus.RECORDING_UPLOADED },
      select: { callId: true },
      distinct: ['callId'],
    });
    return new Set(rows.map((r) => r.callId));
  }

  /** Patch the egressId in after startEgress() returns. */
  async setEgressId(id: string, egressId: string): Promise<void> {
    await this.db.callRecording.update({ where: { id }, data: { egressId } });
  }

  /** HLS segment dir, decided at start and read back by the stitch job. */
  async setSegmentPrefix(id: string, segmentPrefix: string): Promise<void> {
    await this.db.callRecording.update({ where: { id }, data: { segmentPrefix } });
  }

  async setMessageId(id: string, messageId: string): Promise<void> {
    await this.db.callRecording.update({ where: { id }, data: { messageId } });
  }

  async rename(id: string, name: string): Promise<CallRecording> {
    return this.db.callRecording.update({ where: { id }, data: { name } });
  }

  /** ACTIVE → STOPPED. Frees the single-active lock immediately. */
  async markStopped(id: string, endedAt: Date = new Date()): Promise<CallRecording> {
    return this.db.callRecording.update({
      where: { id },
      data: { status: RecordingStatus.RECORDING_STOPPED, endedAt },
    });
  }

  /** (STOPPED | ACTIVE) → PROCESSING — segments landed, stitch enqueued. */
  async markProcessing(id: string): Promise<CallRecording> {
    return this.db.callRecording.update({
      where: { id },
      data: { status: RecordingStatus.PROCESSING_RECORDING },
    });
  }

  /** Stitch (ffmpeg) failed though segments exist — retryable. */
  async markProcessingFailed(id: string): Promise<CallRecording> {
    return this.db.callRecording.update({
      where: { id },
      data: { status: RecordingStatus.PROCESSING_FAILED, endedAt: new Date() },
    });
  }

  /** (STOPPED | ACTIVE | PROCESSING) → UPLOADED — terminal success, set after a successful stitch. */
  async markUploaded(id: string, opts: { storagePath?: string; endedAt?: Date } = {}): Promise<CallRecording> {
    return this.db.callRecording.update({
      where: { id },
      data: {
        status: RecordingStatus.RECORDING_UPLOADED,
        ...(opts.storagePath ? { storagePath: opts.storagePath } : {}),
        endedAt: opts.endedAt ?? new Date(),
      },
    });
  }

  /** startEgress threw / egress failed before producing any file. */
  async markRecordingFailed(id: string): Promise<CallRecording> {
    return this.db.callRecording.update({
      where: { id },
      data: { status: RecordingStatus.RECORDING_FAILED, endedAt: new Date() },
    });
  }

  /** egress_ended reported failure / file never landed. */
  async markUploadFailed(id: string): Promise<CallRecording> {
    return this.db.callRecording.update({
      where: { id },
      data: { status: RecordingStatus.RECORDING_UPLOAD_FAILED, endedAt: new Date() },
    });
  }

  /** Retention removed the file. */
  async markExpired(id: string): Promise<CallRecording> {
    return this.db.callRecording.update({
      where: { id },
      data: { status: RecordingStatus.RECORDING_EXPIRED },
    });
  }

  /** Manual user delete (soft delete — row kept for audit). */
  async markDeleted(id: string): Promise<CallRecording> {
    return this.db.callRecording.update({
      where: { id },
      data: { status: RecordingStatus.RECORDING_DELETED },
    });
  }

  /**
   * UPLOADED recordings whose file is past retention. Optional type filter so the
   * cron can apply different retention windows per recording type.
   */
  async findExpiredUploaded(
    cutoff: Date,
    recordingType?: RecordingType,
  ): Promise<CallRecording[]> {
    return this.db.callRecording.findMany({
      where: {
        status: RecordingStatus.RECORDING_UPLOADED,
        endedAt: { lt: cutoff },
        storagePath: { not: null },
        ...(recordingType ? { recordingType } : {}),
      },
    });
  }
}
