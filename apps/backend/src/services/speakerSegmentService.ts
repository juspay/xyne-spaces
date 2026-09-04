/**
 * Local speaker segments ("speaker disambiguation").
 *
 * The Electron desktop app can run Sherpa-ONNX speaker diarization on the
 * microphone audio of a note-taker (HEADLESS) recording and upload the speaker
 * timeline it found. A note-taker recording publishes ONE microphone track, so
 * the transcription agent labels every utterance with the recorder's own name;
 * this service is what turns that into "Speaker 1 / Speaker 2 / …".
 *
 * Storage (transcription bucket):
 *   transcriptions/{callId}_speakers.json      — raw upload from the client
 *   transcriptions/{callId}_identified.jsonl   — relabelled transcript (same file the
 *                                                voiceprint identifier writes)
 *   attachments/{callId}_identified_formatted.txt
 *
 * Writing the relabelled transcript to the *_identified.jsonl path means every
 * existing consumer — recording-detail API, citation segments, note-taker summary —
 * picks it up with no further changes.
 */
import { z } from 'zod';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import type { StorageService } from '@xyne/storage';
import { getStorageService } from '@/services/storage';
import { transcriptService, type TranscriptEntry } from '@/services/transcriptService';

export const LocalSpeakerSegmentsSchema = z.object({
  /** Epoch ms when the client's audio tap captured its first sample. */
  recordingStartedAt: z.number().int().positive(),
  durationSeconds: z.number().nonnegative().max(24 * 60 * 60).optional(),
  sampleRate: z.number().int().positive().optional(),
  source: z.string().max(64).optional(),
  segments: z
    .array(
      z.object({
        start: z.number().nonnegative(),
        end: z.number().nonnegative(),
        speaker: z.number().int().nonnegative(),
      }).refine((s) => s.end > s.start, { message: 'segment end must be after start' }),
    )
    .max(50_000),
});

export type LocalSpeakerSegments = z.infer<typeof LocalSpeakerSegmentsSchema>;

interface StoredSpeakerSegments extends LocalSpeakerSegments {
  callId: string;
  uploadedAt: string;
  uploadedByUserId: string;
}

// Utterance duration estimate: the agent only records the time an utterance
// *finished*, so its start is approximated from word count.
const WORDS_PER_SECOND = 2.5;
const MIN_UTTERANCE_SECONDS = 0.8;
const MAX_UTTERANCE_SECONDS = 30;
// The agent stamps each line when its STT turn was *finalised*, which lags the
// actual end of speech by an unknown, fairly constant amount (end-of-turn
// detection + STT latency + clock skew vs the desktop). Rather than assume a
// value, search this range for the offset that best lines the transcript up
// with the diarizer's speech timeline. Positive = transcript stamps are late.
const OFFSET_SEARCH_MIN_SECONDS = -3;
const OFFSET_SEARCH_MAX_SECONDS = 8;
const OFFSET_SEARCH_STEP_SECONDS = 0.25;
// A segment further than this from an utterance is not considered a match.
const NEAREST_SEGMENT_MAX_GAP_SECONDS = 3;
const UNKNOWN_SPEAKER = 'Unknown';

export class SpeakerSegmentService {
  private storage: StorageService;

  constructor() {
    this.storage = getStorageService(config.gcs.transcriptionBucketName);
  }

  private segmentsPath(callId: string): string {
    return `transcriptions/${callId}_speakers.json`;
  }
  private identifiedPath(callId: string): string {
    return `transcriptions/${callId}_identified.jsonl`;
  }
  private identifiedFormattedPath(callId: string): string {
    return `attachments/${callId}_identified_formatted.txt`;
  }

  async hasSegments(callId: string): Promise<boolean> {
    try {
      return await this.storage.fileExists(this.segmentsPath(callId));
    } catch {
      return false;
    }
  }

  async storeSegments(callId: string, userId: string, payload: LocalSpeakerSegments): Promise<void> {
    const stored: StoredSpeakerSegments = {
      ...payload,
      callId,
      uploadedAt: new Date().toISOString(),
      uploadedByUserId: userId,
    };
    await this.storage.uploadFileV2(Buffer.from(JSON.stringify(stored), 'utf-8'), {
      path: this.segmentsPath(callId),
      contentType: 'application/json',
      metadata: { callId, type: 'speaker_segments' },
    });
    logger.info(`[${callId}] speaker_segments_stored`, {
      segment_count: payload.segments.length,
      speaker_count: new Set(payload.segments.map((s) => s.speaker)).size,
      duration_seconds: payload.durationSeconds,
    });
  }

  private async loadSegments(callId: string): Promise<StoredSpeakerSegments | null> {
    const path = this.segmentsPath(callId);
    if (!(await this.storage.fileExists(path))) return null;
    const raw = (await this.storage.getFileBuffer(path)).toString('utf-8');
    try {
      return JSON.parse(raw) as StoredSpeakerSegments;
    } catch (error) {
      logger.error(`[${callId}] speaker_segments_parse_failed`, { error });
      return null;
    }
  }

  private async loadEntries(path: string): Promise<TranscriptEntry[] | null> {
    if (!(await this.storage.fileExists(path))) return null;
    const raw = (await this.storage.getFileBuffer(path)).toString('utf-8');
    const entries = transcriptService.parseTranscriptEntries(raw);
    return entries.length > 0 ? entries : null;
  }

  /**
   * Model every transcript entry as a time window [end - estimatedDuration, end]
   * relative to the recording start, using the *raw* finalisation stamp. Windows
   * are clipped so they cannot start before the previous utterance of the same
   * participant ended.
   */
  private utteranceWindows(entries: TranscriptEntry[], startEpochSeconds: number): Array<[number, number]> {
    const lastEndByParticipant = new Map<string, number>();
    return entries.map((entry) => {
      const relEnd = entry.timestamp - startEpochSeconds;
      const words = (entry.text || '').trim().split(/\s+/).filter(Boolean).length;
      const estimated = Math.min(MAX_UTTERANCE_SECONDS, Math.max(MIN_UTTERANCE_SECONDS, words / WORDS_PER_SECOND));
      const previousEnd = lastEndByParticipant.get(entry.participant_identity) ?? -Infinity;
      const relStart = Math.max(relEnd - estimated, previousEnd + 0.05);
      lastEndByParticipant.set(entry.participant_identity, relEnd);
      return [relStart, relEnd];
    });
  }

  private static overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
    return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  }

  /**
   * Find the constant shift (seconds) that maximises total overlap between the
   * utterance windows and the diarizer's speech segments, i.e. how late the
   * transcript stamps are relative to the audio. Ties go to the smaller |shift|.
   */
  private calibrateOffset(windows: Array<[number, number]>, segments: StoredSpeakerSegments['segments']): number {
    let bestOffset = 0;
    let bestScore = -1;
    for (let offset = OFFSET_SEARCH_MIN_SECONDS; offset <= OFFSET_SEARCH_MAX_SECONDS + 1e-9; offset += OFFSET_SEARCH_STEP_SECONDS) {
      let score = 0;
      for (const [start, end] of windows) {
        for (const segment of segments) {
          score += SpeakerSegmentService.overlap(start - offset, end - offset, segment.start, segment.end);
        }
      }
      if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && Math.abs(offset) < Math.abs(bestOffset))) {
        bestScore = score;
        bestOffset = offset;
      }
    }
    return Number(bestOffset.toFixed(2));
  }

  /**
   * Assign a diarization cluster to every transcript entry.
   *
   * After calibrating the transcript/audio offset, the cluster with the most
   * overlap wins; if nothing overlaps, the nearest segment within a few seconds
   * is used; otherwise the entry keeps the previous entry's cluster (a long
   * utterance split by STT).
   */
  private assignClusters(
    entries: TranscriptEntry[],
    stored: StoredSpeakerSegments,
  ): { clusters: Array<number | null>; offsetSeconds: number } {
    const startEpochSeconds = stored.recordingStartedAt / 1000;
    const segments = [...stored.segments].sort((a, b) => a.start - b.start);
    const windows = this.utteranceWindows(entries, startEpochSeconds);
    const offsetSeconds = this.calibrateOffset(windows, segments);

    const clusters: Array<number | null> = [];
    let previousCluster: number | null = null;

    for (const [rawStart, rawEnd] of windows) {
      const relStart = Math.max(0, rawStart - offsetSeconds);
      const relEnd = rawEnd - offsetSeconds;

      const overlapByCluster = new Map<number, number>();
      let nearest: { cluster: number; gap: number } | null = null;
      for (const segment of segments) {
        const overlap = SpeakerSegmentService.overlap(relStart, relEnd, segment.start, segment.end);
        if (overlap > 0) {
          overlapByCluster.set(segment.speaker, (overlapByCluster.get(segment.speaker) ?? 0) + overlap);
        } else {
          const gap = segment.start > relEnd ? segment.start - relEnd : relStart - segment.end;
          if (gap <= NEAREST_SEGMENT_MAX_GAP_SECONDS && (!nearest || gap < nearest.gap)) {
            nearest = { cluster: segment.speaker, gap };
          }
        }
      }

      let cluster: number | null;
      if (overlapByCluster.size > 0) {
        cluster = [...overlapByCluster.entries()].sort((a, b) => b[1] - a[1])[0][0];
      } else if (nearest) {
        cluster = nearest.cluster;
      } else {
        cluster = previousCluster;
      }
      clusters.push(cluster);
      previousCluster = cluster ?? previousCluster;
    }
    return { clusters, offsetSeconds };
  }

  /**
   * Build the relabelled transcript from the plain agent transcript + uploaded
   * segments and write it to the *_identified.jsonl / formatted paths.
   *
   * If the voiceprint identifier already produced an identified transcript, its
   * real names are kept: each cluster takes the name the majority of its
   * entries were identified as, and only "Unknown" entries fall back to
   * "Speaker N". Returns false when either input is missing.
   */
  async materializeIdentifiedTranscript(callId: string): Promise<boolean> {
    const stored = await this.loadSegments(callId);
    if (!stored) return false;
    if (stored.segments.length === 0) {
      logger.info(`[${callId}] speaker_segments_empty`, { action: 'skip_materialize' });
      return false;
    }

    const entries = await this.loadEntries(`transcriptions/${callId}.jsonl`);
    if (!entries) {
      logger.info(`[${callId}] speaker_segments_transcript_missing`, { action: 'defer_materialize' });
      return false;
    }

    const { clusters, offsetSeconds } = this.assignClusters(entries, stored);

    // Optional: fold in real names from the voiceprint identifier.
    const voiceprint = await this.loadEntries(this.identifiedPath(callId)).catch(() => null);
    const voiceprintAligned = voiceprint && voiceprint.length === entries.length ? voiceprint : null;
    const nameVotes = new Map<number, Map<string, number>>();
    if (voiceprintAligned) {
      voiceprintAligned.forEach((identified, index) => {
        const cluster = clusters[index];
        const name = identified.user;
        if (cluster === null || !name || name === UNKNOWN_SPEAKER) return;
        // Skip names that merely echo the recorder's own display name for every line.
        if (name === entries[index].user) return;
        const votes = nameVotes.get(cluster) ?? new Map<string, number>();
        votes.set(name, (votes.get(name) ?? 0) + 1);
        nameVotes.set(cluster, votes);
      });
    }

    // Stable "Speaker N" numbering in order of first appearance in the transcript.
    const labelByCluster = new Map<number, string>();
    let nextSpeakerNumber = 1;
    const labelFor = (cluster: number | null): string => {
      if (cluster === null) return UNKNOWN_SPEAKER;
      const existing = labelByCluster.get(cluster);
      if (existing) return existing;
      const votes = nameVotes.get(cluster);
      const voted = votes ? [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
      const label = voted ?? `Speaker ${nextSpeakerNumber++}`;
      labelByCluster.set(cluster, label);
      return label;
    };

    const relabelled: TranscriptEntry[] = entries.map((entry, index) => ({
      ...entry,
      user: labelFor(clusters[index]),
    }));

    const jsonl = relabelled.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    await this.storage.uploadFileV2(Buffer.from(jsonl, 'utf-8'), {
      path: this.identifiedPath(callId),
      contentType: 'application/x-ndjson',
      metadata: { callId, type: 'identified_transcript', source: 'local_speaker_segments' },
    });
    const formatted = transcriptService.formatTranscript(relabelled, callId);
    await this.storage.uploadFileV2(Buffer.from(formatted, 'utf-8'), {
      path: this.identifiedFormattedPath(callId),
      contentType: 'text/plain',
      metadata: { callId, type: 'identified_transcript', source: 'local_speaker_segments' },
    });

    logger.info(`[${callId}] speaker_segments_applied`, {
      entries: entries.length,
      offset_seconds: offsetSeconds,
      speakers: labelByCluster.size,
      unassigned: clusters.filter((c) => c === null).length,
      named_from_voiceprints: [...labelByCluster.values()].filter((l) => !l.startsWith('Speaker ')).length,
    });
    return true;
  }
}

export const speakerSegmentService = new SpeakerSegmentService();
