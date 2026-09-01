import { apiInstance } from './clients/apiClient';

export type InviteExperience = 'DESKTOP' | 'BROWSER';

export interface UpdateInviteExperienceResponse {
  workspaceId: string;
  inviteExperience: InviteExperience;
}

export const workspaceSettingsApi = {
  updateInviteExperience: async (
    workspaceId: string,
    inviteExperience: InviteExperience,
  ): Promise<UpdateInviteExperienceResponse> => {
    const response = await apiInstance.patch<UpdateInviteExperienceResponse>(
      `/workspaces/${workspaceId}/invite-experience`,
      { inviteExperience },
    );
    return response.data;
  },
};
