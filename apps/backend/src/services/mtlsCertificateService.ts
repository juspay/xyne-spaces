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
   * Revoke every active certificate issued to a user.
   *
   * Follows the same flow as the mTLS dashboard's manual revoke: list the user's
   * active device certificates, then revoke each device one by one via the mTLS
   * service's internal s2s endpoints.
   *
   * Best-effort: never throws so a certificate-service outage cannot block
   * account deactivation. Returns true only when every active device was revoked.
   */
  async revokeUserCertificates(userEmail: string): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.warn('[MTLS] Certificate service not configured; skipping certificate revocation', { userEmail });
      return false;
    }

    const email = encodeURIComponent(userEmail);

    try {
      const listResponse = await fetch(
        `${this.baseUrl}/api/internal/users/${email}/devices?status=active&limit=100`,
        {
          method: 'GET',
          headers: this.headers(),
          signal: AbortSignal.timeout(config.mtlsService.requestTimeoutMs),
        },
      );

      if (!listResponse.ok) {
        // 404 = user has never enrolled a device; nothing to revoke.
        if (listResponse.status === 404) {
          logger.info('[MTLS] No mTLS user/devices for deactivated user; nothing to revoke', { userEmail });
          return true;
        }
        logger.error('[MTLS] Failed to list device certificates', { userEmail, status: listResponse.status });
        return false;
      }

      const listBody = (await listResponse.json()) as {
        data?: Array<{ device_id: string; certificate?: { is_revoked?: boolean } }>;
      };
      const devices = (listBody.data ?? []).filter((d) => d.certificate && !d.certificate.is_revoked);

      if (devices.length === 0) {
        logger.info('[MTLS] No active certificates for deactivated user', { userEmail });
        return true;
      }

      let allRevoked = true;
      for (const device of devices) {
        const revokeResponse = await fetch(
          `${this.baseUrl}/api/internal/users/${email}/devices/${encodeURIComponent(device.device_id)}/revoke`,
          {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ reason: 'account_deactivated' }),
            signal: AbortSignal.timeout(config.mtlsService.requestTimeoutMs),
          },
        );

        if (!revokeResponse.ok) {
          allRevoked = false;
          logger.error('[MTLS] Failed to revoke device certificate', {
            userEmail,
            deviceId: device.device_id,
            status: revokeResponse.status,
          });
        }
      }

      logger.info('[MTLS] Certificate revocation completed for deactivated user', {
        userEmail,
        deviceCount: devices.length,
        allRevoked,
      });
      return allRevoked;
    } catch (error) {
      logger.error('[MTLS] Certificate revocation request errored', {
        userEmail,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

export const mtlsCertificateService = new MtlsCertificateService();
