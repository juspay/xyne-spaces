import type {
  Message,
  PendingAction,
  PendingActionResolution,
} from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';
import { apiInstance } from '../clients/apiClient';
import { getPendingActionId, storePendingActionResolution } from './XyneAIPendingActionStore';
import { xyneAIStreamManager } from './XyneAIStreamManager';

export async function respondToPendingAction(
  message: Message,
  action: PendingAction,
  actionIndex: number,
  approved: boolean,
  fallbackAgentSlug = 'ask-ai',
): Promise<PendingActionResolution> {
  let sessionId = message.sessionId;
  // The message's own agent wins: a chat can switch agents mid-conversation,
  // so the thread's latest stream may belong to a different agent than the
  // one that proposed this action (and approving runs the proposer's tool).
  let agentSlug = message.agentSlug || fallbackAgentSlug;
  for (const state of xyneAIStreamManager.getAllActiveStreams().values()) {
    if (!state.messages.some(candidate => candidate.id === message.id)) continue;
    sessionId ||= state.sessionId;
    agentSlug = message.agentSlug || state.agentSlug || agentSlug;
    break;
  }
  if (!sessionId) throw new Error('Could not find sessionId for this message');

  const actionId = getPendingActionId(sessionId, message.id, action, actionIndex);
  await apiInstance.post('/xyne-ai/v2/action', {
    sessionId,
    agentSlug,
    actionId,
    approved,
    params: action.params,
    serverType: action.serverType,
    tool: action.tool,
    signature: action.signature,
  });

  const resolution = approved ? 'approved' : 'declined';
  storePendingActionResolution(actionId, resolution);
  xyneAIStreamManager.resolvePendingAction(message.id, actionIndex, resolution);
  return resolution;
}
