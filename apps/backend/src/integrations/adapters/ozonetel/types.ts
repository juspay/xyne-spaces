export type TelephonyStatus = 'RINGING' | 'ANSWERED' | 'ENDED' | 'MISSED' | 'FAILED';

export type TelephonyDirection = 'INBOUND' | 'OUTBOUND';

export interface TelephonyEvent {
  externalId: string;
  status: TelephonyStatus;
  workspaceId: string;
  direction?: TelephonyDirection;
  agentUserId?: string;
  fromNumber?: string;
  toNumber?: string;
  recordingUrl?: string;
  startedAt?: Date;
  answeredAt?: Date;
  endedAt?: Date;
  talkTimeSec?: number;
  metadata?: Record<string, unknown>;
}

export interface OzonetelPreprocessedPayload {
  event: TelephonyEvent;
  channelId: string;
  creatorUserId?: string;
}
