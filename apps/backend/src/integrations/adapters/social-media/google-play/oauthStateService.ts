import { createOAuthStateService } from '../shared/oauthStateService';

export interface GooglePlayOAuthState {
  purpose: 'google_play_desk_setup';
  mode?: 'reconnect';
  reactivateAll?: boolean;
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

export const googlePlayOAuthStateService = createOAuthStateService<GooglePlayOAuthState>({
  prefix: 'social-media:google-play:oauth:',
  purpose: 'google_play_desk_setup',
  validate: (state) =>
    (state.mode === undefined || state.mode === 'reconnect') &&
    (state.reactivateAll === undefined || typeof state.reactivateAll === 'boolean') &&
    !!state.userId &&
    !!state.workspaceId &&
    (state.channelId === undefined || typeof state.channelId === 'string') &&
    (state.mode !== 'reconnect' || !!state.channelId) &&
    !!state.channelName &&
    Array.isArray(state.applications) &&
    (state.applications?.length ?? 0) > 0 &&
    (state.applications ?? []).every(a => !!a?.packageName && !!a?.displayName) &&
    !!state.projectId &&
    !!state.boardId &&
    (state.visibility === 'PUBLIC' || state.visibility === 'PRIVATE') &&
    (state.platform === 'web' || state.platform === 'electron'),
});
