import assert from 'node:assert/strict';
import {
  resolveSdlcDiscussionOwnerId,
  type SdlcDiscussionOwnerLookup,
} from '../../src/sdlc/sdlcDiscussionOwner';

it('resolves a Tech Doc selection to its PRD owner instead of trusting the requested owner', async () => {
  const canvases = new Map([
    [
      'prd-1',
      {
        id: 'prd-1',
        workspaceId: 'workspace-1',
        channelId: 'channel-1',
        metadata: { repoId: 'repo-1', artifactKind: 'PRD' },
      },
    ],
    [
      'tech-doc-1',
      {
        id: 'tech-doc-1',
        workspaceId: 'workspace-1',
        channelId: 'channel-1',
        metadata: { repoId: 'repo-1', artifactKind: 'TECH_DOC' },
      },
    ],
  ]);
  const lookup: SdlcDiscussionOwnerLookup = {
    getCanvas: async (id) => canvases.get(id) ?? null,
    getTicket: async () => null,
    getPullRequest: async () => null,
    findLinkSource: async (input) =>
      input.targetType === 'CANVAS' && input.targetId === 'tech-doc-1'
        ? { sourceType: 'CANVAS', sourceId: 'prd-1' }
        : null,
  };

  assert.equal(
    await resolveSdlcDiscussionOwnerId(
      {
        workspaceId: 'workspace-1',
        repoId: 'repo-1',
        channelId: 'channel-1',
        surfaceType: 'CANVAS',
        surfaceId: 'tech-doc-1',
      },
      lookup
    ),
    'prd-1'
  );
});

it('resolves a Pull Request through its Ticket and rejects cross-workspace surfaces', async () => {
  const lookup: SdlcDiscussionOwnerLookup = {
    getCanvas: async (id) =>
      id === 'prd-1'
        ? {
            id,
            workspaceId: 'workspace-1',
            channelId: 'channel-1',
            metadata: { repoId: 'repo-1', artifactKind: 'PRD' },
          }
        : null,
    getTicket: async (id) =>
      id === 'ticket-1' ? { id, workspaceId: 'workspace-1', channelId: 'channel-1' } : null,
    getPullRequest: async (id) => (id === 'pr-1' ? { id, workspaceId: 'workspace-1' } : null),
    findLinkSource: async (input) => {
      if (input.targetType === 'PULL_REQUEST' && input.targetId === 'pr-1') {
        return { sourceType: 'TICKET', sourceId: 'ticket-1' };
      }
      if (input.targetType === 'TICKET' && input.targetId === 'ticket-1') {
        return { sourceType: 'CANVAS', sourceId: 'prd-1' };
      }
      return null;
    },
  };

  assert.equal(
    await resolveSdlcDiscussionOwnerId(
      {
        workspaceId: 'workspace-1',
        repoId: 'repo-1',
        channelId: 'channel-1',
        surfaceType: 'PULL_REQUEST',
        surfaceId: 'pr-1',
      },
      lookup
    ),
    'prd-1'
  );
  assert.equal(
    await resolveSdlcDiscussionOwnerId(
      {
        workspaceId: 'another-workspace',
        repoId: 'repo-1',
        channelId: 'channel-1',
        surfaceType: 'PULL_REQUEST',
        surfaceId: 'pr-1',
      },
      lookup
    ),
    null
  );
});
