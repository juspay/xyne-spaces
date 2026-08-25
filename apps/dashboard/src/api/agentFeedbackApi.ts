import { apiInstance } from '../services/clients/apiClient';

/**
 * Agent-response feedback (no-DB, telemetry-only).
 *
 * Posts a 👍 / 👎 on an agent message. The backend does NOT persist this — it
 * resolves the agent name server-side and emits a structured `agent_feedback`
 * log line (VictoriaLogs, groupable by agentName). Because there is no row,
 * button state is kept in localStorage on the client and there is no server
 * dedupe — acceptable for an MVP signal.
 */
export type AgentFeedbackValue = 'like' | 'unlike';

export async function sendAgentFeedback(
  messageId: string,
  value: AgentFeedbackValue,
): Promise<void> {
  await apiInstance.post(`/messages/${messageId}/feedback`, { value });
}
