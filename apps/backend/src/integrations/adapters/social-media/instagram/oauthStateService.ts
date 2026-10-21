import { createOAuthStateService } from '../shared/oauthStateService';

export interface InstagramOAuthState {
  purpose: 'instagram_desk_setup';
  mode?: 'reconnect' | 'add-account';
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
  // Set on per-source reconnect: the ExternalSource.id being reconnected.
  // Callback uses this to update only that specific row (not all Instagram sources on the channel).
  sourceId?: string;
  // Set on reconnect: the igUserId the channel was originally connected to.
  // Callback rejects if the re-authenticating account doesn't match.
  expectedIgUserId?: string;
}

export const instagramOAuthStateService = createOAuthStateService<InstagramOAuthState>({
  prefix: 'social-media:instagram:oauth:',
  purpose: 'instagram_desk_setup',
  validate: (state) =>
    (state.mode === undefined || state.mode === 'reconnect' || state.mode === 'add-account') &&
    !!state.userId &&
    !!state.workspaceId &&
    (state.channelId === undefined || typeof state.channelId === 'string') &&
    (state.mode !== 'reconnect' || !!state.channelId) &&
    (state.mode !== 'add-account' || !!state.channelId) &&
    !!state.channelName &&
    !!state.projectId &&
    (state.visibility === 'PUBLIC' || state.visibility === 'PRIVATE') &&
    (state.platform === 'web' || state.platform === 'electron'),
});
