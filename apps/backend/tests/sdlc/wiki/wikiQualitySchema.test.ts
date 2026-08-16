import {
  refreshSdlcWikiRunSchema,
  startSdlcWikiRunSchema,
} from '../../../../../packages/shared/src/sdlc';

describe('Wiki quality request schemas', () => {
  it('defaults new generation and refresh requests to Standard', () => {
    expect(startSdlcWikiRunSchema.parse({})).toMatchObject({
      historyRange: { kind: 'FULL' },
      chunkSize: 1,
      quality: 'STANDARD',
    });
    expect(refreshSdlcWikiRunSchema.parse({})).toMatchObject({
      chunkSize: 1,
      quality: 'STANDARD',
    });
  });

  it.each(['QUICK', 'STANDARD'] as const)('accepts %s for new Wiki runs', (quality) => {
    expect(startSdlcWikiRunSchema.parse({ quality }).quality).toBe(quality);
    expect(refreshSdlcWikiRunSchema.parse({ quality }).quality).toBe(quality);
  });

  it('rejects the retired Thorough quality for new Wiki runs', () => {
    expect(() => startSdlcWikiRunSchema.parse({ quality: 'THOROUGH' })).toThrow();
    expect(() => refreshSdlcWikiRunSchema.parse({ quality: 'THOROUGH' })).toThrow();
  });
});
