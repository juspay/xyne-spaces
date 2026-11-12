import { apiInstance } from '../clients/apiClient';

/** A Claw agent added to the current Spaces workspace. */
export interface ClawAgentPrincipal {
  id: string;
  clawAgentId: string;
  name: string;
  botUserId: string;
  status: 'ACTIVE' | 'DISABLED' | string;
}

/** Claw agents added to the current workspace (Spaces decides; one request for the whole list). */
export async function listWorkspaceClawAgents(): Promise<ClawAgentPrincipal[]> {
  const res = await apiInstance.get<{ success: boolean; principals: ClawAgentPrincipal[] }>('/claw-agents/principals');
  return res.data.principals ?? [];
}
