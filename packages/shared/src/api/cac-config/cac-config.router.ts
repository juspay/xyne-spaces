import { defineRouter } from '../../enc-contracts/api-route.js';
import { cacConfigGet } from './cac-config.contracts.js';

/** `/cac-config`: a config value for the caller. Key order is the mount order. */
export const cacConfigRouter = defineRouter('/cac-config', {
  get: cacConfigGet,
});
