import { apiInstance } from '../clients/apiClient';

export const RECORDING_EMAIL_ATTACHMENT_KINDS = [
  'transcript',
  'recording',
  'notes',
  'detailed-summary',
] as const;

export type RecordingEmailAttachmentKind = (typeof RECORDING_EMAIL_ATTACHMENT_KINDS)[number];

export interface RecordingEmailAttachment {
  kind: RecordingEmailAttachmentKind;
  label: string;
  filename: string;
  mimeType: string;
  detail: string;
}

export interface RecordingEmailComposeContext {
  from: {
    name: string;
    email: string;
  };
  canSend: boolean;
  channelId: string | null;
  unavailableReason?: string;
  attachments: RecordingEmailAttachment[];
}

export interface SendRecordingEmailInput {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachments: RecordingEmailAttachmentKind[];
}

export interface SendRecordingEmailResponse {
  success: boolean;
  messageId?: string;
  threadId?: string;
}

interface GoogleRecordingEmailConnectionResponse {
  authUrl: string;
}

class RecordingEmailService {
  async getComposeContext(callId: string): Promise<RecordingEmailComposeContext> {
    const response = await apiInstance.get<RecordingEmailComposeContext>(
      `/calls/recordings/${callId}/email-compose-context`,
    );
    return response.data;
  }

  async send(callId: string, input: SendRecordingEmailInput): Promise<SendRecordingEmailResponse> {
    const response = await apiInstance.post<SendRecordingEmailResponse>(
      `/calls/recordings/${callId}/send-email`,
      input,
    );
    return response.data;
  }

  async connectGoogle(returnPath: string, platform: 'electron' | 'web' = 'web'): Promise<string> {
    const response = await apiInstance.post<GoogleRecordingEmailConnectionResponse>(
      '/integrations/google/connect/recording-email/init',
      { returnPath, platform },
    );
    return response.data.authUrl;
  }
}

export const recordingEmailService = new RecordingEmailService();
