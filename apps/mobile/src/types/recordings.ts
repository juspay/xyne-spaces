// ---------------------------------------------------------------------------
// Recording domain types
// Mirrors the dashboard's RecordingService types, adapted for React Native.
// ---------------------------------------------------------------------------

export interface RecordingSession {
  id: string;
  externalId: string;
  token: string;
  serverUrl: string;
  channelId: string;
  startTime: number;
}

export type RecordingType = 'AUDIO_ONLY' | 'AUDIO_SCREEN' | 'AUDIO_VIDEO';

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
  recordingType?: RecordingType | null;
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
}

export interface TranscriptEntry {
  id: number;
  speaker: string;
  text: string;
  timestamp: number;
  participantIdentity: string;
  spokenAt: number;
}

export type ShareTargetType = 'user' | 'channel' | 'user_group';

export type ShareTarget = {
  type: ShareTargetType;
  id: string;
};

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';

export type SttModel = 'google' | 'azure' | 'deepgram';

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface InitiateCallResponse {
  token: string;
  livekitUrl: string;
  externalId: string;
  channelId: string;
}

export interface RecordingsResponse {
  success: boolean;
  recordings: Recording[];
}

export interface RecordingDetailResponse {
  success: boolean;
  recording: RecordingDetail;
}
