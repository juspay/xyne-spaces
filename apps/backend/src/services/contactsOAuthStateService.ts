import crypto from 'crypto';
import { redisService } from '@/services/redisService';

export type ContactsOAuthPlatform = 'web' | 'electron';
export type ContactsOAuthProvider = 'GOOGLE' | 'MICROSOFT';

export interface ContactsOAuthState {
  purpose: 'contacts_reauth';
  provider: ContactsOAuthProvider;
  ownerUserId: string;
  workspaceId: string;
  expectedEmail: string;
  /** Frontend path to return to after the callback (keeps the invite dialog context). */
  returnPath?: string;
  platform: ContactsOAuthPlatform;
  codeVerifier: string;
  createdAt: number;
}

const STATE_KEY_PREFIX = 'contacts:oauth:state:';
const STATE_TTL_SECONDS = 10 * 60;

function stateKey(state: string): string {
  return `${STATE_KEY_PREFIX}${state}`;
}

function parseState(raw: string | null): ContactsOAuthState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ContactsOAuthState>;
    if (
      parsed.purpose !== 'contacts_reauth' ||
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

    return parsed as ContactsOAuthState;
  } catch {
    return null;
  }
}

class ContactsOAuthStateService {
  async create(
    input: Omit<ContactsOAuthState, 'purpose' | 'codeVerifier' | 'createdAt'>
  ): Promise<{ state: string; codeChallenge: string }> {
    const state = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const stateData: ContactsOAuthState = {
      purpose: 'contacts_reauth',
      ...input,
      codeVerifier,
      createdAt: Date.now(),
    };

    await redisService.set(stateKey(state), JSON.stringify(stateData), STATE_TTL_SECONDS);

    return { state, codeChallenge };
  }

  async peek(state: string): Promise<ContactsOAuthState | null> {
    return parseState(await redisService.get(stateKey(state)));
  }

  async consume(state: string): Promise<ContactsOAuthState | null> {
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

export const contactsOAuthStateService = new ContactsOAuthStateService();
