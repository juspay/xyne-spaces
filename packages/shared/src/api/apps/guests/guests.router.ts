import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsGuestsCreate, appsGuestsGet, appsGuestsToken, appsGuestsUpdate } from './guests.contracts.js';

/** `/apps/guests`: an app's guest users and their SDK tokens. Key order is the mount order. */
export const guestsRouter = defineRouter('/guests', {
  create: appsGuestsCreate,
  get: appsGuestsGet,
  update: appsGuestsUpdate,
  token: appsGuestsToken,
});
