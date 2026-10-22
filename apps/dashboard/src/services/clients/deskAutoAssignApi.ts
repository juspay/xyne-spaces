import { apiInstance } from './apiClient';

export interface AutoAssignUnassignedResponse {
  /**
   * `queued` — a sweep was started. `already_running` — one was already pending
   * for this desk and this request joined it rather than starting a second.
   */
  status: 'queued' | 'already_running';
}

/**
 * Queue an auto-assign sweep for the desk, limited to tickets created within the
 * given window. Both bounds are required by the API.
 */
export async function autoAssignUnassignedTickets(
  channelId: string,
  range: { from: Date; to: Date },
): Promise<AutoAssignUnassignedResponse> {
  const res = await apiInstance.post<AutoAssignUnassignedResponse>(
    `/channels/${channelId}/desk/auto-assign-unassigned`,
    { from: range.from.toISOString(), to: range.to.toISOString() },
  );
  return res.data;
}
