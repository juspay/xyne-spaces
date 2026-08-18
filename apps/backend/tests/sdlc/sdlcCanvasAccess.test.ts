jest.mock('@xyne/shared', () => ({ CanvasRole: { VIEWER: 'VIEWER' } }));

import { sdlcChannelCanvasParticipant } from '../../src/sdlc/sdlcCanvasAccess';

describe('SDLC canvas channel access', () => {
  it('gives channel members viewer access to every new SDLC canvas', () => {
    expect(sdlcChannelCanvasParticipant('workspace-1', 'channel-1')).toEqual({
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      role: 'VIEWER',
    });
  });

  it('rejects an SDLC canvas without a repository channel', () => {
    expect(() => sdlcChannelCanvasParticipant('workspace-1', null)).toThrow(
      'SDLC canvas requires a repository channel'
    );
  });
});
