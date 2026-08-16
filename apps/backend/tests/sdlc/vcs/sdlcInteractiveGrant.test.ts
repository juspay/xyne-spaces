import {
  issueSdlcInteractiveGrant,
  verifySdlcInteractiveGrant,
} from '../../../src/sdlc/vcs/sdlcInteractiveGrant';

const secret = 'test-secret-that-is-not-used-outside-this-test';
const now = new Date('2026-08-16T10:00:00.000Z');

describe('SDLC interactive grant', () => {
  it('round-trips trusted repository and conversation identity', () => {
    const token = issueSdlcInteractiveGrant(
      {
        agentSlug: 'sdlc-agent',
        workspaceId: 'workspace-1',
        repoId: 'repo-1',
        actorUserId: 'user-1',
        conversationId: 'conversation-1',
      },
      secret,
      now
    );

    expect(verifySdlcInteractiveGrant(token, secret, now)).toMatchObject({
      agentSlug: 'sdlc-agent',
      workspaceId: 'workspace-1',
      repoId: 'repo-1',
      actorUserId: 'user-1',
      conversationId: 'conversation-1',
    });
  });

  it('rejects tampering and expiry', () => {
    const token = issueSdlcInteractiveGrant(
      {
        agentSlug: 'sdlc-agent',
        workspaceId: 'workspace-1',
        repoId: 'repo-1',
        actorUserId: 'user-1',
        conversationId: 'conversation-1',
      },
      secret,
      now
    );

    expect(() => verifySdlcInteractiveGrant(`${token}x`, secret, now)).toThrow();
    expect(() =>
      verifySdlcInteractiveGrant(token, secret, new Date('2026-08-16T10:31:00.000Z'))
    ).toThrow(/expired/i);
  });
});
