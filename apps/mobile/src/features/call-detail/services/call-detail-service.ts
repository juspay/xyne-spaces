// ---------------------------------------------------------------------------
// Call detail API layer. Mirrors the dashboard's callService / recordingService
// / tagsApi calls the call detail screen makes, over the mTLS api client.
// ---------------------------------------------------------------------------

import * as FileSystem from 'expo-file-system/legacy';

import { API_BASE_URL } from '@/src/config';
import { getAuthToken } from '@/src/contexts/AuthContext';
import { apiGet, apiPost, apiRequest } from '@/src/services/apiClient';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import { decodeBase64Bytes } from '@/src/utils/base64Utf8';
import { mtlsDownloadToFile, mtlsFetch } from '@/src/utils/mtlsHttpClient';
import { isApprovedTransportDestination } from '@/src/utils/mtlsTransportPolicy';

import type { CallRecordingSession, CallRecordingType } from '../utils/call-detail-format';

export type CallShareTarget = { type: 'user' | 'channel' | 'user_group'; id: string };

export interface TranscriptTranslation {
  status: 'pending' | 'ready';
  text?: string;
}

export interface CallGoogleDocLink {
  documentId?: string;
  url: string;
  title?: string;
  createdAt?: string;
}

export interface CallGoogleDocContext {
  canExport: boolean;
  summary: string | null;
  documents: CallGoogleDocLink[];
  unavailableReason?: string;
}

export interface ResolvedTag {
  id: string;
  tag: string;
  method: string;
}

interface YSweetClientToken {
  baseUrl?: string;
  token?: string;
  docId?: string;
}

const enc = encodeURIComponent;

async function authOptions(): Promise<{ token?: string }> {
  const token = await getAuthToken();
  return token ? { token } : {};
}

export const callDetailService = {
  /** Replace a call's labels; returns the resolved Tag ids to store. */
  async updateCallLabels(callId: string, labels: string[]): Promise<string[]> {
    const response = await apiRequest<{ labels?: string[] }>(`/calls/${enc(callId)}/labels`, {
      method: 'PATCH',
      body: { labels },
      ...(await authOptions()),
    });
    return Array.isArray(response.labels) ? response.labels : labels;
  },

  /** Bulk-resolve Tag ids (Call.labels entries) to their names. */
  async getTagsByIds(ids: string[]): Promise<ResolvedTag[]> {
    if (ids.length === 0) return [];
    const response = await apiGet<{ tags?: ResolvedTag[] }>(
      `/tags/by-ids?ids=${enc(ids.join(','))}`,
      await authOptions(),
    );
    return response.tags ?? [];
  },

  /** Keep an AI-suggested tag: flips its method to MANUAL in place (same id). */
  async confirmTag(tagId: string): Promise<void> {
    await apiRequest(`/tags/confirm`, {
      method: 'PATCH',
      body: { tagId },
      ...(await authOptions()),
    });
  },

  /** Rewrite the detailed summary with another template. Returns 202; the call row reports progress. */
  async regenerateSummary(callId: string, summaryTemplateId: string): Promise<void> {
    await apiPost(
      `/calls/${enc(callId)}/generate-summary`,
      { summaryTemplateId },
      await authOptions(),
    );
  },

  /** Share the call (and its summary) with users / channels; each target gets a posted card. */
  async grantCallAccess(
    callId: string,
    targets: CallShareTarget[],
    messageContent?: string,
  ): Promise<void> {
    const note = messageContent?.trim();
    await apiPost(
      `/calls/${enc(callId)}/sharing`,
      { action: 'grant', targets, ...(note ? { messageContent: note } : {}) },
      await authOptions(),
    );
  },

  /** Remove a target's access; the backend also deletes the card the share posted. */
  async revokeCallAccess(callId: string, targets: CallShareTarget[]): Promise<void> {
    await apiPost(
      `/calls/${enc(callId)}/sharing`,
      { action: 'revoke', targets },
      await authOptions(),
    );
  },

  async translateTranscript(callId: string, language: string): Promise<TranscriptTranslation> {
    return apiPost<TranscriptTranslation>(
      `/calls/${enc(callId)}/translate-transcript`,
      { language },
      await authOptions(),
    );
  },

  async listCallRecordings(callId: string): Promise<CallRecordingSession[]> {
    const response = await apiGet<{ recordings?: CallRecordingSession[] }>(
      `/calls/${enc(callId)}/recordings`,
      await authOptions(),
    );
    return response.recordings ?? [];
  },

  /** Download one recording session to the cache; returns the local file URI. */
  async downloadCallRecording(
    callId: string,
    recordingId: string,
    recordingType: CallRecordingType,
  ): Promise<string> {
    const extension = recordingType === 'AUDIO_ONLY' ? 'm4a' : 'mp4';
    const cacheDir = `${FileSystem.cacheDirectory}call-recordings`;
    const localPath = `${cacheDir}/${enc(callId)}-${enc(recordingId)}.${extension}`;

    const existing = await FileSystem.getInfoAsync(localPath);
    if (existing.exists && existing.size > 0) return localPath;

    const dirInfo = await FileSystem.getInfoAsync(cacheDir);
    if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });

    const url = `${API_BASE_URL}/calls/${enc(callId)}/recordings/${enc(recordingId)}/download`;
    const result = await mtlsDownloadToFile(url, localPath, {
      headers: await buildAuthenticatedHeaders(),
    });
    if (!result.ok) {
      await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
      throw new Error(`Failed to download recording: ${result.statusCode}`);
    }
    return result.uri ?? localPath;
  },

  async getGoogleDocContext(callId: string): Promise<CallGoogleDocContext> {
    const response = await apiGet<Partial<CallGoogleDocContext>>(
      `/calls/${enc(callId)}/google-doc-compose-context`,
      await authOptions(),
    );
    return {
      canExport: response.canExport === true,
      summary: response.summary ?? null,
      documents: Array.isArray(response.documents) ? response.documents : [],
      ...(response.unavailableReason ? { unavailableReason: response.unavailableReason } : {}),
    };
  },

  /** Returns the created doc's URL (or null when the API didn't hand one back). */
  async exportGoogleDoc(callId: string, title?: string): Promise<string | null> {
    const response = await apiPost<{ documentUrl?: string; document?: CallGoogleDocLink }>(
      `/calls/${enc(callId)}/export-google-doc`,
      title ? { title } : {},
      await authOptions(),
    );
    return response.documentUrl ?? response.document?.url ?? null;
  },

  /** Google OAuth URL that grants Docs access; the flow finishes in the browser. */
  async getGoogleDocConnectUrl(returnPath: string): Promise<string> {
    const response = await apiPost<{ authUrl: string }>(
      '/integrations/google/connect/recording-doc/init',
      { returnPath, platform: 'web' },
      await authOptions(),
    );
    return response.authUrl;
  },

  /**
   * A collaborative canvas's full Yjs state, straight from Y-Sweet: ask the API
   * for a read token, then GET `<baseUrl>/as-update` — the same two calls the
   * y-sweet SDK's `getAsUpdate()` makes. Returns null when Y-Sweet is not
   * reachable from the app's approved hosts.
   */
  async fetchCanvasYjsUpdate(canvasId: string): Promise<Uint8Array | null> {
    const clientToken = await apiPost<YSweetClientToken>(
      '/ysweet/auth',
      { docId: canvasId },
      await authOptions(),
    );
    const baseUrl = clientToken.baseUrl?.replace(/\/$/, '');
    if (!baseUrl || !isApprovedTransportDestination(baseUrl)) return null;

    const response = await mtlsFetch(
      `${baseUrl}/as-update?z=${Math.random().toString(36).slice(2)}`,
      {
        method: 'GET',
        headers: clientToken.token ? { Authorization: `Bearer ${clientToken.token}` } : {},
      },
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Y-Sweet responded with ${response.statusCode}`);
    }
    if (typeof response.body !== 'string' || response.isBase64 !== true) return null;
    return decodeBase64Bytes(response.body);
  },
};
