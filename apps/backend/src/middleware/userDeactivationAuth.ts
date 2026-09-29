import { createSecretHeaderAuth } from '@/middleware/secretHeaderAuth';

/**
 * Middleware for the user-deactivation endpoint only.
 *
 * Deactivation revokes certificates, sessions and push tokens for an arbitrary
 * email, so it gets its own secret (X-User-Deactivation-Secret /
 * USER_DEACTIVATION_SERVICE_SECRET) instead of the shared
 * INTERNAL_SERVICE_SECRET: every other internal caller holds that shared secret
 * and none of them should be able to log users out. The secret can also be
 * rotated without touching the rest of the internal surface.
 */
export const userDeactivationAuth = createSecretHeaderAuth({
  header: 'x-user-deactivation-secret',
  expectedSecret: () => process.env.USER_DEACTIVATION_SERVICE_SECRET,
  failureLogKey: 'user_deactivation_auth_failed',
});
