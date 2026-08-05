import crypto from 'crypto';
import { redisService } from '@/services/redisService';

export interface GooglePlayOAuthState {
  purpose: 'google_play_desk_setup';
  mode?: 'reconnect';
  userId: string;
  workspaceId: string;
  channelId?: string;
  channelName: string;
  applications: Array<{
    packageName: string;
    displayName: string;
  }>;
  projectId: string;
  boardId: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  platform: 'web' | 'electron';
  codeVerifier: string;
  createdAt: number;
}

const STATE_PREFIX = 'social-media:google-play:oauth:';
const STATE_TTL_SECONDS = 10 * 60;

function key(state: string): string {
  return `${STATE_PREFIX}${state}`;
}

function parse(raw: string | null): GooglePlayOAuthState | null {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as Partial<GooglePlayOAuthState>;
    if (
      state.purpose !== 'google_play_desk_setup' ||
      (state.mode !== undefined && state.mode !== 'reconnect') ||
      !state.userId ||
      !state.workspaceId ||
      (state.channelId !== undefined && typeof state.channelId !== 'string') ||
      (state.mode === 'reconnect' && !state.channelId) ||
      !state.channelName ||
      !Array.isArray(state.applications) ||
      state.applications.length === 0 ||
      state.applications.some(
        (application) => !application?.packageName || !application?.displayName
      ) ||
      !state.projectId ||
      !state.boardId ||
      !state.codeVerifier ||
      (state.visibility !== 'PUBLIC' && state.visibility !== 'PRIVATE') ||
      (state.platform !== 'web' && state.platform !== 'electron') ||
      typeof state.createdAt !== 'number'
    ) {
      return null;
    }
    return state as GooglePlayOAuthState;
  } catch {
    return null;
  }
}

class GooglePlayOAuthStateService {
  async create(
    input: Omit<GooglePlayOAuthState, 'purpose' | 'codeVerifier' | 'createdAt'>
  ): Promise<{ state: string; codeChallenge: string }> {
    const state = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const value: GooglePlayOAuthState = {
      purpose: 'google_play_desk_setup',
      ...input,
      codeVerifier,
      createdAt: Date.now(),
    };
    await redisService.set(key(state), JSON.stringify(value), STATE_TTL_SECONDS);
    return { state, codeChallenge };
  }

  async consume(state: string): Promise<GooglePlayOAuthState | null> {
    const raw = (await redisService.getClient().eval(
      `
        local value = redis.call('GET', KEYS[1])
        if value then redis.call('DEL', KEYS[1]) end
        return value
      `,
      1,
      key(state)
    )) as string | null;
    return parse(raw);
  }
}

export const googlePlayOAuthStateService = new GooglePlayOAuthStateService();
