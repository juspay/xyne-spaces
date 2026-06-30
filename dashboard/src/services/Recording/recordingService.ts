/**
 * Recording Service for Web Dashboard
 * Handles headless audio recording with LiveKit and backend API integration
 */

import { apiInstance } from '../clients/apiClient';
import { AxiosResponse } from 'axios';
import type { RecordingType } from '@xyne/shared';

export interface RecordingSession {
  id: string;
  externalId: string;
  token: string;
  serverUrl: string;
  channelId: string;
  startTime: number;
}

export interface Recording {
  id: string;
  externalId: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  hasTranscript: boolean;
  hasSummary: boolean;
  hasRecording?: boolean;
}

export interface RecordingDetail extends Recording {
  transcript: string | null;
  identifiedTranscript: string | null;
  hasIdentifiedTranscript: boolean;
  aiSummary: string | null;
  aiSummaryFormat?: 'markdown' | 'html';
  conversationId: string | null;
  channelId: string | null;
  messageId: string | null;
  hasRecording?: boolean;
}

/** A single in-call recording session (call_recordings row). */
export interface CallRecording {
  id: string;
  name: string | null;
  recordingType: RecordingType;
  status:
    | 'RECORDING_ACTIVE'
    | 'RECORDING_STOPPED'
    | 'RECORDING_UPLOADED'
    | 'RECORDING_FAILED'
    | 'RECORDING_UPLOAD_FAILED'
    | 'RECORDING_EXPIRED'
    | 'RECORDING_DELETED';
  startedBy: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  messageId: string | null;
  downloadUrl: string | null;
}

export interface StartRecordingResponse {
  success: boolean;
  alreadyActive: boolean;
  recording: {
    id: string;
    name: string | null;
    recordingType: RecordingType;
    status: string;
    startedBy: string | null;
    startedAt: string;
  };
}

interface InitiateCallResponse {
  token: string;
  livekitUrl: string;
  externalId: string;
  channelId: string;
}

interface RecordingsResponse {
  success: boolean;
  recordings: Recording[];
  nextCursor?: string | null;
  hasMore?: boolean;
}

interface RecordingDetailResponse {
  success: boolean;
  recording: RecordingDetail;
}

class RecordingService {
  /**
   * Start a headless recording session
   * Calls backend to initiate a HEADLESS call and returns LiveKit credentials
   */
  async startRecording(params?: {
    sttModel?: 'google' | 'azure' | 'deepgram';
  }): Promise<RecordingSession> {
    const response: AxiosResponse<InitiateCallResponse> = await apiInstance.post(
      '/calls/initiate',
      {
        isHeadless: true,
        callType: 'AUDIO',
        sttModel: params?.sttModel || 'azure',
      },
    );

    const data: InitiateCallResponse = response.data;

    return {
      id: data.externalId,
      externalId: data.externalId,
      token: data.token,
      serverUrl: data.livekitUrl,
      channelId: data.channelId,
      startTime: Date.now(),
    };
  }

  /**
   * Get all recordings for the current user
   */
  async getRecordings(params?: {
    limit?: number;
    cursor?: string | null;
  }): Promise<RecordingsResponse> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.cursor) queryParams.append('cursor', params.cursor);

    const url = `/calls/recordings${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response: AxiosResponse<RecordingsResponse> = await apiInstance.get(url);

    return response.data;
  }

  /**
   * Get recording detail with transcript and summary
   */
  async getRecordingDetail(callId: string): Promise<RecordingDetail> {
    const response: AxiosResponse<RecordingDetailResponse> = await apiInstance.get(
      `/calls/recordings/${callId}`,
    );

    const data: RecordingDetailResponse = response.data;
    return data.recording;
  }

  /**
   * Update recording title
   */
  async updateRecordingTitle(callId: string, title: string): Promise<void> {
    await apiInstance.patch(`/calls/recordings/${callId}`, { title });
  }

  /**
   * Delete a recording
   */
  async deleteRecording(callId: string): Promise<void> {
    await apiInstance.delete(`/calls/recordings/${callId}`);
  }

  /**
   * Start an in-call recording. Any participant may start; the backend enforces a
   * single ACTIVE recording per call, so a concurrent start returns the existing
   * recording with `alreadyActive: true` instead of starting a second egress.
   */
  async startCallRecording(
    callId: string,
    recordingType: RecordingType,
    name?: string,
  ): Promise<StartRecordingResponse> {
    const response: AxiosResponse<StartRecordingResponse> = await apiInstance.post(
      `/calls/${callId}/recording/start`,
      { recordingType, ...(name ? { name } : {}) },
    );
    return response.data;
  }

  /**
   * Stop the call's active recording. Only the participant who started it may stop
   * it. `recordingId` defaults server-side to the call's active recording; `name`
   * renames the recording at stop (the rename popup).
   */
  async stopCallRecording(
    callId: string,
    opts?: { recordingId?: string; name?: string },
  ): Promise<void> {
    await apiInstance.post(`/calls/${callId}/recording/stop`, {
      ...(opts?.recordingId ? { recordingId: opts.recordingId } : {}),
      ...(opts?.name ? { name: opts.name } : {}),
    });
  }

  /** Rename a recording (starter-only). */
  async renameCallRecording(callId: string, recordingId: string, name: string): Promise<void> {
    await apiInstance.patch(`/calls/${callId}/recordings/${recordingId}`, { name });
  }

  /** Soft-delete a recording (starter-only). */
  async deleteCallRecording(callId: string, recordingId: string): Promise<void> {
    await apiInstance.delete(`/calls/${callId}/recordings/${recordingId}`);
  }

  /** Download a specific recording's file blob. */
  async downloadCallRecordingBlob(
    callId: string,
    recordingId: string,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const response: AxiosResponse<Blob> = await apiInstance.get(
      `/calls/${callId}/recordings/${recordingId}/download`,
      { responseType: 'blob', ...(signal ? { signal } : {}) },
    );
    return response.data;
  }

  /**
   * Download the call's latest recording blob via the legacy single-recording
   * endpoint (used by the recordings list / headless player).
   * Pass the signal to abort the fetch when the component unmounts mid-download.
   */
  async downloadRecordingBlob(callId: string, signal?: AbortSignal): Promise<Blob> {
    const response: AxiosResponse<Blob> = await apiInstance.get(
      `/calls/${callId}/download-recording`,
      { responseType: 'blob', ...(signal ? { signal } : {}) },
    );
    return response.data;
  }
}

export const recordingService = new RecordingService();
