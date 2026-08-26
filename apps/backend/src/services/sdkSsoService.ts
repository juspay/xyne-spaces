/**
 * SDK SSO Service - Redis-based device flow for SDK authentication.
 *
 * Implements OAuth 2.0 Device Authorization Grant (RFC 8628) pattern:
 * 1. SDK calls init → gets device_code + user_code
 * 2. User visits verification URL, logs in, approves
 * 3. SDK polls with device_code → gets JWT when approved
 *
 * All state is stored in Redis with 5-minute TTL. No database tables.
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

/** Data stored for a device authorization request */
export interface DeviceAuthRequest {
  userCode: string;
  status: DeviceAuthStatus;
  createdAt: number;
  ttlDays: 1;
  // Populated on approval:
  userId?: string;
  workspaceId?: string;
  memberId?: string;
  orgId?: string;
  email?: string;
  name?: string;
  displayName?: string;
  jwt?: string;
  jwtExpiresAt?: number;
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
  jwt?: string;
  expiresAt?: number;
}

/** User info for approval */
export interface ApprovalUserInfo {
  userId: string;
  workspaceId: string;
  memberId: string;
  orgId: string;
  email: string;
  name: string;
  displayName?: string;
}

class SdkSsoService {
  /**
   * Generate a UUID for the user code
   */
  private generateUserCode(): string {
    return crypto.randomUUID();
  }

  /**
   * Generate a UUID for the device code
   */
  private generateDeviceCode(): string {
    return crypto.randomUUID();
  }

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
  async initiateDeviceFlow(
    baseUrl: string,
    ttlDays: 1 = 1
  ): Promise<DeviceFlowInitResult> {
    const deviceCode = this.generateDeviceCode();
    const deviceCodeHash = this.hashDeviceCode(deviceCode);
    const userCode = this.generateUserCode();

    const authRequest: DeviceAuthRequest = {
      userCode,
      status: 'pending',
      createdAt: Date.now(),
      ttlDays,
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

    // The consent page is served by the backend at /api/sdk/auth/sso/consent
    const verificationUrl = `${baseUrl}/api/sdk/auth/sso/consent`;
    const verificationUrlComplete = `${baseUrl}/api/sdk/auth/sso/consent?user_code=${userCode}`;

    logger.info(`[SDK-SSO] Device flow initiated`, {
      userCode,
      deviceCodePrefix: deviceCode.substring(0, 8),
      ttlDays,
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
   * Get the status of a device authorization by user code.
   * Used by the frontend consent page to display request info.
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
   * Approve or deny a device authorization request.
   * Called by the frontend after user consents.
   */
  async approveOrDeny(
    userCode: string,
    approved: boolean,
    userInfo?: ApprovalUserInfo,
    jwt?: string,
    jwtExpiresAt?: number
  ): Promise<boolean> {
    const deviceCodeHash = await redisService.get(`${USER_CODE_KEY_PREFIX}${userCode}`);
    if (!deviceCodeHash) {
      logger.warn(`[SDK-SSO] User code not found for approval: ${userCode}`);
      return false;
    }

    const data = await redisService.get(`${DEVICE_KEY_PREFIX}${deviceCodeHash}`);
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

    if (approved && userInfo && jwt) {
      authRequest.status = 'approved';
      authRequest.userId = userInfo.userId;
      authRequest.workspaceId = userInfo.workspaceId;
      authRequest.memberId = userInfo.memberId;
      authRequest.orgId = userInfo.orgId;
      authRequest.email = userInfo.email;
      authRequest.name = userInfo.name;
      authRequest.displayName = userInfo.displayName;
      authRequest.jwt = jwt;
      authRequest.jwtExpiresAt = jwtExpiresAt;
    } else {
      authRequest.status = 'denied';
    }

    // Update the auth request (keep remaining TTL)
    const client = redisService.getClient();
    const ttl = await client.ttl(`${DEVICE_KEY_PREFIX}${deviceCodeHash}`);
    if (ttl > 0) {
      await redisService.set(
        `${DEVICE_KEY_PREFIX}${deviceCodeHash}`,
        JSON.stringify(authRequest),
        ttl
      );
    }

    logger.info(`[SDK-SSO] Device auth ${approved ? 'approved' : 'denied'}`, {
      userCode,
      userId: userInfo?.userId,
      workspaceId: userInfo?.workspaceId,
    });

    return true;
  }

  /**
   * Poll for authorization result.
   * Called by the SDK to check if user has approved/denied.
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
        // Clean up after successful retrieval
        await this.cleanup(deviceCode, authRequest.userCode);
        return {
          status: 'approved',
          jwt: authRequest.jwt,
          expiresAt: authRequest.jwtExpiresAt,
        };

      case 'denied':
        // Clean up after denial
        await this.cleanup(deviceCode, authRequest.userCode);
        return { status: 'denied' };

      default:
        return { status: 'expired' };
    }
  }

  /**
   * Clean up Redis keys after authorization is complete
   */
  private async cleanup(deviceCode: string, userCode: string): Promise<void> {
    const deviceCodeHash = this.hashDeviceCode(deviceCode);
    await redisService.del(`${DEVICE_KEY_PREFIX}${deviceCodeHash}`);
    await redisService.del(`${USER_CODE_KEY_PREFIX}${userCode}`);
    logger.info(`[SDK-SSO] Cleaned up device auth keys`, { userCode });
  }
}

export const sdkSsoService = new SdkSsoService();
