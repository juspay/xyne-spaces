import { pickInspectableVespaFields } from './vespaInspectFields';

describe('pickInspectableVespaFields', () => {
  it('keeps chunk/content fields', () => {
    const out = pickInspectableVespaFields({
      fileName: 'a.pdf',
      chunks: ['one', 'two'],
      chunks_map: [{ chunk_index: 0, page_numbers: [1] }],
      image_chunks: ['img'],
      description: 'desc',
    });
    expect(out).toEqual({
      fileName: 'a.pdf',
      chunks: ['one', 'two'],
      chunks_map: [{ chunk_index: 0, page_numbers: [1] }],
      image_chunks: ['img'],
      description: 'desc',
    });
  });

  it('drops ACL fields and embedding tensors', () => {
    const out = pickInspectableVespaFields({
      chunks: ['x'],
      permissions: ['user-1', 'user-2'],
      ownerId: 'user-1',
      channelPermissions: ['user-3'],
      workspaceId: 'ws-1',
      chunk_embeddings: { blocks: {} },
      image_chunk_embeddings: { blocks: {} },
    });
    expect(Object.keys(out)).toEqual(['chunks']);
  });
});
