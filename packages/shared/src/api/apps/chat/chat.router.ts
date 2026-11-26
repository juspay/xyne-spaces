import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsChatAgentProgress, appsChatDeleteMessage, appsChatPostEphemeral, appsChatPostMessage, appsChatUpdateMessage } from './chat.contracts.js';

/** `/apps/chat`: the native chat API for bots. Key order is the mount order. */
export const chatRouter = defineRouter('/chat', {
  postMessage: appsChatPostMessage,
  postEphemeral: appsChatPostEphemeral,
  updateMessage: appsChatUpdateMessage,
  deleteMessage: appsChatDeleteMessage,
  agentProgress: appsChatAgentProgress,
});
