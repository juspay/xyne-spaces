import { AxiosError } from 'axios';
import type { CallStatus, CallType, RecurringCallSeriesStatus } from '@xyne/shared';
import { apiInstance } from '../clients/apiClient';

// ============================================================================
// TYPES — mirror apps/backend/src/services/callAdminService.ts
// ============================================================================

export type CallAdminScope = 'ORG' | 'SELF';
export type CallAdminListScope = 'mine' | 'all';
export type CallAdminRelation = 'ADMIN' | 'CREATOR' | 'PARTICIPANT' | 'NONE';
export type CallAdminAction =
  | 'cancel'
  | 'forceEnd'
  | 'unlinkTranscript'
  | 'regenerateSummary'
  | 'reprocessTranscript'
  | 'changeOwner';
export type CallAdminSummaryStatus = 'pending' | 'ready' | 'failed';

export interface CallAdminUser {
  id: string;
  name: string | null;
  email: string | null;
}

export interface CallAdminCallRow {
  id: string;
  externalId: string;
  title: string | null;
  type: CallType;
  origin: string;
  status: CallStatus;
  owner: CallAdminUser;
  startedAt: string;
  endedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  recurringSeriesId: string | null;
  hasTranscript: boolean;
  transcriptUnlinked: boolean;
  summaryStatus: CallAdminSummaryStatus | null;
  relation: CallAdminRelation;
  allowedActions: CallAdminAction[];
}

export interface CallAdminSeriesRow {
  id: string;
  title: string;
  status: RecurringCallSeriesStatus;
  organizer: CallAdminUser;
  recurrenceRule: string;
  timezone: string;
  startTime: string;
  endTime: string;
  startsOn: string;
  endsOn: string | null;
  nextInstance: { externalId: string; startsAt: string | null } | null;
  relation: CallAdminRelation;
  allowedActions: CallAdminAction[];
}

export interface CallAdminPage<Row> {
  scope: CallAdminScope;
  rows: Row[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CallAdminCallFilters {
  scope: CallAdminListScope;
  /** Comma-separated CallStatus values. */
  status?: string;
  type?: string;
  ownerId?: string;
  search?: string;
  /** Comma-separated pending | ready | failed. */
  summaryStatus?: string;
  hasTranscript?: boolean;
  cursor?: string;
}

export interface CallAdminSeriesFilters {
  scope: CallAdminListScope;
  status?: string;
  search?: string;
  cursor?: string;
}

export interface ChangeOwnerResult {
  transferredCallIds: string[];
  warning: string | null;
}

/** Body of the 409 force-end returns while the LiveKit room is still up. */
interface RoomStillLiveBody {
  roomExists?: boolean;
  numParticipants?: number;
}

const PAGE_SIZE = 50;

// ============================================================================
// API
// ============================================================================

export async function listAdminCalls(
  filters: CallAdminCallFilters,
): Promise<CallAdminPage<CallAdminCallRow>> {
  const response = await apiInstance.get<CallAdminPage<CallAdminCallRow>>('/calls/admin/calls', {
    params: { limit: PAGE_SIZE, ...filters },
  });
  return response.data;
}

export async function listAdminSeries(
  filters: CallAdminSeriesFilters,
): Promise<CallAdminPage<CallAdminSeriesRow>> {
  const response = await apiInstance.get<CallAdminPage<CallAdminSeriesRow>>('/calls/admin/series', {
    params: { limit: PAGE_SIZE, ...filters },
  });
  return response.data;
}

export async function cancelAdminSeries(seriesId: string): Promise<{ cancelledCalls: number }> {
  const response = await apiInstance.post<{ cancelledCalls: number }>(
    `/calls/admin/series/${seriesId}/cancel`,
  );
  return response.data;
}

export async function cancelAdminCall(externalId: string): Promise<void> {
  await apiInstance.post(`/calls/admin/calls/${externalId}/cancel`);
}

export async function forceEndAdminCall(externalId: string): Promise<void> {
  await apiInstance.post(`/calls/admin/calls/${externalId}/force-end`);
}

export async function unlinkAdminTranscript(externalId: string): Promise<void> {
  await apiInstance.post(`/calls/admin/calls/${externalId}/unlink-transcript`);
}

export async function reprocessAdminTranscript(externalId: string): Promise<void> {
  await apiInstance.post(`/calls/admin/calls/${externalId}/reprocess-transcript`);
}

export async function regenerateAdminSummary(externalId: string): Promise<void> {
  await apiInstance.post(`/calls/admin/calls/${externalId}/regenerate-summary`, {});
}

export async function changeAdminCallOwner(
  externalId: string,
  body: { newOwnerUserId: string; applyToSeries: boolean },
): Promise<ChangeOwnerResult> {
  const response = await apiInstance.post<ChangeOwnerResult>(
    `/calls/admin/calls/${externalId}/owner`,
    body,
  );
  return response.data;
}

// ============================================================================
// ERRORS
// ============================================================================

export function callAdminErrorText(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const message = (error.response?.data as { error?: unknown } | undefined)?.error;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/** Participant count when force-end was refused because the room is still live, else null. */
export function roomStillLiveParticipants(error: unknown): number | null {
  if (!(error instanceof AxiosError) || error.response?.status !== 409) return null;
  const body = error.response.data as RoomStillLiveBody | undefined;
  return body?.roomExists ? (body.numParticipants ?? 0) : null;
}
