import { config } from '@/config/env';
import { logger as baseLogger } from '@/utils/logger';

const logger = baseLogger.child({ module: 'MtlsCertificateService' });

/**
 * Service-to-service client for the mTLS certificate service.
 *
 * Authenticated with the shared internal-service secret sent as the
 * `X-Internal-Service-Secret` header — the same secret the mTLS service
 * validates via its internalServiceAuth middleware.
 */
class MtlsCertificateService {
  private isConfigured(): boolean {
    return !!config.mtlsService.url && !!config.mtlsService.s2sSecret;
  }

  private get baseUrl(): string {
    return config.mtlsService.url.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-internal-service-secret': config.mtlsService.s2sSecret,
    };
  }

  /**
   * Revoke every active certificate issued to a user, via the mTLS service's
   * single revoke-all endpoint. The mTLS service owns the definition of an
   * "active" certificate and the per-certificate fan-out, so this client never
   * duplicates cert-state policy or pages through device lists.
   *
   * Best-effort: never throws so a certificate-service outage cannot block
   * account deactivation. Returns true only when every active cert was revoked.
   */
  async revokeUserCertificates(userEmail: string): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.warn('[MTLS] Certificate service not configured; skipping certificate revocation');
      return false;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/internal/users/${encodeURIComponent(userEmail)}/certificates/revoke-all`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ reason: 'account_deactivated' }),
          signal: AbortSignal.timeout(config.mtlsService.requestTimeoutMs),
        },
      );

      if (!response.ok) {
        // 404 = user has never enrolled a device; nothing to revoke.
        if (response.status === 404) {
          logger.info('[MTLS] No mTLS user for deactivated user; nothing to revoke');
          return true;
        }
        logger.error('[MTLS] Certificate revoke-all failed', { status: response.status });
        return false;
      }

      const body = (await response.json()) as { total?: number; revoked?: number; failed?: number };
      const allRevoked = (body.failed ?? 0) === 0;
      logger.info('[MTLS] Certificate revocation completed for deactivated user', {
        total: body.total,
        revoked: body.revoked,
        failed: body.failed,
        allRevoked,
      });
      return allRevoked;
    } catch (error) {
      logger.error('[MTLS] Certificate revocation request errored', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

export const mtlsCertificateService = new MtlsCertificateService();
