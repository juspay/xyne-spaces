jest.mock('@xyne/shared', () => ({
  ACLAuditEventType: {
    RESOURCE_CREATED: 'RESOURCE_CREATED',
    RESOURCE_DELETED: 'RESOURCE_DELETED',
    RESOURCE_UPDATED: 'RESOURCE_UPDATED',
  },
  ACLAuditTargetType: { RESOURCE: 'RESOURCE' },
}));
jest.mock('../../../src/database/client', () => ({
  DatabaseClient: { getInstance: jest.fn() },
}));
jest.mock('../../../src/queues/sdlcQueue', () => ({
  sdlcQueue: {},
}));
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { generateKeyPairSync } from 'crypto';
import { SdlcVcsService } from '../../../src/sdlc/vcs/SdlcVcsService';
import { issueSdlcInteractiveGrant } from '../../../src/sdlc/vcs/sdlcInteractiveGrant';

function publicKey(): string {
  return generateKeyPairSync('x25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

describe('SdlcVcsService Wiki public read path', () => {
  it('returns anonymous bootstrap only after the execution binding and read capability pass', async () => {
    const prisma = {
      workflowExecution: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'execution-1',
          workspaceId: 'workspace-1',
          createdBy: 'user-1',
          context: JSON.stringify({
            agentSlug: 'sdlc-agent',
            repoId: 'repo-1',
            sessionId: 'session-1',
            credentialSessionId: 'session-1',
            phase: 'PROCESSING',
          }),
        }),
      },
      repo: {
        findUnique: jest.fn().mockResolvedValue({ id: 'repo-1', workspaceId: 'workspace-1' }),
      },
    };
    const service = new SdlcVcsService(prisma as never);
    const capability = jest.spyOn(service, 'requireCapabilities').mockResolvedValue(undefined);
    (service as unknown as { credentialStore: { find: jest.Mock } }).credentialStore = {
      find: jest.fn().mockResolvedValue(null),
    };

    await expect(
      service.bootstrapSandboxCredential({
        agentSlug: 'sdlc-agent',
        executionId: 'execution-1',
        sessionId: 'session-1',
        repoId: 'repo-1',
        operation: 'CLONE',
        sandboxId: 'sandbox-1',
        sandboxPublicKey: publicKey(),
      })
    ).resolves.toBeNull();
    expect(prisma.workflowExecution.findFirst).toHaveBeenCalledWith({
      where: { id: 'execution-1', status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, workspaceId: true, createdBy: true, context: true },
    });
    expect(capability).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      'repo-1',
      ['READ_REPOSITORY']
    );
  });

  it('bootstraps an interactive Kata clone from a signed repository grant', async () => {
    const prisma = {
      repo: {
        findUnique: jest.fn().mockResolvedValue({ id: 'repo-1', workspaceId: 'workspace-1' }),
      },
    };
    const service = new SdlcVcsService(prisma as never);
    jest.spyOn(service as never, 'requireRepositoryMember' as never).mockResolvedValue({} as never);
    const capability = jest.spyOn(service, 'requireCapabilities').mockResolvedValue(undefined);
    (service as unknown as { credentialStore: { find: jest.Mock } }).credentialStore = {
      find: jest.fn().mockResolvedValue(null),
    };
    const secret = 'interactive-test-secret';
    process.env['INTERNAL_S2S_KEY'] = secret;
    const interactiveGrant = issueSdlcInteractiveGrant(
      {
        agentSlug: 'sdlc-agent',
        workspaceId: 'workspace-1',
        repoId: 'repo-1',
        actorUserId: 'user-1',
        conversationId: 'conversation-1',
      },
      secret
    );

    await expect(
      service.bootstrapSandboxCredential({
        agentSlug: 'sdlc-agent',
        interactiveGrant,
        conversationId: 'conversation-1',
        repoId: 'repo-1',
        operation: 'INTERACTIVE',
        sandboxId: 'sandbox-1',
        sandboxPublicKey: publicKey(),
      })
    ).resolves.toBeNull();
    expect(capability).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      'repo-1',
      ['READ_REPOSITORY']
    );
    await expect(
      service.bootstrapSandboxCredential({
        agentSlug: 'sdlc-agent',
        interactiveGrant,
        conversationId: 'conversation-2',
        repoId: 'repo-1',
        operation: 'INTERACTIVE',
        sandboxId: 'sandbox-2',
        sandboxPublicKey: publicKey(),
      })
    ).rejects.toThrow('interactive binding mismatch');
  });

  it('verifies public source paths with no token', async () => {
    const prisma = {
      repo: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'repo-1',
          workspaceId: 'workspace-1',
          canonicalUrl: 'https://github.com/example/public-repo',
          url: 'https://github.com/example/public-repo',
        }),
      },
    };
    const service = new SdlcVcsService(prisma as never);
    (service as unknown as { credentialStore: { find: jest.Mock } }).credentialStore = {
      find: jest.fn().mockResolvedValue(null),
    };
    const verifyPathsAtCommit = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(service as never, 'adapter' as never).mockReturnValue({
      parseRepositoryUrl: jest.fn().mockReturnValue({ owner: 'example', name: 'public-repo' }),
      verifyPathsAtCommit,
    } as never);

    await service.verifySourcePaths('repo-1', 'a'.repeat(40), ['src/main.ts']);
    expect(verifyPathsAtCommit).toHaveBeenCalledWith(
      undefined,
      { owner: 'example', name: 'public-repo' },
      'a'.repeat(40),
      ['src/main.ts']
    );
  });
});
