/**
 * Recording Service for Web Dashboard
 * Handles headless audio recording with LiveKit and backend API integration
 */

import { apiInstance } from '../clients/apiClient';
import { AxiosResponse } from 'axios';

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
   * Ensure the recording is persisted as a MessageAttachment in the DB.
   * Idempotent – safe to call multiple times. Returns the attachment ID.
   */
  async saveRecordingAttachment(callId: string): Promise<{ attachmentId: string }> {
    const response: AxiosResponse<{ success: boolean; attachmentId: string }> =
      await apiInstance.post(`/calls/${callId}/save-recording-attachment`);
    return { attachmentId: response.data.attachmentId };
  }

  /**
   * Download the raw audio blob for a recording via the streaming endpoint.
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
