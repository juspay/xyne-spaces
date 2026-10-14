// ---------------------------------------------------------------------------
// RecordingService
// API layer for recording operations.
// Ported from dashboard/src/services/Recording/recordingService.ts,
// adapted to use the lotus apiGet/apiPost/apiRequest client pattern.
// ---------------------------------------------------------------------------

import * as FileSystem from 'expo-file-system/legacy';

import { apiGet, apiPost, apiRequest } from '@/src/services/apiClient';
import { getAuthToken } from '@/src/contexts/AuthContext';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import { mtlsDownloadToFile } from '@/src/utils/mtlsHttpClient';
import { API_BASE_URL } from '@/src/config';
import type {
  InitiateCallResponse,
  Recording,
  RecordingDetail,
  RecordingDetailResponse,
  RecordingSession,
  RecordingsResponse,
  RecordingType,
  ShareTarget,
} from '@/src/types/recordings';
import type { SttModel } from '@/src/types/recordings';

const inflightRecordingDownloads = new Map<string, Promise<string>>();

class RecordingService {
  /**
   * Start a headless recording session.
   * Calls /calls/initiate with isHeadless:true and returns LiveKit credentials.
   */
  async startRecording(params?: { sttModel?: SttModel }): Promise<RecordingSession> {
    const token = await getAuthToken();
    const response = await apiPost<InitiateCallResponse>(
      '/calls/initiate',
      {
        isHeadless: true,
        callType: 'AUDIO',
        sttModel: params?.sttModel ?? 'google',
      },
      token ? { token } : {},
    );

    return {
      id: response.externalId,
      externalId: response.externalId,
      token: response.token,
      serverUrl: response.livekitUrl,
      channelId: response.channelId,
      startTime: Date.now(),
    };
  }

  /**
   * Fetch all recordings for the authenticated user.
   */
  async getRecordings(): Promise<Recording[]> {
    const token = await getAuthToken();
    const response = await apiGet<RecordingsResponse>('/calls/recordings', {
      ...(token ? { token } : {}),
    });
    return response.recordings;
  }

  /**
   * Fetch a single recording with transcript and AI summary.
   */
  async getRecordingDetail(callId: string): Promise<RecordingDetail> {
    const token = await getAuthToken();
    const response = await apiGet<RecordingDetailResponse>(
      `/calls/recordings/${encodeURIComponent(callId)}`,
      { ...(token ? { token } : {}) },
    );
    return response.recording;
  }

  /**
   * Update the title of a recording.
   */
  async updateRecordingTitle(callId: string, title: string): Promise<void> {
    const token = await getAuthToken();
    await apiRequest<{ success: boolean }>(`/calls/recordings/${encodeURIComponent(callId)}`, {
      method: 'PATCH',
      body: { title },
      ...(token ? { token } : {}),
    });
  }

  /**
   * Delete a recording permanently.
   */
  async deleteRecording(callId: string): Promise<void> {
    const token = await getAuthToken();
    await apiRequest<{ success: boolean }>(`/calls/recordings/${encodeURIComponent(callId)}`, {
      method: 'DELETE',
      ...(token ? { token } : {}),
    });
  }

  /**
   * Grant recording access to a target (channel or user) — a recording-level
   * ACL share, independent of any chat message. The backend creates the
   * DM/channel post itself. `targets` stays an array for contract accuracy;
   * the mobile picker only ever sends a single element for now.
   */
  async shareRecording(callId: string, targets: ShareTarget[], message?: string): Promise<void> {
    const token = await getAuthToken();
    await apiPost<{ success: boolean }>(
      `/calls/recordings/${encodeURIComponent(callId)}/sharing`,
      { action: 'grant', targets, ...(message ? { messageContent: message } : {}) },
      token ? { token } : {},
    );
  }

  /**
   * Download the recording's media (audio-only, or audio+video for a
   * screen/camera recording) to a local cache file, authenticated via the
   * mTLS client (the API host rejects a bare, unauthenticated fetch — same
   * reason a raw remote URL can't be handed to the native player). Returns
   * the local file:// URI, downloading only once per callId.
   */
  async downloadRecordingMedia(
    callId: string,
    recordingType?: RecordingType | null,
  ): Promise<string> {
    const existingRequest = inflightRecordingDownloads.get(callId);
    if (existingRequest) {
      return existingRequest;
    }

    const request = this.downloadRecordingMediaUncached(callId, recordingType).finally(() => {
      inflightRecordingDownloads.delete(callId);
    });
    inflightRecordingDownloads.set(callId, request);
    return request;
  }

  private async downloadRecordingMediaUncached(
    callId: string,
    recordingType?: RecordingType | null,
  ): Promise<string> {
    const extension = recordingType && recordingType !== 'AUDIO_ONLY' ? 'mp4' : 'm4a';
    const cacheDir = `${FileSystem.cacheDirectory}recordings`;
    const localPath = `${cacheDir}/${encodeURIComponent(callId)}.${extension}`;

    const existing = await FileSystem.getInfoAsync(localPath);
    if (existing.exists && existing.size > 0) {
      return localPath;
    }

    const dirInfo = await FileSystem.getInfoAsync(cacheDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
    }

    const url = `${API_BASE_URL}/calls/${encodeURIComponent(callId)}/download-recording`;
    const headers = await buildAuthenticatedHeaders();
    const result = await mtlsDownloadToFile(url, localPath, { headers });

    if (!result.ok) {
      await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
      throw new Error(`Failed to download recording audio: ${result.statusCode}`);
    }

    return result.uri ?? localPath;
  }
}

export const recordingService = new RecordingService();
