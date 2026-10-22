import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/clients/fileFetchService', () => ({ downloadFile: vi.fn() }));
import type { ConversationArtifact } from '../../../services/XyneAI/XyneAIArtifactsService';
import { indexDeliveredArtifacts, splitDeliveredAttachments } from './deliveredArtifacts';

const artifact = (over: Partial<ConversationArtifact>): ConversationArtifact => ({
  id: 'art-1',
  conversationId: 'conv',
  messageId: 'msg-1',
  kind: 'FILE',
  refService: 'CLAW',
  refId: 'att-1',
  latestVersionRef: 'att-1',
  title: 'deck.pptx',
  status: 'ACTIVE',
  pinned: false,
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
  openRef: { kind: 'FILE', service: 'CLAW', refId: 'att-1' },
  ...over,
});

describe('delivered artifacts', () => {
  const index = indexDeliveredArtifacts([
    artifact({}),
    artifact({
      id: 'art-2',
      kind: 'DESIGN_HTML',
      refId: 'share-1',
      latestVersionRef: 'att-2',
      title: 'Landing',
    }),
    artifact({ id: 'art-3', kind: 'UPLOAD', refId: 'att-3', messageId: 'msg-user' }),
    artifact({ id: 'art-4', refId: 'att-4', status: 'DELETED' }),
  ]);

  it('turns a delivered attachment into its artifact and leaves the rest as attachments', () => {
    const split = splitDeliveredAttachments('msg-1', [{ id: 'att-1' }, { id: 'other' }], index);
    expect(split.artifacts.map(a => a.id)).toEqual(['art-1', 'art-2']);
    expect(split.attachments).toEqual([{ id: 'other' }]);
  });

  it('still shows the message artifacts when the server no longer sends the attachments', () => {
    expect(splitDeliveredAttachments('msg-1', [], index).artifacts.map(a => a.id)).toEqual([
      'art-1',
      'art-2',
    ]);
  });

  it('ignores uploads, deleted rows, and other messages', () => {
    expect(splitDeliveredAttachments('msg-user', [{ id: 'att-3' }], index)).toEqual({
      artifacts: [],
      attachments: [{ id: 'att-3' }],
    });
    expect(splitDeliveredAttachments('msg-9', [{ id: 'att-4' }], index).attachments).toEqual([
      { id: 'att-4' },
    ]);
  });

  it('keeps everything as attachments outside the Xyne AI screen', () => {
    expect(splitDeliveredAttachments('msg-1', [{ id: 'att-1' }], null)).toEqual({
      artifacts: [],
      attachments: [{ id: 'att-1' }],
    });
  });
});
