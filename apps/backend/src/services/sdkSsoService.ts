/**
 * SDK SSO Service - Redis-based device flow for SDK authentication.
 *
 * Implements the OAuth 2.0 Device Authorization Grant (RFC 8628) pattern:
 * 1. SDK calls init → gets device_code + user_code
 * 2. User visits the verification URL, logs in, approves
 * 3. SDK polls with device_code → gets the user's session cookie when approved
 *
 * The session handed out is the same `xyne_ws_<workspaceId>_token` JWT the
 * dashboard runs on, so `/api/sdk` authenticates it with the ordinary
 * `authMiddleware` — there is no SDK-specific credential.
 *
 * All state is stored in Redis with a 5-minute TTL. No database tables.
 */

import crypto from 'crypto';
import { redisService } from './redisService';
import { logger } from '@/utils/logger';

/** TTL for device authorization requests (5 minutes) */
const DEVICE_AUTH_TTL_SECONDS = 300;

/** Prefix for device code keys */
const DEVICE_KEY_PREFIX = 'sdk:sso:device:';

/** Prefix for user code lookup keys */
const USER_CODE_KEY_PREFIX = 'sdk:sso:usercode:';

/** Status of a device authorization request */
export type DeviceAuthStatus = 'pending' | 'approved' | 'denied';

/** The session issued to the SDK on approval */
export interface SdkSsoSession {
  userId: string;
  workspaceId: string;
  /** Session JWT — the value of the `xyne_ws_<workspaceId>_token` cookie */
  token: string;
  /** When the token expires, in epoch milliseconds */
  expiresAt: number;
}

/** Data stored for a device authorization request */
export interface DeviceAuthRequest {
  userCode: string;
  status: DeviceAuthStatus;
  createdAt: number;
  /** Populated on approval */
  session?: SdkSsoSession;
}

/** Result of initiating device flow */
export interface DeviceFlowInitResult {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete: string;
  expiresIn: number;
  interval: number;
}

/** Result of polling for authorization */
export interface DeviceFlowPollResult {
  status: 'pending' | 'approved' | 'denied' | 'expired';
  session?: SdkSsoSession;
}

class SdkSsoService {
  /**
   * Hash a device code for storage (we store hash, return original to SDK)
   */
  private hashDeviceCode(deviceCode: string): string {
    return crypto.createHash('sha256').update(deviceCode).digest('hex');
  }

  /**
   * Initiate the device authorization flow.
   * Returns codes for the SDK to display to the user.
   */
  async initiateDeviceFlow(baseUrl: string): Promise<DeviceFlowInitResult> {
    const deviceCode = crypto.randomUUID();
    const deviceCodeHash = this.hashDeviceCode(deviceCode);
    const userCode = crypto.randomUUID();

    const authRequest: DeviceAuthRequest = {
      userCode,
      status: 'pending',
      createdAt: Date.now(),
    };

    // Store device auth request (keyed by device code hash)
    await redisService.set(
      `${DEVICE_KEY_PREFIX}${deviceCodeHash}`,
      JSON.stringify(authRequest),
      DEVICE_AUTH_TTL_SECONDS
    );

    // Store user code → device code hash mapping for reverse lookup
    await redisService.set(
      `${USER_CODE_KEY_PREFIX}${userCode}`,
      deviceCodeHash,
      DEVICE_AUTH_TTL_SECONDS
    );

    // The consent URL is served by the backend and redirects to the dashboard
    const verificationUrl = `${baseUrl}/api/sdk/auth/sso/consent`;
    const verificationUrlComplete = `${verificationUrl}?user_code=${userCode}`;

    logger.info(`[SDK-SSO] Device flow initiated`, {
      userCode,
      deviceCodePrefix: deviceCode.substring(0, 8),
    });

    return {
      deviceCode,
      userCode,
      verificationUrl,
      verificationUrlComplete,
      expiresIn: DEVICE_AUTH_TTL_SECONDS,
      interval: 2, // Poll every 2 seconds
    };
  }

  /**
   * Get a device authorization request by user code.
   * Used by the consent page to display request info.
   */
  async getDeviceAuthByUserCode(userCode: string): Promise<DeviceAuthRequest | null> {
    const deviceCodeHash = await redisService.get(`${USER_CODE_KEY_PREFIX}${userCode}`);
    if (!deviceCodeHash) {
      return null;
    }

    const data = await redisService.get(`${DEVICE_KEY_PREFIX}${deviceCodeHash}`);
    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as DeviceAuthRequest;
    } catch {
      logger.error(`[SDK-SSO] Failed to parse device auth request for user code: ${userCode}`);
      return null;
    }
  }

  /**
   * Approve (with the session to hand out) or deny a pending request.
   * Returns false if the request is missing, expired or already decided.
   */
  async approveOrDeny(userCode: string, session: SdkSsoSession | null): Promise<boolean> {
    const deviceCodeHash = await redisService.get(`${USER_CODE_KEY_PREFIX}${userCode}`);
    if (!deviceCodeHash) {
      logger.warn(`[SDK-SSO] User code not found for approval: ${userCode}`);
      return false;
    }

    const key = `${DEVICE_KEY_PREFIX}${deviceCodeHash}`;
    const data = await redisService.get(key);
    if (!data) {
      logger.warn(`[SDK-SSO] Device auth request not found for user code: ${userCode}`);
      return false;
    }

    let authRequest: DeviceAuthRequest;
    try {
      authRequest = JSON.parse(data) as DeviceAuthRequest;
    } catch {
      logger.error(`[SDK-SSO] Failed to parse device auth request for approval: ${userCode}`);
      return false;
    }

    if (authRequest.status !== 'pending') {
      logger.warn(`[SDK-SSO] Device auth request already processed: ${userCode}, status: ${authRequest.status}`);
      return false;
    }

    if (session) {
      authRequest.status = 'approved';
      authRequest.session = session;
    } else {
      authRequest.status = 'denied';
    }

    // Update the auth request, keeping its remaining TTL
    const ttl = await redisService.getClient().ttl(key);
    if (ttl <= 0) {
      return false;
    }
    await redisService.set(key, JSON.stringify(authRequest), ttl);

    logger.info(`[SDK-SSO] Device auth ${session ? 'approved' : 'denied'}`, {
      userCode,
      userId: session?.userId,
      workspaceId: session?.workspaceId,
    });

    return true;
  }

  /**
   * Poll for the authorization result.
   * A decided request is deleted once read, so a session is handed out once.
   */
  async pollForAuthorization(deviceCode: string): Promise<DeviceFlowPollResult> {
    const deviceCodeHash = this.hashDeviceCode(deviceCode);
    const data = await redisService.get(`${DEVICE_KEY_PREFIX}${deviceCodeHash}`);

    if (!data) {
      // Key expired or never existed
      return { status: 'expired' };
    }

    let authRequest: DeviceAuthRequest;
    try {
      authRequest = JSON.parse(data) as DeviceAuthRequest;
    } catch {
      logger.error(`[SDK-SSO] Failed to parse device auth request during poll`);
      return { status: 'expired' };
    }

    switch (authRequest.status) {
      case 'pending':
        return { status: 'pending' };

      case 'approved':
        await this.cleanup(deviceCodeHash, authRequest.userCode);
        return { status: 'approved', session: authRequest.session };

      case 'denied':
        await this.cleanup(deviceCodeHash, authRequest.userCode);
        return { status: 'denied' };

      default:
        return { status: 'expired' };
    }
  }

  /**
   * Clean up Redis keys after authorization is complete
   */
  private async cleanup(deviceCodeHash: string, userCode: string): Promise<void> {
    await redisService.del(`${DEVICE_KEY_PREFIX}${deviceCodeHash}`);
    await redisService.del(`${USER_CODE_KEY_PREFIX}${userCode}`);
    logger.info(`[SDK-SSO] Cleaned up device auth keys`, { userCode });
  }
}

export const sdkSsoService = new SdkSsoService();
