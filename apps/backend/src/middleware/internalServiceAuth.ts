import { createSecretHeaderAuth } from '@/middleware/secretHeaderAuth';
import { config } from '@/config/env';

/**
 * Authenticates internal service-to-service requests carrying the shared
 * INTERNAL_SERVICE_SECRET in X-Internal-Service-Secret.
 * @see createSecretHeaderAuth for the comparison and the unset-secret contract.
 */
export const internalServiceAuth = createSecretHeaderAuth({
  header: 'x-internal-service-secret',
  expectedSecret: config.internalServiceSecret,
  failureLogKey: 'internal_service_auth_failed',
});
