import { createOAuthStateService } from '../shared/oauthStateService';

export interface XOAuthState {
  purpose: 'x_desk_setup';
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
  /**
   * The tenant's own app keys, encrypted with encryptionService before they reach Redis. Each
   * tenant has a different app, so the callback cannot look them up from config.
   */
  encryptedApp: string;
  /** The callback must send the exact redirect_uri used at authorize. */
  redirectUri: string;
  codeVerifier: string;
  createdAt: number;
  /** Reconnect: the row to update and the X account it must still be. */
  sourceId?: string;
  expectedXUserId?: string;
}

export const xOAuthStateService = createOAuthStateService<XOAuthState>({
  prefix: 'social-media:x:oauth:',
  purpose: 'x_desk_setup',
  validate: (state) =>
    (state.mode === undefined || state.mode === 'reconnect' || state.mode === 'add-account') &&
    !!state.userId &&
    !!state.workspaceId &&
    (state.mode === undefined || !!state.channelId) &&
    (state.mode !== 'reconnect' || (!!state.sourceId && !!state.expectedXUserId)) &&
    !!state.channelName &&
    !!state.projectId &&
    !!state.encryptedApp &&
    !!state.redirectUri &&
    (state.visibility === 'PUBLIC' || state.visibility === 'PRIVATE') &&
    (state.platform === 'web' || state.platform === 'electron'),
});
