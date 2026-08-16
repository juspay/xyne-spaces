import { writeSdlcWikiPageSchema } from '../../../../../packages/shared/src/sdlc';

const executionId = 'execution-1';
const commitSha = 'a'.repeat(9);
const common = {
  path: 'subsystems/integrations.md',
  sourcePaths: ['backend/src/integrations/index.ts'],
  sourceReferences: [{ path: 'backend/src/integrations/index.ts', symbol: 'registry' }],
};

describe('SDLC Wiki tool contracts', () => {
  it.each([
    { action: 'create', ...common, title: 'Integrations', markdown: '# Integrations' },
    { action: 'update', ...common, title: 'Integrations', markdown: '# Integrations', expectedContentHash: 'hash' },
    { action: 'restore', ...common, title: 'Integrations', markdown: '# Integrations', expectedContentHash: 'hash' },
    { action: 'archive', ...common, expectedContentHash: 'hash' },
    { action: 'replace_section', ...common, heading: 'Scope', markdown: 'New scope', expectedContentHash: 'hash' },
    { action: 'insert_section', ...common, heading: 'Scope', markdown: 'New scope', expectedContentHash: 'hash' },
    { action: 'remove_section', ...common, heading: 'Scope', expectedContentHash: 'hash' },
  ])('accepts the canonical $action payload', page => {
    expect(writeSdlcWikiPageSchema.safeParse({ executionId, commitSha, page }).success).toBe(true);
  });

  it('reports the exact missing update field', () => {
    const result = writeSdlcWikiPageSchema.safeParse({
      executionId,
      commitSha,
      page: { action: 'update', path: common.path, markdown: '# Integrations' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map(issue => issue.path.join('.'))).toEqual(expect.arrayContaining([
      'page.expectedContentHash',
      'page.title',
      'page.sourcePaths',
    ]));
    expect(result.error.issues.some(issue => issue.message === 'Invalid input')).toBe(false);
  });
});
