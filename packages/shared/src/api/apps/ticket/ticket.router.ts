import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsTicketBoardStages, appsTicketBoards, appsTicketListBySender } from './ticket.contracts.js';

/** `/apps/ticket`: ticket boards and tickets, for bots. Key order is the mount order. */
export const ticketRouter = defineRouter('/ticket', {
  boards: appsTicketBoards,
  boardStages: appsTicketBoardStages,
  listBySender: appsTicketListBySender,
});
