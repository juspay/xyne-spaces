/**
 * SDK SSO Authentication
 *
 * Device flow authentication for the Xyne Spaces SDK.
 * Alternative to API keys - allows users to authenticate via browser.
 *
 * @example
 * ```typescript
 * import { xyneSsoLogin, xyneSsoPoll, xyneSsoLoginAndWait } from '@xyne/spaces-sdk';
 *
 * // Option 1: Manual flow
 * const { deviceCode, userCode, verificationUrl } = await xyneSsoLogin();
 * console.log(`Visit ${verificationUrl} and enter code: ${userCode}`);
 *
 * // Poll for result
 * let result;
 * do {
 *   result = await xyneSsoPoll(deviceCode);
 *   if (result.status === 'pending') await new Promise(r => setTimeout(r, 2000));
 * } while (result.status === 'pending');
 *
 * if (result.status === 'approved') {
 *   // Use result.jwt as apiKey
 *   const client = createClient({ apiKey: result.jwt });
 * }
 *
 * // Option 2: Automatic flow (opens browser, waits for approval)
 * const { jwt } = await xyneSsoLoginAndWait();
 * const client = createClient({ apiKey: jwt });
 * ```
 */

/** Result of initiating the SSO device flow */
export interface SsoInitResult {
  /** Secret code for polling - keep this private */
  deviceCode: string;
  /** Human-readable code for user to enter */
  userCode: string;
  /** URL for user to visit */
  verificationUrl: string;
  /** URL with user code pre-filled */
  verificationUrlComplete: string;
  /** Seconds until the codes expire (default: 300) */
  expiresIn: number;
  /** Recommended polling interval in seconds (default: 2) */
  interval: number;
}

/** Result of polling for authorization */
export interface SsoPollResult {
  /** Current status of the authorization */
  status: 'pending' | 'approved' | 'denied' | 'expired';
  /** JWT token (only present when status is 'approved') */
  jwt?: string;
  /** Token expiration timestamp in milliseconds (only present when approved) */
  expiresAt?: number;
}

/** Options for initiating SSO login */
export interface SsoLoginOptions {
  /** Base URL of the Spaces API (default: 'https://spaces.xyne.app') */
  baseUrl?: string;
  /** Token validity in days (default: 1) */
  ttlDays?: 1;
}

/** Options for the automatic login flow */
export interface SsoLoginAndWaitOptions extends SsoLoginOptions {
  /** Maximum time to wait for approval in milliseconds (default: 300000 = 5 min) */
  timeoutMs?: number;
  /** Polling interval in milliseconds (default: 2000) */
  pollIntervalMs?: number;
  /** Called when the user code is generated - use to display instructions */
  onUserCode?: (userCode: string, verificationUrl: string, verificationUrlComplete: string) => void;
  /** Whether to automatically open the browser (default: false) */
  openBrowser?: boolean;
}

/** Error thrown when SSO authentication fails */
export class SsoAuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'denied' | 'expired' | 'timeout' | 'network_error'
  ) {
    super(message);
    this.name = 'SsoAuthError';
  }
}

const DEFAULT_BASE_URL = 'https://spaces.xyne.app';

/**
 * Initiate the SSO device authorization flow.
 *
 * Returns codes that the user must enter in a browser to authorize access.
 * The deviceCode is secret and used for polling; the userCode is shown to the user.
 *
 * @param options - Configuration options
 * @returns Device flow initialization result
 *
 * @example
 * ```typescript
 * const result = await xyneSsoLogin();
 * console.log(`Go to: ${result.verificationUrl}`);
 * console.log(`Enter code: ${result.userCode}`);
 * ```
 */
export async function xyneSsoLogin(options: SsoLoginOptions = {}): Promise<SsoInitResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const ttlDays = options.ttlDays ?? 1;

  const response = await fetch(`${baseUrl}/api/sdk/auth/sso/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttlDays: String(ttlDays) }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new SsoAuthError(
      (error as { message?: string }).message ?? 'Failed to initiate SSO login',
      'network_error'
    );
  }

  const data = (await response.json()) as {
    device_code: string;
    user_code: string;
    verification_url: string;
    verification_url_complete: string;
    expires_in: number;
    interval: number;
  };

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url,
    verificationUrlComplete: data.verification_url_complete,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

/**
 * Poll for the authorization result.
 *
 * Call this repeatedly until the status is 'approved', 'denied', or 'expired'.
 * Use the interval from the init result as the delay between polls.
 *
 * @param deviceCode - The device code from xyneSsoLogin
 * @param baseUrl - Base URL of the Spaces API (default: 'https://spaces.xyne.app')
 * @returns Current authorization status
 *
 * @example
 * ```typescript
 * let result;
 * do {
 *   result = await xyneSsoPoll(deviceCode);
 *   if (result.status === 'pending') {
 *     await new Promise(r => setTimeout(r, 2000));
 *   }
 * } while (result.status === 'pending');
 *
 * if (result.status === 'approved') {
 *   console.log('Token:', result.jwt);
 * }
 * ```
 */
export async function xyneSsoPoll(
  deviceCode: string,
  baseUrl: string = DEFAULT_BASE_URL
): Promise<SsoPollResult> {
  const response = await fetch(`${baseUrl}/api/sdk/auth/sso/poll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deviceCode }),
  });

  const data = (await response.json()) as {
    status?: string;
    error?: string;
    access_token?: string;
    expires_at?: number;
  };

  // Handle RFC 8628 error responses
  if (!response.ok) {
    switch (data.error) {
      case 'authorization_pending':
        return { status: 'pending' };
      case 'access_denied':
        return { status: 'denied' };
      case 'expired_token':
        return { status: 'expired' };
      default:
        throw new SsoAuthError(
          (data as { message?: string }).message ?? 'Failed to poll for authorization',
          'network_error'
        );
    }
  }

  // Success response
  return {
    status: 'approved',
    jwt: data.access_token,
    expiresAt: data.expires_at,
  };
}

/**
 * Convenience function: initiate SSO login and wait for approval.
 *
 * Combines xyneSsoLogin and xyneSsoPoll into a single call that blocks
 * until the user approves, denies, or the request times out.
 *
 * @param options - Configuration options
 * @returns The JWT token and expiration on success
 * @throws SsoAuthError if the user denies or the request times out
 *
 * @example
 * ```typescript
 * try {
 *   const { jwt, expiresAt } = await xyneSsoLoginAndWait({
 *     onUserCode: (code, url) => {
 *       console.log(`Visit ${url} and enter: ${code}`);
 *     },
 *   });
 *   const client = createClient({ apiKey: jwt });
 * } catch (err) {
 *   if (err instanceof SsoAuthError) {
 *     console.error(`Auth failed: ${err.code}`);
 *   }
 * }
 * ```
 */
export async function xyneSsoLoginAndWait(
  options: SsoLoginAndWaitOptions = {}
): Promise<{ jwt: string; expiresAt: number }> {
  const {
    baseUrl = DEFAULT_BASE_URL,
    ttlDays = 1,
    timeoutMs = 300000, // 5 minutes
    pollIntervalMs = 2000,
    onUserCode,
    openBrowser = false,
  } = options;

  // Initiate the flow
  const initResult = await xyneSsoLogin({ baseUrl, ttlDays });

  // Notify caller of the user code
  if (onUserCode) {
    onUserCode(initResult.userCode, initResult.verificationUrl, initResult.verificationUrlComplete);
  } else {
    // Default: print to console
    console.log(`\nTo authorize, visit: ${initResult.verificationUrlComplete}`);
    console.log(`Or go to ${initResult.verificationUrl} and enter code: ${initResult.userCode}\n`);
  }

  // Optionally open browser
  if (openBrowser) {
    try {
      await openUrl(initResult.verificationUrlComplete);
    } catch {
      // Ignore errors - user can still manually open the URL
    }
  }

  // Poll for result
  const deadline = Date.now() + timeoutMs;
  const pollInterval = Math.max(initResult.interval * 1000, pollIntervalMs);

  while (Date.now() < deadline) {
    const result = await xyneSsoPoll(initResult.deviceCode, baseUrl);

    switch (result.status) {
      case 'approved':
        return { jwt: result.jwt!, expiresAt: result.expiresAt! };
      case 'denied':
        throw new SsoAuthError('User denied the authorization request', 'denied');
      case 'expired':
        throw new SsoAuthError('The authorization request has expired', 'expired');
      case 'pending':
        // Continue polling
        break;
    }

    await sleep(pollInterval);
  }

  throw new SsoAuthError('Authorization timed out', 'timeout');
}

// Helper: sleep for a given number of milliseconds
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: open a URL in the default browser (works in Node.js)
async function openUrl(url: string): Promise<void> {
  // Dynamic import to avoid bundling issues in browser
  const { platform } = await import('os');
  const { spawn } = await import('child_process');

  const platformName = platform();
  let command: string;
  let args: string[];

  switch (platformName) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    case 'win32':
      command = 'cmd';
      args = ['/c', 'start', '', url];
      break;
    default:
      command = 'xdg-open';
      args = [url];
      break;
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'ignore', detached: true });
    proc.on('error', reject);
    proc.unref();
    resolve();
  });
}
