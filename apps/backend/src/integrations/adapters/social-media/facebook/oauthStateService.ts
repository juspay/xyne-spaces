import { createOAuthStateService } from '../shared/oauthStateService';

export interface FacebookOAuthState {
  purpose: 'facebook_desk_setup';
  mode?: 'reconnect' | 'add-page';
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
  // Set on reconnect: the ExternalSource.id being reconnected and the Page it must match.
  sourceId?: string;
  expectedPageId?: string;
}

export const facebookOAuthStateService = createOAuthStateService<FacebookOAuthState>({
  prefix: 'social-media:facebook:oauth:',
  purpose: 'facebook_desk_setup',
  validate: (state) =>
    (state.mode === undefined || state.mode === 'reconnect' || state.mode === 'add-page') &&
    !!state.userId &&
    !!state.workspaceId &&
    (state.mode === undefined || !!state.channelId) &&
    (state.mode !== 'reconnect' || (!!state.sourceId && !!state.expectedPageId)) &&
    !!state.channelName &&
    !!state.projectId &&
    (state.visibility === 'PUBLIC' || state.visibility === 'PRIVATE') &&
    (state.platform === 'web' || state.platform === 'electron'),
});
