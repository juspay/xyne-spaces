import { EgressClient, EgressStatus, SegmentedFileOutput, SegmentedFileProtocol, GCPUpload, S3Upload, EgressInfo } from 'livekit-server-sdk';
import { type Call, type CallRecording } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { config } from '@/config/env';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';
import { isAgentParticipant, livekitService } from '@/services/liveKitService';
import { mixAgentVideoRecording, mixAudioTracks, stitchHlsToMp4, type AudioTrackInput, type VideoTrackInput } from '@/utils/ffmpeg';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { MessageType, AttachmentEntityType, RecordingStatus, RecordingType } from '@xyne/shared';
import { isRecording } from '@/utils/callTypeUtils';
import { callEncryptionService } from '@/services/callEncryptionService';
import type { CreateMessageAttachmentInput } from '@/database/repositories/messageAttachmentRepository';
import {
  completionProofMessage,
  liveChunkAad,
  liveVideoChunkAad,
  manifestAad,
  recordingEncryptionService,
  XREC_HEADER_LENGTH,
} from '@/services/recordingEncryptionService';

/** HLS segment length. Smaller = more frequent uploads (less data lost on crash). */
const SEGMENT_DURATION_SECONDS = 6;

/**
 * After an agent recording stops, how long the agent has to upload its last chunks and
 * report completion before the stitch runs anyway with whatever landed (agent crashed,
 * or its report was lost). The agent normally reports within seconds.
 */
const AGENT_FINALIZE_GRACE_MS = 3 * 60 * 1000;

/** Hard cap on mixing one agent recording (audio only: a remux-sized job). */
const AGENT_MIX_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Video recordings re-encode every frame: allow the recording's own length on top of
 * the base cap (a veryfast 720p15 encode runs well above real time).
 */
const agentVideoMixTimeoutMs = (durationMs: number): number => AGENT_MIX_TIMEOUT_MS + Math.max(0, durationMs);

/** One agent instance's run on a recording; a redispatched agent resumes under a new session. */
const AGENT_SESSION_PATTERN = /^[a-f0-9]{16}$/;

const manifestTrackSchema = z.object({
  index: z.number().int().min(0).max(999),
  /** Track start on the recording timeline: ms after the recording's startedAt. */
  offsetMs: z.number().finite().min(0),
});

/** What the agent stores, encrypted, per session: where each audio track and video stream starts. */
const agentManifestSchema = z.object({
  v: z.literal(1),
  recordingId: z.string(),
  session: z.string().regex(AGENT_SESSION_PATTERN),
  tracks: z.array(manifestTrackSchema).max(1000),
  /** Composed video streams (video recordings only; normally one per session). */
  video: z.array(manifestTrackSchema).max(100).optional(),
});

/** Why a recording could not be started; the controller maps these to responses. */
export class RecordingStartError extends Error {
  constructor(
    public readonly code: 'RECORDER_NOT_CONFIGURED' | 'RECORDER_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'RecordingStartError';
  }
}

/** The answer to an agent's recording-session request (the controller seals the key). */
export type AgentRecordingSession =
  | { active: false }
  | {
      active: true;
      recordingId: string;
      /** AUDIO_ONLY: audio tracks only. AUDIO_SCREEN / AUDIO_VIDEO: plus a composed video stream. */
      recordingType: RecordingType;
      startedAtMs: number;
      chunkPrefix: string;
      chunkKey: Buffer;
    };

const isAgentRecording = (recording: Pick<CallRecording, 'recorder'>): boolean => recording.recorder === 'AGENT';

const recordingMimetype = (recordingType: string): string =>
  recordingType === RecordingType.AUDIO_ONLY ? 'audio/mp4' : 'video/mp4';

type RecordingAttachmentTarget = Pick<
  CreateMessageAttachmentInput,
  'entityType' | 'entityId' | 'conversationId' | 'channelId' | 'workspaceId' | 'url' | 'size'
>;

export interface StartRecordingResult {
  recording: CallRecording;
  /** true when an ACTIVE recording already existed — no new egress was started (C3). */
  alreadyActive: boolean;
}

/**
 * In-call recording, backed by the `call_recordings` table (1 row per session).
 * The table is the single source of truth — the in-memory map below is only a
 * fast-path cache; egressId is always read back from the row. See
 * docs/call_recording_tech_review.md.
 */
class CallRecordingService {
  private egressClient: EgressClient;
  /** Optional fast-path cache of recordingId → egressId. The row is authoritative. */
  private activeEgress = new Map<string, string>();

  private get storageService() {
    return getStorageService(config.gcs.transcriptionBucketName);
  }

  constructor() {
    this.egressClient = new EgressClient(
      config.livekit.url,
      config.livekit.apiKey,
      config.livekit.apiSecret,
    );
  }

  getRetentionDays(): number {
    return config.callRecording.retentionDays;
  }

  isRecordingEnabled(): boolean {
    return config.callRecording.enabled;
  }

  /**
   * All GCS keys for one recording, keyed on the recording's own id so two
   * recordings in the same call never collide (C1). HLS segments live in a
   * per-recording dir; the stitched MP4 sits beside it at the same path
   * recordings used before, so every consumer that reads `storagePath` is
   * unchanged.
   */
  private buildPaths(callExternalId: string, recordingId: string) {
    const dir = `recordings/${callExternalId}/${recordingId}`;
    return {
      mp4Path: `${dir}.mp4`,
      segmentPrefix: `${dir}/`,
      filenamePrefix: `${dir}/segment`,
      playlistPath: `${dir}/index.m3u8`,
    };
  }

  private buildUploadOutput() {
    return config.fileStorage.provider === 's3'
      ? {
          case: 's3' as const,
          value: new S3Upload({
            bucket: config.gcs.transcriptionBucketName,
            region: config.s3.region,
            accessKey: config.s3.accessKeyId,
            secret: config.s3.secretAccessKey,
            ...((config.s3.endpoint) ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
          }),
        }
      : {
          case: 'gcp' as const,
          value: new GCPUpload({
            bucket: config.gcs.transcriptionBucketName,
          }),
        };
  }

  /**
   * Start a recording for a call. Any participant may call this. The DB partial
   * unique index enforces a single ACTIVE recording per call: the insert IS the
   * lock. Concurrent starts return the existing recording (alreadyActive=true)
   * instead of starting a second egress.
   *
   * Sequence: insert ACTIVE row → set per-recording storagePath → startEgress →
   * patch egressId. If egress fails to start the row is moved to RECORDING_FAILED
   * so the lock is freed immediately.
   */
  async startRecording(params: {
    call: Call;
    recordingType: RecordingType;
    startedBy: string;
    name?: string | null;
  }): Promise<StartRecordingResult | null> {
    const { call, recordingType, startedBy, name } = params;

    // End-to-end encrypted calls: egress can't decrypt, so the transcription agent records.
    if (callEncryptionService.isCallEncrypted(call)) {
      return this.startAgentRecording(params);
    }

    const { recording, created } = await repositories.callRecordings.startActive({
      callId: call.id,
      recordingType,
      startedBy,
      name: name ?? null,
    });

    // Single-active lock already held by another recording — idempotent no-op.
    if (!created) {
      logger.info(`[CallRecording] start ignored — recording ${recording.id} already ACTIVE for call ${call.externalId}`);
      return { recording, alreadyActive: true };
    }

    const paths = this.buildPaths(call.externalId, recording.id);
    await repositories.callRecordings.setSegmentPrefix(recording.id, paths.segmentPrefix);

    try {
      const output = new SegmentedFileOutput({
        protocol: SegmentedFileProtocol.HLS_PROTOCOL,
        filenamePrefix: paths.filenamePrefix,
        playlistName: paths.playlistPath,
        segmentDuration: SEGMENT_DURATION_SECONDS,
        output: this.buildUploadOutput(),
      });

      let info: EgressInfo;
      if (recordingType === RecordingType.AUDIO_ONLY) {
        info = await this.egressClient.startRoomCompositeEgress(call.externalId, output, {
          audioOnly: true,
        });
      } else {
        // AUDIO_SCREEN: speaker-dark keeps the active screen-share large.
        // AUDIO_VIDEO: grid-dark shows all camera tiles equally.
        const layout = recordingType === RecordingType.AUDIO_SCREEN ? 'speaker-dark' : 'grid-dark';
        info = await this.egressClient.startRoomCompositeEgress(call.externalId, output, {
          layout,
          audioOnly: false,
        });
      }

      this.activeEgress.set(recording.id, info.egressId);
      await repositories.callRecordings.setEgressId(recording.id, info.egressId);

      logger.info(`[CallRecording] Started ${recordingType} HLS egress for call ${call.externalId}, recordingId=${recording.id}, egressId=${info.egressId}, segments=${paths.segmentPrefix}`);
      const withEgress = { ...recording, egressId: info.egressId, segmentPrefix: paths.segmentPrefix };

      // Publish active-recording state to room metadata so all clients (incl. late
      // joiners) show the indicator (H4). Non-blocking; the DB row is authoritative.
      const starter = await repositories.users.findById(startedBy).catch(() => null);
      void livekitService.setRecordingState(call.externalId, {
        recordingId: recording.id,
        startedBy,
        startedByName: starter?.name ?? null,
        startedAt: new Date(recording.startedAt).getTime(),
        recordingType: recording.recordingType,
      });

      return { recording: withEgress, alreadyActive: false };
    } catch (error) {
      // Free the single-active lock so the call is immediately recordable again (H1).
      logger.error(`[CallRecording] startEgress failed for call ${call.externalId}, recordingId=${recording.id}:`, error);
      await repositories.callRecordings.markRecordingFailed(recording.id).catch((e) =>
        logger.error(`[CallRecording] failed to mark recording ${recording.id} RECORDING_FAILED:`, e));
      return null;
    }
  }

  /**
   * Stop a specific recording. Moves ACTIVE → STOPPED (freeing the lock) and asks
   * the egress worker to flush + upload; the egress_ended webhook finalises it.
   * Authorization (starter-only) is enforced in the controller.
   */
  async stopRecording(recording: CallRecording, callExternalId: string): Promise<void> {
    await repositories.callRecordings.markStopped(recording.id);
    if (isAgentRecording(recording)) {
      // The agent sees the stop (room metadata + its poll), uploads its last chunks and
      // reports completion, which runs the stitch at once. This job is the fallback.
      const { recordingStitchQueue } = await import('@/queues/recordingStitchQueue');
      await recordingStitchQueue.enqueue(recording.id, { delayMs: AGENT_FINALIZE_GRACE_MS });
    } else {
      await this.stopEgress(recording, callExternalId);
    }

    // Clear the active-recording indicator on every stop path (HTTP stop, call-end).
    // The egress_ended webhook still finalizes the file. Non-blocking; row is authoritative.
    const call = await repositories.calls.findById(recording.callId);
    if (call) void livekitService.setRecordingState(call.externalId, null);
  }

  /**
   * Stop the ACTIVE recording for a call (looked up by externalId / room name).
   * Used when the call ends so egress can flush to storage before the room tears
   * down (LiveKit also auto-ends egress, but this triggers a graceful stop).
   */
  async stopActiveRecordingsForCall(callExternalId: string): Promise<void> {
    const call = await repositories.calls.findByExternalId(callExternalId);
    if (!call) return;
    const active = await repositories.callRecordings.findActiveByCallId(call.id);
    if (!active) return;
    await this.stopRecording(active, call.externalId);
  }

  // ── Agent recordings (end-to-end encrypted calls) ────────────────────────────────
  //
  // Egress can't decrypt an E2EE call, so the transcription agent, which already holds
  // the call key, records the audio it receives. It never stores plaintext: it encrypts
  // per-participant Ogg/Opus chunks with a key derived from this recording's data key,
  // and the stitch worker turns them into one encrypted file. See recordingEncryptionService.
  //
  //   start (API)     row ACTIVE + wrapped data key; room metadata tells the agent
  //   agent           fetches the sealed chunk key, uploads encrypted chunks every few seconds
  //   stop (API)      row STOPPED; delayed fallback stitch queued
  //   agent           uploads its last chunks, reports completion -> stitch runs now
  //   stitch worker   decrypt chunks, mix, encrypt (XREC), upload, delete chunks

  /**
   * Start a recording made by the transcription agent. AUDIO_ONLY records each speaker;
   * AUDIO_SCREEN and AUDIO_VIDEO also record a video stream the agent composes from the
   * participants' screen shares and cameras (the same layouts egress uses).
   */
  private async startAgentRecording(params: {
    call: Call;
    recordingType: RecordingType;
    startedBy: string;
    name?: string | null;
  }): Promise<StartRecordingResult | null> {
    const { call, recordingType, startedBy, name } = params;
    if (!recordingEncryptionService.isConfigured()) {
      throw new RecordingStartError('RECORDER_NOT_CONFIGURED', 'CALL_RECORDING_MASTER_KEY is not configured');
    }
    // The agent is the only recorder that can hear this call. Without it the row would sit
    // ACTIVE recording nothing.
    const participants = await livekitService.listParticipants(call.externalId);
    if (!participants.some(isAgentParticipant)) {
      throw new RecordingStartError('RECORDER_UNAVAILABLE', 'transcription agent is not in the call');
    }

    const { recording, created } = await repositories.callRecordings.startActive({
      callId: call.id,
      recordingType,
      startedBy,
      name: name ?? null,
      recorder: 'AGENT',
    });
    if (!created) {
      logger.info(`[CallRecording] start ignored — recording ${recording.id} already ACTIVE for call ${call.externalId}`);
      return { recording, alreadyActive: true };
    }

    const paths = this.buildPaths(call.externalId, recording.id);
    try {
      const { state } = recordingEncryptionService.createRecordingKey(recording.id);
      await repositories.callRecordings.setEncryption(recording.id, { ...state });
      await repositories.callRecordings.setSegmentPrefix(recording.id, paths.segmentPrefix);
    } catch (error) {
      logger.error(`[CallRecording] agent recording setup failed for call ${call.externalId}, recordingId=${recording.id}:`, error);
      await repositories.callRecordings.markRecordingFailed(recording.id).catch((e) =>
        logger.error(`[CallRecording] failed to mark recording ${recording.id} RECORDING_FAILED:`, e));
      return null;
    }

    // Also the agent's cue to start (it confirms with the backend before recording anything).
    const starter = await repositories.users.findById(startedBy).catch(() => null);
    await livekitService.setRecordingState(call.externalId, {
      recordingId: recording.id,
      startedBy,
      startedByName: starter?.name ?? null,
      startedAt: new Date(recording.startedAt).getTime(),
      recordingType: recording.recordingType,
    });

    logger.info(`[CallRecording] Started agent ${recordingType} recording for call ${call.externalId}, recordingId=${recording.id}`);
    return { recording: { ...recording, segmentPrefix: paths.segmentPrefix }, alreadyActive: false };
  }

  /**
   * What the call's agent should be recording right now. The caller has verified the
   * agent job and must seal `chunkKey` to it; the key must never be sent in clear.
   */
  async getAgentRecordingSession(call: Call): Promise<AgentRecordingSession> {
    const active = await repositories.callRecordings.findActiveByCallId(call.id);
    if (!active || !isAgentRecording(active) || !active.segmentPrefix) return { active: false };
    if (!recordingEncryptionService.isEncryptedRecording(active)) return { active: false };
    const dek = recordingEncryptionService.unwrapRecordingKey(active.id, active.encryption);
    return {
      active: true,
      recordingId: active.id,
      recordingType: active.recordingType as RecordingType,
      startedAtMs: new Date(active.startedAt).getTime(),
      chunkPrefix: active.segmentPrefix,
      chunkKey: recordingEncryptionService.deriveChunkKey(dek, active.id),
    };
  }

  /**
   * The agent finished uploading `session`'s chunks for a recording. `proof` is
   * HMAC-SHA256(chunkKey, completionProofMessage): only the job holding the chunk key can
   * produce it, so a leaked agent API key can't end someone's recording.
   *
   * Still ACTIVE means the agent is leaving the call (call ended, agent shut down), which
   * ends the recording. Returns false if the proof or the recording doesn't check out.
   */
  async completeAgentRecording(call: Call, recordingId: string, session: string, proof: string): Promise<boolean> {
    const recording = await repositories.callRecordings.findById(recordingId);
    if (!recording || recording.callId !== call.id || !isAgentRecording(recording)) return false;
    if (!AGENT_SESSION_PATTERN.test(session) || !recordingEncryptionService.isEncryptedRecording(recording)) return false;

    const chunkKey = recordingEncryptionService.deriveChunkKey(
      recordingEncryptionService.unwrapRecordingKey(recording.id, recording.encryption),
      recording.id,
    );
    const expected = createHmac('sha256', chunkKey).update(completionProofMessage(recordingId, session)).digest();
    const supplied = Buffer.from(proof, 'base64');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;

    if (recording.status === RecordingStatus.RECORDING_ACTIVE) {
      logger.info(`[CallRecording] agent left during recording ${recording.id}; stopping it`);
      await this.stopRecording(recording, call.externalId);
    }
    const { recordingStitchQueue } = await import('@/queues/recordingStitchQueue');
    await recordingStitchQueue.enqueue(recording.id);
    logger.info(`[CallRecording] agent completed recording ${recording.id} (session ${session}); stitch runs now`);
    return true;
  }

  /**
   * Stitch an agent recording: decrypt every session's chunks, rebuild each participant's
   * Ogg/Opus track, mix them on the recording timeline, encrypt the result and upload it.
   * Plaintext exists only in this worker's private temp dir, which is always removed.
   */
  private async stitchAgentRecording(recording: CallRecording): Promise<void> {
    const recordingId = recording.id;
    const stitchable: RecordingStatus[] = [
      RecordingStatus.RECORDING_STOPPED,
      RecordingStatus.PROCESSING_RECORDING,
      RecordingStatus.PROCESSING_FAILED,
    ];
    if (!stitchable.includes(recording.status as RecordingStatus)) {
      logger.info(`[CallRecording] stitch skipped — agent recording ${recordingId} in state ${recording.status}`);
      return;
    }
    if (recording.status === RecordingStatus.RECORDING_STOPPED) {
      // The fallback path: the agent never reported. Claim the row so only one stitch runs.
      const claimed = await repositories.callRecordings.transitionStatus(
        recordingId,
        [RecordingStatus.RECORDING_STOPPED],
        RecordingStatus.PROCESSING_RECORDING,
      );
      if (!claimed) {
        logger.info(`[CallRecording] stitch skipped — agent recording ${recordingId} moved on concurrently`);
        return;
      }
    }

    const call = await repositories.calls.findById(recording.callId);
    if (!call || !recording.segmentPrefix || !recordingEncryptionService.isEncryptedRecording(recording)) {
      await repositories.callRecordings.markProcessingFailed(recordingId);
      logger.error('[CallRecording] agent_stitch_missing_context', { recordingId, hasCall: !!call, segmentPrefix: recording.segmentPrefix });
      return;
    }

    const dek = recordingEncryptionService.unwrapRecordingKey(recordingId, recording.encryption);
    const chunkKey = recordingEncryptionService.deriveChunkKey(dek, recordingId);
    const fileKey = recordingEncryptionService.deriveFileKey(dek, recordingId);
    const paths = this.buildPaths(call.externalId, recordingId);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `rec-${recordingId}-`));

    try {
      const { audio, video } = await this.rebuildAgentTracks(recording, recording.segmentPrefix, chunkKey, workDir);
      const isVideo = recording.recordingType !== RecordingType.AUDIO_ONLY;
      if (audio.length === 0 && (!isVideo || video.length === 0)) {
        await repositories.callRecordings.markUploadFailed(recordingId);
        logger.warn('[CallRecording] recording_upload_failed', { recording: recordingId, reason: 'no_agent_media' });
        await this.deleteSegments(recording.segmentPrefix);
        return;
      }

      const localOut = path.join(workDir, 'out.mp4');
      if (isVideo) {
        const durationMs = this.agentRecordingDurationMs(recording, [...audio, ...video]);
        await mixAgentVideoRecording({ audio, video, durationMs }, localOut, agentVideoMixTimeoutMs(durationMs));
      } else {
        await mixAudioTracks(audio, localOut, AGENT_MIX_TIMEOUT_MS);
      }
      const plaintext = await fs.readFile(localOut);
      const container = recordingEncryptionService.encryptFile(fileKey, plaintext);
      // A generic type: the stored object is ciphertext, not something a client can play.
      await this.storageService.uploadFileV2(container, { path: paths.mp4Path, contentType: 'application/octet-stream' });
      if (!(await this.waitForFileExists(paths.mp4Path))) {
        throw new Error(`encrypted recording not found at ${paths.mp4Path}`);
      }

      await repositories.callRecordings.markUploaded(recordingId, { storagePath: paths.mp4Path });
      logger.info(
        `[CallRecording] agent recording ${recordingId} UPLOADED (encrypted), type=${recording.recordingType}, ` +
          `audioTracks=${audio.length}, videoStreams=${video.length}, path=${paths.mp4Path}`,
      );
      await this.deleteSegments(recording.segmentPrefix);

      if (!isRecording(call)) {
        try {
          await this.postRecordingMessageAndAttachment(call, { ...recording, storagePath: paths.mp4Path }, plaintext.length);
        } catch (err) {
          logger.error(`[CallRecording] Failed to post recording message/attachment for recording ${recordingId}:`, err);
        }
      }
    } catch (err) {
      await repositories.callRecordings.markProcessingFailed(recordingId).catch(() => {});
      logger.error(`[CallRecording] agent stitch failed for recording ${recordingId}:`, err);
      throw err;
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * How long an agent video recording is: from its start to its stop. Without a stop time
   * (should not happen once STOPPED), the latest any track could have started plus a
   * minute, so the output is never cut short by much.
   */
  private agentRecordingDurationMs(recording: CallRecording, tracks: Array<{ offsetMs: number }>): number {
    if (recording.endedAt) {
      const ms = new Date(recording.endedAt).getTime() - new Date(recording.startedAt).getTime();
      if (ms > 0) return ms;
    }
    logger.warn('[CallRecording] agent_stitch_no_end_time', { recording: recording.id });
    return Math.max(0, ...tracks.map((t) => t.offsetMs)) + 60_000;
  }

  /**
   * Decrypt each agent session's chunks into local files: one Ogg/Opus file per audio
   * track and one MPEG-TS file per composed video stream. Object layout (written by
   * python-agent/modules/call_recorder.py):
   *   <prefix><session>/manifest.bin              track and video offsets
   *   <prefix><session>/t<index:3>/<seq:8>.bin    consecutive slices of an audio track's Ogg stream
   *   <prefix><session>/v<index:3>/<seq:8>.bin    consecutive slices of a video stream's MPEG-TS
   * A stream stops at its first missing chunk: bytes after a gap can't continue it.
   */
  private async rebuildAgentTracks(
    recording: CallRecording,
    prefix: string,
    chunkKey: Buffer,
    workDir: string,
  ): Promise<{ audio: AudioTrackInput[]; video: VideoTrackInput[] }> {
    const files = await this.storageService.listFiles(prefix);
    const chunkPattern = /^([a-f0-9]{16})\/([tv])(\d{3})\/(\d{8})\.bin$/;
    const manifestPattern = /^([a-f0-9]{16})\/manifest\.bin$/;
    type Kind = 't' | 'v';

    // session -> "t007" / "v000" -> seqs
    const sessions = new Map<string, Map<string, number[]>>();
    for (const file of files) {
      const rel = file.name.startsWith(prefix) ? file.name.slice(prefix.length) : null;
      const chunk = rel ? chunkPattern.exec(rel) : null;
      if (chunk) {
        const [, session, kind, index, seq] = chunk;
        const streams = sessions.get(session) ?? new Map<string, number[]>();
        const key = `${kind}${index}`;
        const seqs = streams.get(key) ?? [];
        seqs.push(Number(seq));
        streams.set(key, seqs);
        sessions.set(session, streams);
      } else if (rel && !manifestPattern.test(rel)) {
        logger.warn('[CallRecording] agent_stitch_unexpected_object', { recording: recording.id, object: rel.slice(0, 120) });
      }
    }

    const audio: AudioTrackInput[] = [];
    const video: VideoTrackInput[] = [];
    for (const [session, streams] of sessions) {
      const manifestBlob = await this.storageService.getFileBuffer(`${prefix}${session}/manifest.bin`).catch(() => null);
      if (!manifestBlob) {
        logger.warn('[CallRecording] agent_stitch_session_skipped', { recording: recording.id, session, reason: 'no_manifest' });
        continue;
      }
      const manifest = agentManifestSchema.parse(
        JSON.parse(recordingEncryptionService.decryptLiveObject(chunkKey, manifestAad(recording.id, session), manifestBlob).toString('utf8')),
      );
      if (manifest.recordingId !== recording.id || manifest.session !== session) {
        throw new Error(`manifest of session ${session} does not belong to recording ${recording.id}`);
      }
      const offsets: Record<Kind, Map<number, number>> = {
        t: new Map(manifest.tracks.map((t) => [t.index, t.offsetMs])),
        v: new Map((manifest.video ?? []).map((t) => [t.index, t.offsetMs])),
      };

      for (const [key, seqs] of streams) {
        const kind = key[0] as Kind;
        const index = Number(key.slice(1));
        const offsetMs = offsets[kind].get(index);
        if (offsetMs === undefined) {
          logger.warn('[CallRecording] agent_stitch_track_skipped', { recording: recording.id, session, kind, index, reason: 'not_in_manifest' });
          continue;
        }
        seqs.sort((a, b) => a - b);
        const localPath = path.join(workDir, `${session}-${kind}${index}.${kind === 't' ? 'ogg' : 'ts'}`);
        let expected = 0;
        for (const seq of seqs) {
          if (seq !== expected) {
            logger.warn('[CallRecording] agent_stitch_track_gap', { recording: recording.id, session, kind, index, missingSeq: expected });
            break;
          }
          const name = `${prefix}${session}/${kind}${String(index).padStart(3, '0')}/${String(seq).padStart(8, '0')}.bin`;
          const blob = await this.storageService.getFileBuffer(name);
          const aad = kind === 't'
            ? liveChunkAad(recording.id, session, index, seq)
            : liveVideoChunkAad(recording.id, session, index, seq);
          // An authentication failure throws: tampered or foreign data fails the stitch.
          const plain = recordingEncryptionService.decryptLiveObject(chunkKey, aad, blob);
          await fs.appendFile(localPath, plain, { mode: 0o600 });
          expected++;
        }
        if (expected > 0) (kind === 't' ? audio : video).push({ path: localPath, offsetMs });
      }
    }
    return { audio, video };
  }

  /** Tell the egress worker to stop, if it is still running. */
  private async stopEgress(recording: CallRecording, callExternalId: string): Promise<void> {
    let egressId = this.activeEgress.get(recording.id) ?? recording.egressId ?? undefined;
    if (!egressId) {
      logger.warn('[CallRecording] egress_tracking_lost', { recording: recording.id, call: callExternalId, reason: 'no_egressId_on_row' });
      return;
    }
    this.activeEgress.delete(recording.id);
    try {
      const [egressInfo] = await this.egressClient.listEgress({ egressId });
      const stoppable =
        egressInfo?.status === EgressStatus.EGRESS_STARTING ||
        egressInfo?.status === EgressStatus.EGRESS_ACTIVE;
      if (!stoppable) {
        const statusName = egressInfo ? (EgressStatus[egressInfo.status] ?? egressInfo.status) : 'unknown';
        logger.info(`[CallRecording] Egress ${egressId} already in terminal state ${statusName}, skipping stop`);
        return;
      }
      await this.egressClient.stopEgress(egressId);
      logger.info(`[CallRecording] Gracefully stopped egress ${egressId} for recording ${recording.id}`);
    } catch (err) {
      logger.error(`[CallRecording] Failed to stop egress ${egressId} for recording ${recording.id}:`, err);
    }
  }

  /**
   * Retry fileExists with exponential backoff to handle the race between the
   * egress_ended webhook arriving and GCS propagation completing.
   * Attempts: 1s → 4s → 16s → 64s → 256s (341s total max wait)
   */
  private async waitForFileExists(path: string, maxAttempts = 5, initialDelayMs = 1000): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const exists = await this.storageService.fileExists(path);
        if (exists) return true;
      } catch (err) {
        logger.warn(`[CallRecording] fileExists check threw on attempt ${attempt} for ${path}: ${err}`);
      }
      if (attempt < maxAttempts) {
        const delay = initialDelayMs * Math.pow(4, attempt - 1);
        logger.info(`[CallRecording] File not yet available at ${path}, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return false;
  }

  /**
   * Handle the egress_ended webhook, correlated by egressId (C2). Egress now
   * produces HLS segments, so this moves the row to PROCESSING and enqueues the
   * stitch job rather than finalising directly. Even on egress failure we salvage
   * a partial recording if any segments landed; only a truly empty recording
   * moves to UPLOAD_FAILED (freeing the lock).
   */
  async handleEgressEnded(egressId: string, completedSuccessfully: boolean): Promise<void> {
    const recording = await repositories.callRecordings.findByEgressId(egressId);
    if (!recording) {
      logger.warn('[CallRecording] egress_ended_no_recording', { egressId, reason: 'no_row_for_egressId' });
      return;
    }
    // activeEgress is keyed by recording.id — delete by that, not egressId, or the entry leaks.
    this.activeEgress.delete(recording.id);

    // Only rows still awaiting egress act on this; anything else is a redelivery.
    if (recording.status !== 'RECORDING_ACTIVE' && recording.status !== 'RECORDING_STOPPED') {
      logger.info(`[CallRecording] egress_ended ignored — recording ${recording.id} already in state ${recording.status}`);
      return;
    }

    if (!(await this.hasSegments(recording.segmentPrefix))) {
      await repositories.callRecordings.markUploadFailed(recording.id);
      logger.warn('[CallRecording] recording_upload_failed', { recording: recording.id, egressId, completedSuccessfully, reason: 'no_segments' });
      return;
    }

    await repositories.callRecordings.markProcessing(recording.id);
    const { recordingStitchQueue } = await import('@/queues/recordingStitchQueue');
    await recordingStitchQueue.enqueue(recording.id);
    logger.info(`[CallRecording] recording ${recording.id} PROCESSING — stitch enqueued (completedSuccessfully=${completedSuccessfully})`);
  }

  /**
   * Stitch a recording's HLS segments into a single MP4 (called by the stitch
   * queue). Downloads the playlist + segments, remuxes with ffmpeg, uploads the
   * MP4, marks UPLOADED, deletes the segments, then posts the thread message.
   * Throws on a stitch/upload failure (after marking PROCESSING_FAILED) so the
   * queue retries; message posting is best-effort and never reverts the upload.
   */
  async stitchRecording(recordingId: string): Promise<void> {
    const recording = await repositories.callRecordings.findById(recordingId);
    if (!recording) {
      logger.warn('[CallRecording] stitch_no_recording', { recordingId });
      return;
    }
    if (isAgentRecording(recording)) {
      await this.stitchAgentRecording(recording);
      return;
    }
    if (recording.status !== 'PROCESSING_RECORDING' && recording.status !== 'PROCESSING_FAILED') {
      logger.info(`[CallRecording] stitch skipped — recording ${recordingId} in state ${recording.status}`);
      return;
    }
    const call = await repositories.calls.findById(recording.callId);
    if (!call || !recording.segmentPrefix) {
      await repositories.callRecordings.markProcessingFailed(recordingId);
      logger.error('[CallRecording] stitch_missing_context', { recordingId, hasCall: !!call, segmentPrefix: recording.segmentPrefix });
      return;
    }

    const paths = this.buildPaths(call.externalId, recordingId);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `rec-${recordingId}-`));
    try {
      await this.downloadSegments(recording.segmentPrefix, workDir);
      const localOut = path.join(workDir, 'out.mp4');
      await stitchHlsToMp4(path.join(workDir, path.basename(paths.playlistPath)), localOut);

      const mimetype = recordingMimetype(recording.recordingType);
      const buffer = await fs.readFile(localOut);
      await this.storageService.uploadFileV2(buffer, { path: paths.mp4Path, contentType: mimetype });
      if (!(await this.waitForFileExists(paths.mp4Path))) {
        throw new Error(`stitched MP4 not found at ${paths.mp4Path}`);
      }

      // Before markUploaded, so a recording is never reported playable without its attachment.
      if (isRecording(call)) {
        await this.attachNoteTakerRecording(call, recording, paths.mp4Path, buffer.length);
      }

      await repositories.callRecordings.markUploaded(recordingId, { storagePath: paths.mp4Path });
      logger.info(`[CallRecording] recording ${recordingId} UPLOADED (stitched), path=${paths.mp4Path}`);
      await this.deleteSegments(recording.segmentPrefix);

      // NOTE_TAKER (headless) calls have no thread to post into.
      if (!isRecording(call)) {
        try {
          await this.postRecordingMessageAndAttachment(call, { ...recording, storagePath: paths.mp4Path });
        } catch (err) {
          logger.error(`[CallRecording] Failed to post recording message/attachment for recording ${recordingId}:`, err);
        }
      }
    } catch (err) {
      await repositories.callRecordings.markProcessingFailed(recordingId).catch(() => {});
      logger.error(`[CallRecording] stitch failed for recording ${recordingId}:`, err);
      throw err;
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** True if any HLS object landed under the prefix (segments or playlist). */
  private async hasSegments(segmentPrefix: string | null): Promise<boolean> {
    if (!segmentPrefix) return false;
    try {
      const files = await this.storageService.listFiles(segmentPrefix);
      return files.length > 0;
    } catch (err) {
      logger.warn(`[CallRecording] listFiles failed for ${segmentPrefix}: ${err}`);
      return false;
    }
  }

  /** Download every object under the HLS prefix into a flat local dir (by basename). */
  private async downloadSegments(segmentPrefix: string, destDir: string): Promise<void> {
    const files = await this.storageService.listFiles(segmentPrefix);
    if (files.length === 0) throw new Error(`no segments under ${segmentPrefix}`);
    await Promise.all(files.map(async (f) => {
      const buffer = await this.storageService.getFileBuffer(f.name);
      await fs.writeFile(path.join(destDir, path.basename(f.name)), buffer);
    }));
  }

  /** Remove all HLS segments + playlist once the MP4 is safely stored. */
  private async deleteSegments(segmentPrefix: string): Promise<void> {
    try {
      const files = await this.storageService.listFiles(segmentPrefix);
      await Promise.all(files.map((f) => this.storageService.deleteFile(f.name).catch((e) =>
        logger.warn(`[CallRecording] failed to delete segment ${f.name}: ${e}`))));
    } catch (err) {
      logger.warn(`[CallRecording] deleteSegments failed for ${segmentPrefix}: ${err}`);
    }
  }

  /**
   * Post one thread message per recording (M3), carrying its own attachment.
   * The attachment metadata uses the 'recording' discriminator and carries
   * recordingId so cleanup can target exactly this recording.
   */
  private async postRecordingMessageAndAttachment(call: Call, recording: CallRecording, knownSize?: number): Promise<void> {
    const headMessage = await repositories.messages.findHeadMessageByCallId(call.externalId);
    if (!headMessage) {
      logger.warn('[CallRecording] recording_message_skipped', { recording: recording.id, reason: 'head_message_not_found' });
      return;
    }

    const callCreator = await repositories.users.findById(call.createdByUserId);
    if (!callCreator?.workspaceId) {
      logger.warn('[CallRecording] recording_message_skipped', { recording: recording.id, reason: 'workspace_not_found' });
      return;
    }
    const workspaceId = callCreator.workspaceId;

    const bot = await unifiedBotUserService.getBotByBotId('xyne-automatic', workspaceId);
    const senderId = bot?.id ?? call.createdByUserId;

    const recordingName = recording.name?.trim() || 'Recording';

    // Post the per-recording thread message first so the attachment hangs off it.
    const message = await repositories.messages.create({
      conversationId: headMessage.conversationId,
      senderId,
      content: `🎙️ **${recordingName}** ready`,
      msgType: bot ? MessageType.BOT : MessageType.SYSTEM,
      showInChannel: false,
      hasAttachment: true,
      metadata: {
        messageSubtype: 'recording',
        callId: call.externalId,
        recordingId: recording.id,
        recordingType: recording.recordingType,
        contentFormat: 'markdown',
      },
    });
    await repositories.callRecordings.setMessageId(recording.id, message.messageId);

    // Encrypted recordings pass their plaintext size: the stored object is larger.
    let fileSize = knownSize ?? 0;
    if (knownSize === undefined) {
      try {
        const meta = await this.storageService.getFileMetadata(recording.storagePath!);
        fileSize = parseInt(String(meta.size || '0'), 10);
      } catch (err) {
        logger.warn(`[CallRecording] Could not get file size for ${recording.storagePath}: ${err}`);
      }
    }

    await repositories.messageAttachments.create(
      this.buildRecordingAttachment(call, recording, {
        entityType: AttachmentEntityType.CHAT,
        entityId: message.messageId,
        conversationId: headMessage.conversationId,
        channelId: call.channelId ?? null,
        workspaceId,
        url: recording.storagePath!,
        size: fileSize,
      }),
    );

    await repositories.conversations.incrementReplyCount(headMessage.conversationId);
    logger.info(`[CallRecording] Posted recording message ${message.messageId} + attachment for recording ${recording.id}`);
  }

  /**
   * Note-taker recordings have no thread message, so their attachment belongs to the
   * recording itself and lets the player stream the file. Best-effort and retry-safe.
   */
  private async attachNoteTakerRecording(
    call: Call,
    recording: CallRecording,
    storagePath: string,
    size: number,
  ): Promise<void> {
    try {
      const [existing] = await repositories.messageAttachments.findByEntityIdAndType(
        recording.id,
        AttachmentEntityType.RECORDING,
      );
      const attachment =
        existing ??
        (await repositories.messageAttachments.create(
          this.buildRecordingAttachment(call, recording, {
            entityType: AttachmentEntityType.RECORDING,
            entityId: recording.id,
            conversationId: null,
            channelId: null,
            workspaceId: recording.workspaceId,
            url: storagePath,
            size,
          }),
        ));

      if (recording.attachmentId !== attachment.id) {
        await repositories.callRecordings.setAttachmentId(recording.id, attachment.id);
      }
    } catch (err) {
      logger.error(`[CallRecording] Failed to attach note-taker recording ${recording.id}:`, err);
    }
  }

  private buildRecordingAttachment(
    call: Call,
    recording: CallRecording,
    target: RecordingAttachmentTarget,
  ): CreateMessageAttachmentInput {
    const recordingName = recording.name?.trim() || 'Recording';
    const uploader = recording.startedBy ?? call.createdByUserId;

    return {
      ...target,
      originalFilename: call.title ? `${call.title} - ${recordingName}.mp4` : `${recordingName}.mp4`,
      mimetype: recordingMimetype(recording.recordingType),
      uploadedByUserId: uploader,
      createdBy: uploader,
      storageProvider: config.fileStorage.provider,
      metadata: { callId: call.externalId, recordingId: recording.id, type: 'recording' },
    };
  }

  /**
   * Update the display filename of a call's recording attachments to include the
   * (newly generated) call title. Called when a call title is generated late.
   * Operates per-recording — each recording owns its own thread message + attachment.
   */
  async updateRecordingFilename(callExternalId: string, callTitle: string): Promise<void> {
    try {
      const call = await repositories.calls.findByExternalId(callExternalId);
      if (!call) return;
      const recordings = await repositories.callRecordings.listByCallId(call.id);
      for (const recording of recordings) {
        if (!recording.messageId) continue;
        const attachments = await repositories.messageAttachments.findByEntityIdAndType(
          recording.messageId,
          AttachmentEntityType.CHAT,
        );
        const label = recording.name?.trim() || 'Recording';
        for (const attachment of attachments) {
          await repositories.messageAttachments.update(attachment.id, {
            originalFilename: `${callTitle} - ${label}.mp4`,
          });
        }
      }
      logger.info(`[CallRecording] Updated recording filenames for call ${callExternalId} → "${callTitle}"`);
    } catch (err) {
      logger.warn(`[CallRecording] Failed to update recording filename for call ${callExternalId}:`, err);
    }
  }

  /**
   * Manual user delete (starter-only authz is enforced in the controller). Soft
   * delete: status → DELETED (row kept for audit), file + attachment + thread
   * message removed so the chat doesn't show a dead player.
   */
  async deleteRecording(recording: CallRecording): Promise<void> {
    if (recording.storagePath) {
      try {
        await this.storageService.deleteFile(recording.storagePath);
      } catch (err) {
        logger.warn(`[CallRecording] Could not delete file ${recording.storagePath} for recording ${recording.id}: ${err}`);
      }
    }
    // Drop any HLS segments left behind (recording deleted mid-processing).
    if (recording.segmentPrefix) {
      await this.deleteSegments(recording.segmentPrefix);
    }
    await repositories.messageAttachments.deleteByRecordingIds([recording.id]).catch((err) =>
      logger.warn(`[CallRecording] Could not delete attachment for recording ${recording.id}: ${err}`));
    if (recording.messageId) {
      try {
        await repositories.messageAttachments.deleteByMessageId(recording.messageId);
        await repositories.messages.update(recording.messageId, {
          content: 'Recording deleted',
          hasAttachment: false,
        });
      } catch (err) {
        logger.warn(`[CallRecording] Could not clean message ${recording.messageId} for recording ${recording.id}: ${err}`);
      }
    }
    await repositories.callRecordings.markDeleted(recording.id);
    if (recordingEncryptionService.isEncryptedRecording(recording)) {
      // Crypto-shred: without its data key no copy of this recording can be decrypted.
      await repositories.callRecordings.clearEncryption(recording.id);
    }
    logger.info(`[CallRecording] Soft-deleted recording ${recording.id}`);
  }

  /** Create a readable stream for a recording file from storage, by recording id. */
  async streamRecordingById(recordingId: string): Promise<{ stream: NodeJS.ReadableStream; filename: string } | null> {
    const path = await this.getStoragePathById(recordingId);
    if (!path) return null;
    const filename = path.split('/').pop() ?? `recording-${recordingId}.mp4`;
    const recording = await repositories.callRecordings.findById(recordingId);
    if (recording && recordingEncryptionService.isEncryptedRecording(recording)) {
      const { stream } = await this.openDecryptedStream(recording, path);
      return { stream, filename };
    }
    const stream = await this.storageService.createReadStream(path);
    return { stream, filename };
  }

  /**
   * Plaintext size and the decryption context of an encrypted recording file, from its
   * 32-byte header. Used by every reader (download, email, attachment streaming).
   */
  async describeEncryptedFile(recording: CallRecording, storagePath: string) {
    const fileKey = recordingEncryptionService.deriveFileKey(
      recordingEncryptionService.unwrapRecordingKey(recording.id, recording.encryption),
      recording.id,
    );
    const headerBytes = await this.readRange(storagePath, 0, XREC_HEADER_LENGTH - 1);
    const header = recordingEncryptionService.parseHeader(headerBytes);
    return { fileKey, header };
  }

  /**
   * Decrypted bytes [start, end] of an encrypted recording file (the whole file without a
   * range). Reads only the container chunks that hold the range, so seeking stays cheap.
   */
  async openDecryptedStream(
    recording: CallRecording,
    storagePath: string,
    range?: { start: number; end: number },
  ): Promise<{ stream: NodeJS.ReadableStream; plaintextLength: number }> {
    const { fileKey, header } = await this.describeEncryptedFile(recording, storagePath);
    if (header.plaintextLength === 0) throw new Error(`recording ${recording.id} is empty`);
    const plain = range ?? { start: 0, end: header.plaintextLength - 1 };
    const cipher = recordingEncryptionService.ciphertextRange(header, plain.start, plain.end);
    const source = await this.storageService.createReadStream(storagePath, { start: cipher.start, end: cipher.end });
    const decrypt = recordingEncryptionService.createDecryptStream(fileKey, header, plain);
    source.on('error', (err) => decrypt.destroy(err));
    return { stream: source.pipe(decrypt), plaintextLength: header.plaintextLength };
  }

  private async readRange(storagePath: string, start: number, end: number): Promise<Buffer> {
    const stream = await this.storageService.createReadStream(storagePath, { start, end });
    const parts: Buffer[] = [];
    for await (const part of stream as AsyncIterable<Buffer | string>) {
      parts.push(typeof part === 'string' ? Buffer.from(part) : part);
    }
    return Buffer.concat(parts);
  }

  async getRecordingMetadataById(recordingId: string): Promise<Record<string, unknown> | null> {
    const path = await this.getStoragePathById(recordingId);
    if (!path) return null;
    try {
      return await this.storageService.getFileMetadata(path) as Record<string, unknown>;
    } catch (err) {
      logger.warn(`[CallRecording] getRecordingMetadataById failed for ${recordingId}: ${err}`);
      return null;
    }
  }

  /** Resolve a recording's storage path, verifying the file still exists. */
  async getStoragePathById(recordingId: string): Promise<string | null> {
    const recording = await repositories.callRecordings.findById(recordingId);
    if (!recording?.storagePath) {
      logger.warn(`[CallRecording] getStoragePathById: no storagePath for recording ${recordingId}`);
      return null;
    }
    try {
      const exists = await this.storageService.fileExists(recording.storagePath);
      if (!exists) {
        logger.warn(`[CallRecording] getStoragePathById: file not found at ${recording.storagePath}`);
        return null;
      }
    } catch (err) {
      logger.error(`[CallRecording] getStoragePathById: fileExists threw for ${recording.storagePath}:`, err);
      return null;
    }
    return recording.storagePath;
  }

  /**
   * Cleanup expired recordings (cron). Two passes for different retention windows.
   * Deletes the file, marks the row EXPIRED, and removes the recording's thread
   * message attachment so the chat doesn't show a dead player (H2).
   */
  async cleanupExpiredRecordings(): Promise<void> {
    let totalCleaned = 0;

    const passes: Array<{ days: number; types: RecordingType[] }> = [
      { days: this.getRetentionDays(), types: [RecordingType.AUDIO_ONLY] },
      { days: config.screenRecording.retentionDays, types: [RecordingType.AUDIO_SCREEN, RecordingType.AUDIO_VIDEO] },
    ];

    for (const pass of passes) {
      if (pass.days <= 0) continue;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - pass.days);
      for (const type of pass.types) {
        const expired = await repositories.callRecordings.findExpiredUploaded(cutoff, type);
        for (const recording of expired) {
          try {
            if (recording.storagePath) {
              await this.storageService.deleteFile(recording.storagePath);
            }
            await repositories.callRecordings.markExpired(recording.id);
            if (recordingEncryptionService.isEncryptedRecording(recording)) {
              await repositories.callRecordings.clearEncryption(recording.id);
            }
            await repositories.messageAttachments.deleteByRecordingIds([recording.id]);
            if (recording.messageId) {
              await repositories.messageAttachments.deleteByMessageId(recording.messageId);
              await repositories.messages.update(recording.messageId, {
                content: 'Recording expired',
                hasAttachment: false,
              });
            }
            logger.info(`[CallRecording] Expired recording ${recording.id} (${type}), path=${recording.storagePath}`);
            totalCleaned++;
          } catch (err) {
            logger.error(`[CallRecording] Failed to expire recording ${recording.id}:`, err);
          }
        }
      }
    }

    if (totalCleaned > 0) {
      logger.info(`[CallRecording] Cleaned up ${totalCleaned} expired recordings`);
    }
  }
}

export const callRecordingService = new CallRecordingService();
