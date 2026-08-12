import { auditWikiContent } from '../../../src/sdlc/wiki/wikiContentAudit';
import type { WikiMapEntry } from '../../../src/sdlc/wiki/wikiMap';

describe('auditWikiContent', () => {
  it('reports deterministic structural risks without mutating pages', () => {
    const page = (path: string): WikiMapEntry => ({
      path,
      title: path,
      purpose: 'Purpose',
      concepts: ['Retries'],
      sourceAreas: path.startsWith('scratch') ? [] : ['src'],
      sourcePaths: path.startsWith('scratch') ? [] : ['src/index.ts'],
      sourceReferences: [],
      contentHash: path.includes('duplicate') ? 'same' : path,
      lastCommitSha: null,
      archived: false,
      diagrams: [],
    });
    const findings = auditWikiContent({
      map: [page('scratch/test.md'), page('archive/old.md')],
      markdownByPath: new Map([
        ['scratch/test.md', '```mermaid\nflowchart LR'],
        ['archive/old.md', '# Old'],
      ]),
    });
    expect(findings.map(finding => finding.code)).toEqual(
      expect.arrayContaining([
        'SCRATCH_PAGE',
        'ACTIVE_ARCHIVE_PATH',
        'EMPTY_SOURCES',
        'BROKEN_MERMAID_FENCE',
        'DUPLICATE_TOPIC',
      ])
    );
  });

  it('detects unsafe citations, invalid diagrams, stale sources, broad rewrites, and missing navigation', () => {
    const page = (path: string, hash: string): WikiMapEntry => ({
      path,
      title: path,
      purpose: 'Purpose',
      concepts: [],
      sourceAreas: ['src'],
      sourcePaths: ['src/index.ts'],
      sourceReferences: [],
      contentHash: hash,
      lastCommitSha: 'a'.repeat(40),
      archived: false,
      diagrams: [],
    });
    const findings = auditWikiContent({
      map: [page('overview.md', 'overview'), page('subsystems/api.md', 'duplicate'), page('flows/api.md', 'duplicate')],
      markdownByPath: new Map([
        ['overview.md', '# Overview\n'],
        ['subsystems/api.md', `# API\n\n[raw](https://github.com/acme/repo/blob/${'b'.repeat(40)}/src/index.ts)\n\n\`\`\`mermaid\nunknownDiagram\nA-->B\n\`\`\``],
        ['flows/api.md', '# Flow\nshort'],
      ]),
      staleSourcesByPath: new Map([['subsystems/api.md', ['src/index.ts']]]),
      previousContentLengthByPath: new Map([['flows/api.md', 3_000]]),
      mutationModeByPath: new Map([['flows/api.md', 'update']]),
    });
    expect(findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
      'DUPLICATE_CONTENT',
      'MISSING_INDEX_LINK',
      'STALE_SOURCE',
      'UNSUPPORTED_SOURCE_CITATION',
      'INVALID_MERMAID',
      'SUSPICIOUS_BROAD_REWRITE',
    ]));
  });

  it('accepts a polished no-diagram page and flags a shallow file inventory', () => {
    const entry = (path: string): WikiMapEntry => ({
      path, title: path, purpose: 'Purpose', concepts: [], sourceAreas: ['src'],
      sourcePaths: ['src/index.ts'], sourceReferences: [{ path: 'src/index.ts', commitSha: 'a'.repeat(40) }],
      contentHash: path, lastCommitSha: 'a'.repeat(40), archived: false, diagrams: [],
    });
    const polished = `# Retry policy\n\n## Purpose\n\nExplains bounded retries without needing a diagram.\n\n## How it works\n\nThe worker makes three attempts and then records a terminal failure.\n\n## Failure behavior\n\nTimeouts are retryable; validation errors are terminal.\n\nImplementation: [worker](https://github.com/acme/repo/blob/${'a'.repeat(40)}/src/index.ts).`;
    const inventory = '# Files\n\n- `src/a.ts`\n- `src/b.ts`\n- `src/c.ts`\n- `src/d.ts`\n';
    const findings = auditWikiContent({
      map: [entry('operations/retries.md'), entry('subsystems/files.md')],
      markdownByPath: new Map([
        ['operations/retries.md', polished],
        ['subsystems/files.md', inventory],
      ]),
    });
    expect(findings.filter(finding => finding.path === 'operations/retries.md')).toEqual([]);
    expect(findings).toContainEqual(expect.objectContaining({
      code: 'SHALLOW_FILE_INVENTORY', path: 'subsystems/files.md',
    }));
  });
});
