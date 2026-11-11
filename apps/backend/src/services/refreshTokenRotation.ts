import { redisService } from '@/services/redisService';
import { logger as baseLogger } from '@/utils/logger';

const logger = baseLogger.child({ module: 'RefreshTokenRotation' });

/**
 * Single-use refresh tokens.
 *
 * Every refresh replaces the presented token with a new one (compare-and-set on the
 * session row), so a token stolen once stops working as soon as either party refreshes.
 * Two Redis records per rotated token make this safe and detectable:
 *
 *  - `<prefix>rotated:<hash>`  for `graceSeconds`: what the token was rotated to. Clients
 *    sharing one cookie jar (tabs, Electron main process) that refresh at the same moment
 *    all receive the same replacement. Two refreshes racing on the same token are settled
 *    by SET NX on this key: one rotates, the other waits for its result.
 *  - `<prefix>spent:<hash>`    until the session expires: which session the token belonged
 *    to. A spent token presented after the grace window means two parties hold it; the
 *    caller revokes that session so both must sign in again.
 *
 * Redis errors before the token is replaced propagate so the caller can decide (the
 * browser path fails open); errors after it are logged, since the replacement is already
 * the only valid token.
 */

/** What rotation needs to know about the session a token resolved to. */
export interface RotatableSession {
  id: string;
  refreshTokenExpiry: Date;
}

export type RotationResult<T> =
  /** This call replaced the token; `value` is what the client must receive. */
  | { status: 'rotated'; value: T }
  /** A concurrent call replaced the token within the grace window; `value` is what it handed out. */
  | { status: 'replayed'; value: T }
  /** The token was replaced longer ago than the grace window and is being presented again. */
  | { status: 'reused'; sessionId: string }
  /** Unknown, expired or revoked. */
  | { status: 'invalid' }
  /** A concurrent rotation of the same token did not finish in time; the client may retry. */
  | { status: 'busy' };

export interface RotationSteps<S extends RotatableSession, T> {
  /** The active, unexpired session the presented token belongs to, or null. */
  lookup: () => Promise<S | null>;
  /**
   * Replace the token in storage (compare-and-set) and build what the client receives.
   * Null when the session no longer qualifies or another rotation got there first.
   */
  commit: (session: S) => Promise<T | null>;
}

export interface RefreshTokenRotatorOptions {
  /** Redis key namespace, e.g. `auth:xs:`. */
  keyPrefix: string;
  /** How long the old token still answers with its replacement. */
  graceSeconds: number;
  /** How long a refresh waits for a concurrent one on the same token. */
  waitMs?: number;
  pollMs?: number;
}

const DEFAULT_WAIT_MS = 5_000;
const DEFAULT_POLL_MS = 100;

interface RotatedRecord<T> {
  pending?: boolean;
  value?: T;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export class RefreshTokenRotator<T> {
  private readonly keyPrefix: string;
  private readonly graceSeconds: number;
  private readonly waitMs: number;
  private readonly pollMs: number;

  constructor(options: RefreshTokenRotatorOptions) {
    this.keyPrefix = options.keyPrefix;
    this.graceSeconds = options.graceSeconds;
    this.waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  }

  private rotatedKey(tokenHash: string): string {
    return `${this.keyPrefix}rotated:${tokenHash}`;
  }

  private spentKey(tokenHash: string): string {
    return `${this.keyPrefix}spent:${tokenHash}`;
  }

  /** Rotate the token `tokenHash` identifies. See the module doc for the protocol. */
  async rotate<S extends RotatableSession>(tokenHash: string, steps: RotationSteps<S, T>): Promise<RotationResult<T>> {
    const rotatedKey = this.rotatedKey(tokenHash);

    const settled = await this.awaitRotation(rotatedKey);
    if (settled) return settled;

    const session = await steps.lookup();
    if (!session) {
      // A concurrent rotation may have claimed the token between the first check and the lookup.
      const late = await this.awaitRotation(rotatedKey);
      if (late) return late;

      const spentSessionId = await redisService.get(this.spentKey(tokenHash));
      return spentSessionId ? { status: 'reused', sessionId: spentSessionId } : { status: 'invalid' };
    }

    const claimed = await redisService.set(rotatedKey, JSON.stringify({ pending: true } satisfies RotatedRecord<T>), this.graceSeconds, true);
    if (!claimed) return (await this.awaitRotation(rotatedKey)) ?? { status: 'busy' };

    let value: T | null;
    try {
      value = await steps.commit(session);
    } catch (error) {
      await this.release(rotatedKey);
      throw error;
    }
    if (value === null) {
      await this.release(rotatedKey);
      return { status: 'invalid' };
    }

    await this.remember(tokenHash, session, value);
    return { status: 'rotated', value };
  }

  /** The session a spent token belonged to, if it was rotated and that session has not expired. */
  async spentSessionId(tokenHash: string): Promise<string | null> {
    return redisService.get(this.spentKey(tokenHash));
  }

  /** Drop the grace record so the old token stops answering (logout). */
  async forget(tokenHash: string): Promise<void> {
    await redisService.del(this.rotatedKey(tokenHash));
  }

  /**
   * The outcome of a rotation of this token that is under way or just happened: `replayed`
   * with its value, `busy` if it does not finish in time, or null when there is none.
   */
  private async awaitRotation(rotatedKey: string): Promise<RotationResult<T> | null> {
    const deadline = Date.now() + this.waitMs;
    for (;;) {
      const raw = await redisService.get(rotatedKey);
      if (!raw) return null;
      let record: RotatedRecord<T>;
      try {
        record = JSON.parse(raw) as RotatedRecord<T>;
      } catch {
        return null;
      }
      if (record.value !== undefined) return { status: 'replayed', value: record.value };
      if (Date.now() >= deadline) return { status: 'busy' };
      await sleep(this.pollMs);
    }
  }

  /** Post-commit bookkeeping. Best effort: the new token is already the only valid one. */
  private async remember(tokenHash: string, session: RotatableSession, value: T): Promise<void> {
    try {
      await redisService.set(this.rotatedKey(tokenHash), JSON.stringify({ value } satisfies RotatedRecord<T>), this.graceSeconds);
      const remainingSeconds = Math.ceil((session.refreshTokenExpiry.getTime() - Date.now()) / 1000);
      if (remainingSeconds > 0) {
        await redisService.set(this.spentKey(tokenHash), session.id, remainingSeconds);
      }
    } catch (error) {
      logger.error('Failed to record refresh token rotation; concurrent refreshes and reuse detection are degraded for this token', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Undo a claim whose commit did not rotate anything. Best effort. */
  private async release(rotatedKey: string): Promise<void> {
    try {
      await redisService.del(rotatedKey);
    } catch (error) {
      logger.error('Failed to release refresh token rotation claim', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
