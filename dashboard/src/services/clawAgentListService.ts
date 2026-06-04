/**
 * Service for fetching the list of claw agents accessible to the current user.
 * These are the agents shown in the global Agent Selector (sidebar + input box).
 */
import { apiInstance } from './clients/apiClient';

export interface AccessibleClawAgent {
  slug: string;
  name: string;
  color: string;
  description?: string;
  tools?: string[];
  skills?: string[];
  subagents?: string[];
}

export async function fetchAccessibleClawAgents(): Promise<AccessibleClawAgent[]> {
  const response = await apiInstance.get<{ success: boolean; data: AccessibleClawAgent[] }>(
    '/xyne-ai/agents',
  );
  const result = response.data;
  if (!result.success) {
    throw new Error('Failed to fetch agents');
  }
  return result.data;
}
