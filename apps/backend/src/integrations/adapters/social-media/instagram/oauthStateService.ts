import crypto from 'node:crypto';
import { redisService } from '@/services/redisService';

export interface InstagramOAuthState {
  purpose: 'instagram_desk_setup';
  mode?: 'reconnect';
  userId: string;
  workspaceId: string;
  channelId?: string;
  channelName: string;
  projectId: string;
  boardId?: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  platform: 'web' | 'electron';
  codeVerifier: string;
  createdAt: number;
  // Set on reconnect: the igUserId the channel was originally connected to.
  // Callback rejects if the re-authenticating account doesn't match.
  expectedIgUserId?: string;
}

const STATE_PREFIX = 'social-media:instagram:oauth:';
const STATE_TTL_SECONDS = 10 * 60;

function key(state: string): string {
  return `${STATE_PREFIX}${state}`;
}

function parse(raw: string | null): InstagramOAuthState | null {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as Partial<InstagramOAuthState>;
    if (
      state.purpose !== 'instagram_desk_setup' ||
      (state.mode !== undefined && state.mode !== 'reconnect') ||
      !state.userId ||
      !state.workspaceId ||
      (state.channelId !== undefined && typeof state.channelId !== 'string') ||
      (state.mode === 'reconnect' && !state.channelId) ||
      !state.channelName ||
      !state.projectId ||
      !state.codeVerifier ||
      (state.visibility !== 'PUBLIC' && state.visibility !== 'PRIVATE') ||
      (state.platform !== 'web' && state.platform !== 'electron') ||
      typeof state.createdAt !== 'number'
    ) {
      return null;
    }
    return state as InstagramOAuthState;
  } catch {
    return null;
  }
}

class InstagramOAuthStateService {
  async create(
    input: Omit<InstagramOAuthState, 'purpose' | 'codeVerifier' | 'createdAt'>,
  ): Promise<{ state: string; codeChallenge: string }> {
    const state = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const value: InstagramOAuthState = {
      purpose: 'instagram_desk_setup',
      ...input,
      codeVerifier,
      createdAt: Date.now(),
    };
    await redisService.set(key(state), JSON.stringify(value), STATE_TTL_SECONDS);
    return { state, codeChallenge };
  }

  async consume(state: string): Promise<InstagramOAuthState | null> {
    const raw = (await redisService.getClient().eval(
      `
        local value = redis.call('GET', KEYS[1])
        if value then redis.call('DEL', KEYS[1]) end
        return value
      `,
      1,
      key(state),
    )) as string | null;
    return parse(raw);
  }
}

export const instagramOAuthStateService = new InstagramOAuthStateService();
