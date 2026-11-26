import { defineRouter } from '../../enc-contracts/api-route.js';
import { analyticsActiveChannels, analyticsActiveUsers, analyticsCurrentActiveUsers, analyticsFilesShared, analyticsMessagesExchanged, analyticsMessagesToday, analyticsNumberOfCalls, analyticsNumberOfCanvases, analyticsNumberOfTickets, analyticsTopUsersByMessages, analyticsTotalCallsDuration, analyticsUsersOnboarded } from './analytics.contracts.js';

/** `/analytics`: workspace analytics. Key order is the mount order. */
export const analyticsRouter = defineRouter('/analytics', {
  messagesExchanged: analyticsMessagesExchanged,
  activeUsers: analyticsActiveUsers,
  currentActiveUsers: analyticsCurrentActiveUsers,
  activeChannels: analyticsActiveChannels,
  filesShared: analyticsFilesShared,
  messagesToday: analyticsMessagesToday,
  numberOfTickets: analyticsNumberOfTickets,
  numberOfCanvases: analyticsNumberOfCanvases,
  numberOfCalls: analyticsNumberOfCalls,
  totalCallsDuration: analyticsTotalCallsDuration,
  usersOnboarded: analyticsUsersOnboarded,
  topUsersByMessages: analyticsTopUsersByMessages,
});
