import { updateSdlcClawArtifactSchema } from '../../../../packages/shared/src/sdlc';

describe('SDLC artifact tool contracts', () => {
  const common = {
    repoId: 'repo-1',
    kind: 'PRD' as const,
    markdown: '# Updated PRD',
    sourceReferences: [],
  };

  it('accepts the canonical canvas ID used by SDLC canvas URLs', () => {
    const result = updateSdlcClawArtifactSchema.safeParse({
      ...common,
      canvasId: 'canvas-1',
    });

    expect(result.success).toBe(true);
  });

  it('requires an artifact identity', () => {
    const result = updateSdlcClawArtifactSchema.safeParse(common);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['canvasId'], message: 'Required' }),
      ]),
    );
  });
});
