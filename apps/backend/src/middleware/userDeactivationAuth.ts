import { createSecretHeaderAuth } from '@/middleware/secretHeaderAuth';
import { config } from '@/config/env';

/**
 * Authenticates the user-deactivation endpoint only. Uses the standard
 * X-Internal-Service-Secret header, but validates it against
 * USER_DEACTIVATION_SERVICE_SECRET rather than the shared
 * INTERNAL_SERVICE_SECRET.
 *
 * Deactivation revokes certificates, sessions and push tokens for an arbitrary
 * email, so it gets its own secret: every other internal caller holds the
 * shared secret and none of them should be able to log users out. It also lets
 * this secret be rotated without touching the rest of the internal surface.
 * @see createSecretHeaderAuth for the comparison and the unset-secret contract.
 */
export const userDeactivationAuth = createSecretHeaderAuth({
  header: 'x-internal-service-secret',
  expectedSecret: config.userDeactivationServiceSecret,
  failureLogKey: 'user_deactivation_auth_failed',
});
