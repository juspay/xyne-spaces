/**
 * Recording Service for Web Dashboard
 * Handles headless audio recording with LiveKit and backend API integration
 */

import { apiInstance } from '../clients/apiClient';
import { AxiosResponse } from 'axios';
import type { DefaultOutlet, GrantableEntityUserAccess, RecordingType } from '@xyne/shared';

export interface RecordingSession {
  /** Public Call ID used by the recording routes (same value as externalId). */
  callId: string;
  id: string;
  externalId: string;
  token: string;
  serverUrl: string;
  channelId: string | null;
  notesCanvasId: string;
  startTime: number;
}

export interface Recording {
  id: string;
  externalId: string;
  title: string;
  status?: 'SCHEDULED' | 'ACTIVE' | 'IN_PROGRESS' | 'ENDED' | 'CANCELLED';
  createdByUserId?: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  hasTranscript: boolean;
  hasSummary: boolean;
  hasRecording?: boolean;
  labels?: string[];
  markedItems?: unknown[];
  summaryTemplateId?: string | null;
}

export interface SummaryTemplate {
  id: string;
  workspaceId: string;
  name: string;
  autoTriggerPrompt: string | null;
  sections: unknown;
  version: number;
  systemPrompt: string;
  defaultOutlet: DefaultOutlet;
  createdBy: string;
  createdAt: string;
}

export interface RecordingUpdate {
  title?: string;
  labels?: string[];
  markedItems?: Record<string, unknown>[];
  summaryTemplateId?: string | null;
}

export interface RecordingTicketLinkState {
  linkedTicketId: string | null;
  linkedTicketMessageId: string | null;
}

export type RecordingShareTarget =
  | { type: 'user'; id: string }
  | { type: 'user_group'; id: string }
  | { type: 'channel'; id: string };

export interface RecordingSharingResult {
  action: 'grant' | 'revoke' | 'link_ticket' | 'unlink_ticket';
  linkedTicketId?: string | null;
  linkedTicketMessageId?: string | null;
  shares?: Array<{ id: string; target: RecordingShareTarget; access: string }>;
}

export type BuiltinRecordingSummaryTemplateId =
  | 'default'
  | 'product_sync'
  | 'customer_discovery'
  | 'one_on_one'
  | 'hiring'
  | 'standup'
  | 'sprint_review'
  | 'customer_feedback';

export interface RegenerateRecordingSummaryResult {
  summaryTemplateId: BuiltinRecordingSummaryTemplateId;
  detailedSummaryCanvasId: string | null;
}

export interface ExportRecordingGoogleDocResult {
  documentId: string;
  documentUrl: string;
}

export interface RecordingGoogleDocComposeContext {
  canExport: boolean;
  unavailableReason?: string;
  summary: string | null;
}

interface GoogleRecordingDocConnectionResponse {
  authUrl: string;
}

export interface BulkDeleteRecordingsResult {
  success: boolean;
  deleted: string[];
  failed: Array<{ callId: string; reason: string }>;
}

export interface CitationSegment {
  n: number;
  timestamp: string;
  speaker: string;
  speakerId?: string;
  snippet: string;
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
  notesCanvasId: string | null;
  detailedSummaryCanvasId: string | null;
  citationSegments: CitationSegment[];
  hasRecording?: boolean;
  linkedTicketId?: string | null;
  linkedTicketMessageId?: string | null;
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
  callId?: string;
  channelId: string | null;
  notesCanvasId: string;
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
        sttModel: params?.sttModel || 'google',
      },
    );

    const data: InitiateCallResponse = response.data;

    return {
      callId: data.callId ?? data.externalId,
      id: data.externalId,
      externalId: data.externalId,
      token: data.token,
      serverUrl: data.livekitUrl,
      channelId: data.channelId,
      notesCanvasId: data.notesCanvasId,
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
    await this.updateRecording(callId, { title });
  }

  async updateRecording(callId: string, update: RecordingUpdate): Promise<void> {
    await apiInstance.patch(`/calls/recordings/${callId}`, update);
  }

  async regenerateSummary(
    callId: string,
    summaryTemplateId: BuiltinRecordingSummaryTemplateId,
  ): Promise<RegenerateRecordingSummaryResult> {
    const response: AxiosResponse<{ success: true } & RegenerateRecordingSummaryResult> =
      await apiInstance.post(`/calls/recordings/${callId}/generate-summary`, {
        summaryTemplateId,
      });
    return response.data;
  }

  async exportGoogleDoc(callId: string): Promise<ExportRecordingGoogleDocResult> {
    const response = await apiInstance.post<{ success: true } & ExportRecordingGoogleDocResult>(
      `/calls/recordings/${callId}/export-google-doc`,
    );
    return response.data;
  }

  async getGoogleDocComposeContext(callId: string): Promise<RecordingGoogleDocComposeContext> {
    const response = await apiInstance.get<{ success: true } & RecordingGoogleDocComposeContext>(
      `/calls/recordings/${callId}/google-doc-compose-context`,
    );
    return response.data;
  }

  async connectGoogleDoc(
    returnPath: string,
    platform: 'electron' | 'web' = 'web',
  ): Promise<string> {
    const response = await apiInstance.post<GoogleRecordingDocConnectionResponse>(
      '/integrations/google/connect/recording-doc/init',
      { returnPath, platform },
    );
    return response.data.authUrl;
  }

  async grantRecordingAccess(
    callId: string,
    targets: RecordingShareTarget[],
    access?: GrantableEntityUserAccess,
  ): Promise<RecordingSharingResult> {
    const response: AxiosResponse<{ success: true } & RecordingSharingResult> =
      await apiInstance.post(`/calls/recordings/${callId}/sharing`, {
        action: 'grant',
        targets,
        ...(access ? { access } : {}),
      });
    return response.data;
  }

  async revokeRecordingAccess(
    callId: string,
    targets: RecordingShareTarget[],
  ): Promise<RecordingSharingResult> {
    const response: AxiosResponse<{ success: true } & RecordingSharingResult> =
      await apiInstance.post(`/calls/recordings/${callId}/sharing`, {
        action: 'revoke',
        targets,
      });
    return response.data;
  }

  async linkRecordingToTicket(callId: string, ticketId: string): Promise<RecordingTicketLinkState> {
    const response: AxiosResponse<
      { success: true } & RecordingSharingResult & RecordingTicketLinkState
    > = await apiInstance.post(`/calls/recordings/${callId}/sharing`, {
      action: 'link_ticket',
      ticketId,
    });
    return {
      linkedTicketId: response.data.linkedTicketId,
      linkedTicketMessageId: response.data.linkedTicketMessageId,
    };
  }

  async unlinkRecordingFromTicket(callId: string): Promise<RecordingTicketLinkState> {
    const response: AxiosResponse<
      { success: true } & RecordingSharingResult & RecordingTicketLinkState
    > = await apiInstance.post(`/calls/recordings/${callId}/sharing`, {
      action: 'unlink_ticket',
    });
    return {
      linkedTicketId: response.data.linkedTicketId,
      linkedTicketMessageId: response.data.linkedTicketMessageId,
    };
  }

  async getSummaryTemplates(): Promise<SummaryTemplate[]> {
    const response: AxiosResponse<{ success: boolean; templates: SummaryTemplate[] }> =
      await apiInstance.get('/calls/summary-templates');
    return response.data.templates;
  }

  async createSummaryTemplate(
    input: Omit<SummaryTemplate, 'id' | 'workspaceId' | 'createdBy' | 'createdAt'>,
  ): Promise<SummaryTemplate> {
    const response: AxiosResponse<{ success: boolean; template: SummaryTemplate }> =
      await apiInstance.post('/calls/summary-templates', input);
    return response.data.template;
  }

  async updateSummaryTemplate(
    templateId: string,
    update: Partial<Omit<SummaryTemplate, 'id' | 'workspaceId' | 'createdBy' | 'createdAt'>>,
  ): Promise<SummaryTemplate> {
    const response: AxiosResponse<{ success: boolean; template: SummaryTemplate }> =
      await apiInstance.patch(`/calls/summary-templates/${templateId}`, update);
    return response.data.template;
  }

  /**
   * Delete a recording
   */
  async deleteRecording(callId: string): Promise<void> {
    await apiInstance.delete(`/calls/recordings/${callId}`);
  }

  /**
   * Delete multiple recordings in a single request.
   */
  async bulkDeleteRecordings(callIds: string[]): Promise<BulkDeleteRecordingsResult> {
    const response: AxiosResponse<BulkDeleteRecordingsResult> = await apiInstance.post(
      '/calls/recordings/bulk-delete',
      { callIds },
    );
    return response.data;
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
