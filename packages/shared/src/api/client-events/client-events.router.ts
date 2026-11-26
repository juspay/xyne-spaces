import { defineRouter } from '../../enc-contracts/api-route.js';
import { clientEventsList, clientEventsMine, clientEventsPost, clientEventsRemove } from './client-events.contracts.js';

/** `/client-events`: commands pushed to users' browsers, and header overrides. Key order is the mount order. */
export const clientEventsRouter = defineRouter('/client-events', {
  mine: clientEventsMine,
  list: clientEventsList,
  post: clientEventsPost,
  remove: clientEventsRemove,
});
