import { createSecretHeaderAuth } from '@/middleware/secretHeaderAuth';
import { config } from '@/config/env';

/**
 * Authenticates the user-deactivation endpoint only, via
 * USER_DEACTIVATION_SERVICE_SECRET in X-User-Deactivation-Secret.
 *
 * Deactivation revokes certificates, sessions and push tokens for an arbitrary
 * email, so it gets its own secret rather than the shared
 * INTERNAL_SERVICE_SECRET: every other internal caller holds that shared secret
 * and none of them should be able to log users out. It also lets this secret be
 * rotated without touching the rest of the internal surface.
 * @see createSecretHeaderAuth for the comparison and the unset-secret contract.
 */
export const userDeactivationAuth = createSecretHeaderAuth({
  header: 'x-user-deactivation-secret',
  expectedSecret: config.userDeactivationServiceSecret,
  failureLogKey: 'user_deactivation_auth_failed',
});
