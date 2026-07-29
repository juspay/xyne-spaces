import crypto from 'crypto';
import { redisService } from '@/services/redisService';

export type CalendarOAuthPlatform = 'web' | 'electron';
export type CalendarOAuthProvider = 'GOOGLE' | 'MICROSOFT';

export interface CalendarOAuthState {
  purpose: 'calendar_reauth';
  provider: CalendarOAuthProvider;
  ownerUserId: string;
  workspaceId: string;
  expectedEmail: string;
  platform: CalendarOAuthPlatform;
  codeVerifier: string;
  createdAt: number;
}

const STATE_KEY_PREFIX = 'calendar:oauth:state:';
const STATE_TTL_SECONDS = 10 * 60;

function stateKey(state: string): string {
  return `${STATE_KEY_PREFIX}${state}`;
}

function parseState(raw: string | null): CalendarOAuthState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<CalendarOAuthState>;
    if (
      parsed.purpose !== 'calendar_reauth' ||
      (parsed.provider !== 'GOOGLE' && parsed.provider !== 'MICROSOFT') ||
      !parsed.ownerUserId ||
      !parsed.workspaceId ||
      !parsed.expectedEmail ||
      (parsed.platform !== 'web' && parsed.platform !== 'electron') ||
      !parsed.codeVerifier ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null;
    }

    return parsed as CalendarOAuthState;
  } catch {
    return null;
  }
}

class CalendarOAuthStateService {
  async create(
    input: Omit<CalendarOAuthState, 'purpose' | 'codeVerifier' | 'createdAt'>
  ): Promise<{ state: string; codeChallenge: string }> {
    const state = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const stateData: CalendarOAuthState = {
      purpose: 'calendar_reauth',
      ...input,
      codeVerifier,
      createdAt: Date.now(),
    };

    await redisService.set(stateKey(state), JSON.stringify(stateData), STATE_TTL_SECONDS);

    return { state, codeChallenge };
  }

  async peek(state: string): Promise<CalendarOAuthState | null> {
    return parseState(await redisService.get(stateKey(state)));
  }

  async consume(state: string): Promise<CalendarOAuthState | null> {
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

export const calendarOAuthStateService = new CalendarOAuthStateService();
