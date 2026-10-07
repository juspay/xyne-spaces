import { apiInstance } from './apiClient';

export interface AutoAssignUnassignedResponse {
  /**
   * `queued` — a sweep was started. `already_running` — one was already pending
   * for this desk and this request joined it rather than starting a second.
   */
  status: 'queued' | 'already_running';
}

export async function autoAssignUnassignedTickets(
  channelId: string,
): Promise<AutoAssignUnassignedResponse> {
  const res = await apiInstance.post<AutoAssignUnassignedResponse>(
    `/channels/${channelId}/desk/auto-assign-unassigned`,
  );
  return res.data;
}
