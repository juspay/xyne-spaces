/**
 * Claw authentication.
 *
 * Claw carries its own credential, separate from the Spaces access token. The two
 * cannot be shared: `/claw/api/v1` is served by a different service
 * (`apps/xyne-claw-auth`) whose verifier accepts only tokens prefixed
 * `xyne_cli_` / `xyne_svc_` and resolves them by hashed-row lookup in its own
 * database. A Spaces OAuth token is a stateless RS256 JWT — it fails that check
 * outright. So `setToken()` and `setClawToken()` are independent by necessity.
 *
 * Login runs the OAuth device flow (RFC 8628). The SDK must stay browser-safe and
 * dependency-free, so it never touches the filesystem and never opens a browser:
 * the verification URL and user code go to a caller-supplied `onPrompt`, and
 * persistence is delegated to an optional `ClawTokenStore`.
 */

import {
  CLAW_AUTH_START_PATH,
  CLAW_AUTH_TOKEN_PATH,
  CLAW_CLIENT_ID,
} from '../registry/claw.js';
import { SdkError, AuthError } from './errors.js';
import type { HttpClient } from './http.js';
import type { ClawDevicePrompt, ClawLoginResult } from '../types/index.js';

/**
 * Somewhere to keep the Claw token between processes.
 *
 * Deliberately tiny so any host can satisfy it — a file under `~/.xyne/agent` in
 * Node, `localStorage` in a browser. Every method may be async.
 */
export interface ClawTokenStore {
  get(): string | undefined | Promise<string | undefined>;
  set(token: string): void | Promise<void>;
  clear(): void | Promise<void>;
}

export interface ClawLoginOptions {
  /**
   * Called once with what the user has to see. Print it, open a browser, or
   * render it — the SDK cannot do any of those itself.
   */
  onPrompt?: (prompt: ClawDevicePrompt) => void | Promise<void>;
  /** Give up after this long. Defaults to the server's own expiry. */
  timeoutMs?: number;
  /** Abort a login in progress. */
  signal?: AbortSignal;
}

interface DeviceAuthStart {
  deviceCode: string;
  userCode: string;
  verifyUrl: string;
  expiresIn: number;
  interval: number;
}

function str(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function num(obj: Record<string, unknown>, fallback: number, ...keys: string[]): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClawAuth {
  /** Whether the store has been consulted. Only ever read once. */
  private loaded = false;

  constructor(
    private readonly http: HttpClient,
    private readonly store?: ClawTokenStore
  ) {}

  /**
   * Make sure a stored token is in play before an authenticated call.
   *
   * Reads the store at most once per client — a token cannot change underneath
   * us without going through `login()` or `logout()`.
   */
  async ensureToken(): Promise<void> {
    if (this.loaded || this.http.getToken() !== undefined) {
      this.loaded = true;
      return;
    }
    this.loaded = true;
    if (!this.store) return;

    const stored = await this.store.get();
    if (stored) this.http.setToken(stored);
  }

  getToken(): string | undefined {
    return this.http.getToken();
  }

  setToken(token: string): void {
    this.http.setToken(token);
    this.loaded = true;
  }

  /**
   * Run the device flow to completion and adopt the resulting token.
   *
   * Polls at the interval the server asks for, backing off by 5s whenever it
   * answers `slow_down`. `authorization_pending` (and a bare 202) mean "not yet",
   * not failure.
   */
  async login(options: ClawLoginOptions = {}): Promise<ClawLoginResult> {
    const start = await this.startDeviceAuth();

    if (options.onPrompt) {
      await options.onPrompt({
        verifyUrl: start.verifyUrl,
        userCode: start.userCode,
        expiresIn: start.expiresIn,
      });
    }

    const budgetMs =
      options.timeoutMs && options.timeoutMs > 0
        ? Math.min(options.timeoutMs, start.expiresIn * 1000)
        : start.expiresIn * 1000;
    const deadline = Date.now() + budgetMs;
    let intervalMs = Math.max(1, start.interval) * 1000;

    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw new SdkError('api_error', 'Claw login was cancelled.');
      }
      await sleep(intervalMs);

      const outcome = await this.pollDeviceToken(start.deviceCode);
      if (outcome === 'slow_down') {
        intervalMs += 5000;
        continue;
      }
      if (outcome === 'pending') continue;

      this.setToken(outcome.token);
      if (this.store) await this.store.set(outcome.token);
      return outcome;
    }

    throw new SdkError('timeout', 'Claw login timed out before it was authorized.');
  }

  /** Forget the Claw token, in memory and in the store. */
  async logout(): Promise<void> {
    this.http.clearToken();
    this.loaded = true;
    if (this.store) await this.store.clear();
  }

  private async startDeviceAuth(): Promise<DeviceAuthStart> {
    const raw = (await this.http.post<Record<string, unknown>>(CLAW_AUTH_START_PATH, {
      clientId: CLAW_CLIENT_ID,
    })) as Record<string, unknown>;

    const deviceCode = str(raw, 'deviceCode', 'device_code');
    const userCode = str(raw, 'userCode', 'user_code');
    const verifyUrl = str(raw, 'verifyUrl', 'verification_uri', 'verificationUri', 'verify_url');

    if (!deviceCode || !userCode || !verifyUrl) {
      throw new SdkError(
        'api_error',
        'Claw returned a malformed device-authorization response. ' +
          'The deployment may have CLI tokens disabled.'
      );
    }

    return {
      deviceCode,
      userCode,
      verifyUrl,
      expiresIn: num(raw, 600, 'expiresIn', 'expires_in'),
      interval: num(raw, 3, 'interval'),
    };
  }

  /**
   * One poll. Resolves to the token, or to why we should keep waiting.
   *
   * The pending states arrive as errors rather than success responses, so they
   * are translated here instead of escaping to the caller.
   */
  private async pollDeviceToken(
    deviceCode: string
  ): Promise<ClawLoginResult | 'pending' | 'slow_down'> {
    let raw: Record<string, unknown>;
    try {
      raw = (await this.http.post<Record<string, unknown>>(CLAW_AUTH_TOKEN_PATH, {
        deviceCode,
        clientId: CLAW_CLIENT_ID,
      })) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('slow_down')) return 'slow_down';
      if (message.includes('authorization_pending')) return 'pending';
      // A 401 here means "not authorized yet", not "bad credentials" — the whole
      // point of the flow is that authorization has not happened.
      if (err instanceof AuthError) return 'pending';
      throw err;
    }

    const token = str(raw, 'token', 'access_token');
    if (!token) return 'pending';

    const result: ClawLoginResult = { token };
    const userId = str(raw, 'userId', 'user_id');
    const email = str(raw, 'email');
    if (userId !== undefined) result.userId = userId;
    if (email !== undefined) result.email = email;
    return result;
  }
}
