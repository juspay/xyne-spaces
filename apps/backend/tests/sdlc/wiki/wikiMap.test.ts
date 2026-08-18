import { deriveWikiMapEntry } from '../../../src/sdlc/wiki/wikiMap';

describe('deriveWikiMapEntry', () => {
  it('derives compact routing and diagram memory from authoritative page content', () => {
    expect(
      deriveWikiMapEntry({
        path: 'operations/observability.md',
        title: 'Observability',
        markdown:
          '# Observability\n\nExplains how telemetry moves through the platform.\n\n## Data flow\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n## Failure behavior\n\nRetries are bounded.\n',
        sourcePaths: ['crates/router/src/metrics.rs', 'config/monitoring/grafana.yml'],
        sourceReferences: [{ path: 'crates/router/src/metrics.rs', commitSha: 'a'.repeat(40) }],
        contentHash: 'content-hash',
        lastCommitSha: 'a'.repeat(40),
        archived: false,
      })
    ).toEqual(
      expect.objectContaining({
        purpose: 'Explains how telemetry moves through the platform.',
        concepts: ['Data flow', 'Failure behavior'],
        sourceAreas: ['crates/router', 'config/monitoring'],
        sourcePaths: ['crates/router/src/metrics.rs', 'config/monitoring/grafana.yml'],
        sourceReferences: [{ path: 'crates/router/src/metrics.rs', commitSha: 'a'.repeat(40) }],
        contentHash: 'content-hash',
        diagrams: [{ type: 'flowchart', purpose: 'Data flow' }],
      })
    );
  });
});
