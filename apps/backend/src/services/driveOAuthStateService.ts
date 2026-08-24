import crypto from 'crypto';
import { redisService } from '@/services/redisService';

export type DriveOAuthPlatform = 'web' | 'electron';

/**
 * Single-use, user-bound state for the KB Google Drive OAuth connect flow.
 * Mirrors calendarOAuthStateService: the state carries the PKCE verifier and the
 * signed-in user identity so the callback can verify the returned Google account
 * matches the user who started the flow.
 */
export interface DriveOAuthState {
  purpose: 'drive_connect';
  ownerUserId: string;
  workspaceId: string;
  expectedEmail: string;
  platform: DriveOAuthPlatform;
  /** Same-origin frontend path to return to after consent (e.g. the KB URL). */
  returnPath: string;
  codeVerifier: string;
  createdAt: number;
}

const STATE_KEY_PREFIX = 'drive:oauth:state:';
const STATE_TTL_SECONDS = 10 * 60;

function stateKey(state: string): string {
  return `${STATE_KEY_PREFIX}${state}`;
}

function parseState(raw: string | null): DriveOAuthState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<DriveOAuthState>;
    if (
      parsed.purpose !== 'drive_connect' ||
      !parsed.ownerUserId ||
      !parsed.workspaceId ||
      !parsed.expectedEmail ||
      (parsed.platform !== 'web' && parsed.platform !== 'electron') ||
      typeof parsed.returnPath !== 'string' ||
      !parsed.codeVerifier ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null;
    }

    return parsed as DriveOAuthState;
  } catch {
    return null;
  }
}

class DriveOAuthStateService {
  async create(
    input: Omit<DriveOAuthState, 'purpose' | 'codeVerifier' | 'createdAt'>
  ): Promise<{ state: string; codeChallenge: string }> {
    const state = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const stateData: DriveOAuthState = {
      purpose: 'drive_connect',
      ...input,
      codeVerifier,
      createdAt: Date.now(),
    };

    await redisService.set(stateKey(state), JSON.stringify(stateData), STATE_TTL_SECONDS);

    return { state, codeChallenge };
  }

  async peek(state: string): Promise<DriveOAuthState | null> {
    return parseState(await redisService.get(stateKey(state)));
  }

  async consume(state: string): Promise<DriveOAuthState | null> {
    const key = stateKey(state);
    const client = redisService.getClient();
    const raw = (await client.eval(
      `
        local value = redis.call('GET', KEYS[1])
        if value then
          redis.call('DEL', KEYS[1])
        end
        return value
      `,
      1,
      key
    )) as string | null;

    return parseState(raw);
  }

  async delete(state: string): Promise<void> {
    await redisService.del(stateKey(state));
  }
}

export const driveOAuthStateService = new DriveOAuthStateService();
