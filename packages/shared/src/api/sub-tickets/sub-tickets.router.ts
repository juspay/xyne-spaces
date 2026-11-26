import { defineRouter } from '../../enc-contracts/api-route.js';
import { subTicketsLink, subTicketsUnlink } from './sub-tickets.contracts.js';

/** `/sub-tickets`: linking a ticket under another. Key order is the mount order. */
export const subTicketsRouter = defineRouter('/sub-tickets', {
  link: subTicketsLink,
  unlink: subTicketsUnlink,
});
