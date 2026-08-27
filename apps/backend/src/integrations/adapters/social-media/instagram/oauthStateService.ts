import { createOAuthStateService } from '../shared/oauthStateService';

export interface InstagramOAuthState {
  purpose: 'instagram_desk_setup';
  mode?: 'reconnect';
  userId: string;
  workspaceId: string;
  channelId?: string;
  channelName: string;
  projectId: string;
  boardId: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  platform: 'web' | 'electron';
  codeVerifier: string;
  createdAt: number;
  // Set on reconnect: the igUserId the channel was originally connected to.
  // Callback rejects if the re-authenticating account doesn't match.
  expectedIgUserId?: string;
}

export const instagramOAuthStateService = createOAuthStateService<InstagramOAuthState>({
  prefix: 'social-media:instagram:oauth:',
  purpose: 'instagram_desk_setup',
  validate: (state) =>
    (state.mode === undefined || state.mode === 'reconnect') &&
    !!state.userId &&
    !!state.workspaceId &&
    (state.channelId === undefined || typeof state.channelId === 'string') &&
    (state.mode !== 'reconnect' || !!state.channelId) &&
    !!state.channelName &&
    !!state.projectId &&
    !!state.boardId &&
    (state.visibility === 'PUBLIC' || state.visibility === 'PRIVATE') &&
    (state.platform === 'web' || state.platform === 'electron'),
});
