import { toClawChatProjectKnowledge } from './clawProjectKnowledgeDto';

/**
 * The proxy forwards claw-auth's JSON verbatim, and a TypeScript interface
 * shapes nothing at runtime — so the row's internal columns were reaching the
 * browser. These assert the mapper is a real allow-list, not a cast.
 */
describe('toClawChatProjectKnowledge', () => {
  const row = {
    id: 'k-1',
    projectId: 'proj-1',
    type: 'file',
    refId: 'att-1',
    title: 'Brand guide',
    mimeType: 'application/pdf',
    size: 2048,
    createdAt: '2026-10-23T00:00:00.000Z',
    storagePath: 'chat-attachments/user-1/2026/10/brand.pdf',
    orgId: 'org-1',
    addedByUserId: 'user-1',
    metadata: { secret: true },
  };

  it('keeps the fields the browser is meant to see', () => {
    expect(toClawChatProjectKnowledge(row)).toEqual({
      id: 'k-1',
      projectId: 'proj-1',
      type: 'file',
      refId: 'att-1',
      title: 'Brand guide',
      mimeType: 'application/pdf',
      size: 2048,
      createdAt: '2026-10-23T00:00:00.000Z',
    });
  });

  it.each(['storagePath', 'orgId', 'addedByUserId', 'metadata'])('drops %s', field => {
    expect(toClawChatProjectKnowledge(row)).not.toHaveProperty(field);
  });

  it('drops a column added to the model later, since it allow-lists', () => {
    const withNewColumn = { ...row, internalScore: 7 };
    expect(toClawChatProjectKnowledge(withNewColumn)).not.toHaveProperty('internalScore');
  });

  it('normalises an absent mimeType and size to null rather than undefined', () => {
    const entity = { id: 'k-2', projectId: 'proj-1', type: 'channel', refId: 'chan-1', title: '#design', createdAt: 'x' };
    const mapped = toClawChatProjectKnowledge(entity);
    expect(mapped.mimeType).toBeNull();
    expect(mapped.size).toBeNull();
  });

  it('does not throw on a null or empty row', () => {
    expect(() => toClawChatProjectKnowledge(null)).not.toThrow();
    expect(toClawChatProjectKnowledge({}).id).toBe('');
  });
});
