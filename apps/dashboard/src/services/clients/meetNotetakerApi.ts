import { apiInstance } from './apiClient';

export type MeetBotStatus = 'requested' | 'joining' | 'waiting_room' | 'in_call' | 'ended' | 'failed';

export interface MeetNotetakerCall {
  callId: string;
  externalId: string;
  status: string;
  title: string | null;
  meetingUrl: string | null;
  meetBot: { status: MeetBotStatus; reason?: string; meetingCode: string } | null;
}

export async function getMeetNotetakerAvailability(): Promise<boolean> {
  const response = await apiInstance.get<{ enabled: boolean }>('/calls/meet-notetaker/availability');
  return !!response.data.enabled;
}

export interface SendMeetNotetakerResult {
  call: MeetNotetakerCall;
  /** Set when the bot was already in (or on its way to) this Meet: nothing new was sent. */
  alreadySentBy: { userId: string; name: string | null; isYou: boolean } | null;
}

export async function sendMeetNotetaker(meetingUrl: string): Promise<SendMeetNotetakerResult> {
  const response = await apiInstance.post<SendMeetNotetakerResult>('/calls/meet-notetaker', {
    meetingUrl,
  });
  return { call: response.data.call, alreadySentBy: response.data.alreadySentBy ?? null };
}

export async function stopMeetNotetaker(callExternalId: string): Promise<void> {
  await apiInstance.delete(`/calls/meet-notetaker/${encodeURIComponent(callExternalId)}`);
}

/** The backend's `{ error }` message when there is one. */
export function meetNotetakerErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data;
  return typeof data?.error === 'string' && data.error.trim() ? data.error : fallback;
}
