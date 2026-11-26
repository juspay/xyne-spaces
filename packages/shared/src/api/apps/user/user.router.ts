import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsUserInfo } from './user.contracts.js';

/** `/apps/user`: a user, for bots. Key order is the mount order. */
export const userRouter = defineRouter('/user', {
  info: appsUserInfo,
});
