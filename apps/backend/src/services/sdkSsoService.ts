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
 * The weakness of this flow is phishing (RFC 8628 §5.4): anyone can start a
 * request and send the approval link to someone else. The defence is the user
 * code — short enough to read, shown in the requester's terminal, and on the
 * consent page next to where the request came from — so the person approving
 * can check the request is their own.
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

/**
 * User-code alphabet: consonants only, per RFC 8628 §6.1 — no vowels (so no
 * words), and none of the easily confused 0/O, 1/I/L. Eight of the 19 give
 * 19^8 ≈ 1.7×10^10 codes, far beyond what can be guessed in 5 minutes.
 */
const USER_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ';
const USER_CODE_LENGTH = 8;

/** Longest user-agent kept for display on the consent page. */
const MAX_USER_AGENT_LENGTH = 300;

/**
 * Decide a pending request: compare-and-set on the device key. Only a request
 * still `pending` is replaced, keeping its remaining TTL, so of two approvers
 * racing on the same link exactly one wins. Returns 1 if this call decided it.
 */
const DECIDE_LUA = `
  local value = redis.call('GET', KEYS[1])
  if not value then return 0 end
  local ok, request = pcall(cjson.decode, value)
  if not ok or request.status ~= 'pending' then return 0 end
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl <= 0 then return 0 end
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
  return 1
`;

/**
 * Read a request for polling, deleting it in the same step once it is decided,
 * so two concurrent polls cannot both receive the session. A pending request is
 * left in place.
 */
const TAKE_LUA = `
  local value = redis.call('GET', KEYS[1])
  if not value then return nil end
  local ok, request = pcall(cjson.decode, value)
  if ok and request.status ~= 'pending' then redis.call('DEL', KEYS[1]) end
  return value
`;

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

/** Where a request was started from, shown on the consent page. */
export interface DeviceAuthOrigin {
  ip: string | null;
  userAgent: string | null;
}

/** Data stored for a device authorization request */
export interface DeviceAuthRequest {
  userCode: string;
  status: DeviceAuthStatus;
  createdAt: number;
  origin: DeviceAuthOrigin;
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

/**
 * `ABCD-EFGH` form of a user code, from anything a person might type or a URL
 * might carry: case and separators are ignored. Null if it cannot be one.
 */
export function normalizeUserCode(raw: string): string | null {
  const chars = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (chars.length !== USER_CODE_LENGTH || [...chars].some((c) => !USER_CODE_ALPHABET.includes(c))) {
    return null;
  }
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function generateUserCode(): string {
  const chars = Array.from(
    { length: USER_CODE_LENGTH },
    () => USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)],
  ).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
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
  async initiateDeviceFlow(baseUrl: string, origin: DeviceAuthOrigin): Promise<DeviceFlowInitResult> {
    const deviceCode = crypto.randomUUID();
    const deviceCodeHash = this.hashDeviceCode(deviceCode);

    // Claim a user code (user code → device code hash). The code space is
    // small enough that a live collision is possible, so claim with NX and
    // draw again rather than overwrite someone else's pending request.
    let userCode: string | null = null;
    for (let attempt = 0; attempt < 5 && !userCode; attempt++) {
      const candidate = generateUserCode();
      const claimed = await redisService.set(
        `${USER_CODE_KEY_PREFIX}${candidate}`,
        deviceCodeHash,
        DEVICE_AUTH_TTL_SECONDS,
        true
      );
      if (claimed) userCode = candidate;
    }
    if (!userCode) {
      throw new Error('Could not allocate an SDK SSO user code');
    }

    const authRequest: DeviceAuthRequest = {
      userCode,
      status: 'pending',
      createdAt: Date.now(),
      origin: {
        ip: origin.ip,
        userAgent: origin.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      },
    };

    // Store device auth request (keyed by device code hash)
    await redisService.set(
      `${DEVICE_KEY_PREFIX}${deviceCodeHash}`,
      JSON.stringify(authRequest),
      DEVICE_AUTH_TTL_SECONDS
    );

    // The consent URL is served by the backend and redirects to the dashboard
    const verificationUrl = `${baseUrl}/api/sdk/auth/sso/consent`;
    const verificationUrlComplete = `${verificationUrl}?user_code=${encodeURIComponent(userCode)}`;

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
  async getDeviceAuthByUserCode(rawUserCode: string): Promise<DeviceAuthRequest | null> {
    const userCode = normalizeUserCode(rawUserCode);
    if (!userCode) return null;
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
  async approveOrDeny(rawUserCode: string, session: SdkSsoSession | null): Promise<boolean> {
    const userCode = normalizeUserCode(rawUserCode);
    if (!userCode) return false;
    const deviceCodeHash = await redisService.get(`${USER_CODE_KEY_PREFIX}${userCode}`);
    if (!deviceCodeHash) {
      logger.warn(`[SDK-SSO] User code not found for approval: ${userCode}`);
      return false;
    }

    const request = await this.getDeviceAuthByUserCode(userCode);
    if (!request || request.status !== 'pending') {
      logger.warn(`[SDK-SSO] Device auth request missing or already processed: ${userCode}`);
      return false;
    }

    const decided: DeviceAuthRequest = session
      ? { ...request, status: 'approved', session }
      : { ...request, status: 'denied' };

    // The pending check above is advisory; this is the one that counts.
    const won = await redisService
      .getClient()
      .eval(DECIDE_LUA, 1, `${DEVICE_KEY_PREFIX}${deviceCodeHash}`, JSON.stringify(decided));
    if (won !== 1) {
      logger.warn(`[SDK-SSO] Device auth request was decided concurrently: ${userCode}`);
      return false;
    }

    logger.info(`[SDK-SSO] Device auth ${session ? 'approved' : 'denied'}`, {
      userCode,
      userId: session?.userId,
      workspaceId: session?.workspaceId,
    });

    return true;
  }

  /**
   * Poll for the authorization result.
   * A decided request is deleted in the same step it is read, so a session is
   * handed out once even to concurrent polls.
   */
  async pollForAuthorization(deviceCode: string): Promise<DeviceFlowPollResult> {
    const data = (await redisService
      .getClient()
      .eval(TAKE_LUA, 1, `${DEVICE_KEY_PREFIX}${this.hashDeviceCode(deviceCode)}`)) as string | null;

    if (!data) {
      // Key expired, never existed, or already collected
      return { status: 'expired' };
    }

    let authRequest: DeviceAuthRequest;
    try {
      authRequest = JSON.parse(data) as DeviceAuthRequest;
    } catch {
      logger.error(`[SDK-SSO] Failed to parse device auth request during poll`);
      return { status: 'expired' };
    }

    if (authRequest.status === 'pending') {
      return { status: 'pending' };
    }

    // The device key is gone; the user-code pointer now leads nowhere, so
    // removing it is housekeeping and need not be atomic with the take.
    await redisService.del(`${USER_CODE_KEY_PREFIX}${authRequest.userCode}`);

    return authRequest.status === 'approved'
      ? { status: 'approved', session: authRequest.session }
      : { status: 'denied' };
  }
}

export const sdkSsoService = new SdkSsoService();
