import { createSecretHeaderAuth } from '@/middleware/secretHeaderAuth';

/**
 * Middleware to authenticate internal service-to-service requests.
 * Validates X-Internal-Service-Secret header against INTERNAL_SERVICE_SECRET env var.
 * Uses crypto.timingSafeEqual for constant-time comparison to prevent timing attacks.
 */
export const internalServiceAuth = createSecretHeaderAuth({
  header: 'x-internal-service-secret',
  expectedSecret: () => process.env.INTERNAL_SERVICE_SECRET,
  failureLogKey: 'internal_service_auth_failed',
});
