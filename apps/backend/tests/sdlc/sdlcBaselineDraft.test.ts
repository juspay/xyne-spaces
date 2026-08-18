import {
  applyBaselineDraftSection,
  baselineRefreshChanged,
  baselineDraftMissingSections,
  buildBaselineDraftMarkdown,
  finalizeBaselineMetadata,
  isCompletedBaselineMetadata,
} from '../../src/sdlc/sdlcBaselineDraft';
import { BASELINE_DEFINITIONS } from '../../src/sdlc/baselineDefinitions';

describe('SDLC baseline draft lifecycle', () => {
  it('persists sections incrementally and counts the baseline only after finalization', () => {
    const initialMetadata = {
      surface: 'SDLC',
      artifactKind: 'BASELINE',
      baselineKind: 'CORE_CODE_MAP',
      generationStatus: 'GENERATING',
      draftSections: {},
    };

    const withArchitecture = applyBaselineDraftSection(initialMetadata, {
      sectionKey: 'architecture',
      sectionTitle: 'Architecture and boundaries',
      markdown: 'The Flask backend lives in `app/server/app.py`.',
      sourceReferences: [
        { path: 'app/server/app.py', commitSha: 'a'.repeat(40), symbol: 'app' },
      ],
    });

    expect(isCompletedBaselineMetadata(withArchitecture)).toBe(false);
    expect(
      buildBaselineDraftMarkdown('Core Code Map', 'CORE_CODE_MAP', withArchitecture)
    ).toContain('The Flask backend lives in `app/server/app.py`.');
    expect(baselineDraftMissingSections('CORE_CODE_MAP', withArchitecture)).toContain(
      'entrypoints'
    );

    expect(() => finalizeBaselineMetadata('CORE_CODE_MAP', withArchitecture)).toThrow(
      'missing sections'
    );

    const completeDraft = BASELINE_DEFINITIONS[0].sections
      .filter((section) => section.key !== 'architecture')
      .reduce(
      (metadata, section) =>
        applyBaselineDraftSection(metadata, {
          sectionKey: section.key,
          sectionTitle: section.title,
          markdown: `Evidence for ${section.title}`,
        }),
        withArchitecture
      );
    const finalized = finalizeBaselineMetadata('CORE_CODE_MAP', completeDraft);
    expect(isCompletedBaselineMetadata(finalized)).toBe(true);
    expect(finalized).not.toHaveProperty('draftSections');
    expect(finalized.sdlcSourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'app/server/app.py', commitSha: 'a'.repeat(40) }),
      ])
    );
  });

  it('renders renderer-owned document and section headings only once', () => {
    const metadata = applyBaselineDraftSection(
      {
        artifactKind: 'BASELINE',
        baselineKind: 'CORE_CODE_MAP',
        generationStatus: 'GENERATING',
        draftSections: {},
      },
      {
        sectionKey: 'architecture',
        sectionTitle: 'Architecture and boundaries',
        markdown: `# Core Code Map

## Architecture and boundaries

- The backend lives in \`app/server/app.py\`.`,
      }
    );

    const markdown = buildBaselineDraftMarkdown('Core Code Map', 'CORE_CODE_MAP', metadata);

    expect(markdown.match(/^# Core Code Map$/gm)).toHaveLength(1);
    expect(markdown.match(/^## Architecture and boundaries$/gm)).toHaveLength(1);
    expect(markdown).toContain('- The backend lives in `app/server/app.py`.');
  });

  it('treats legacy baselines without generationStatus as completed', () => {
    expect(
      isCompletedBaselineMetadata({
        surface: 'SDLC',
        artifactKind: 'BASELINE',
        baselineKind: 'RUN_GUIDE',
      })
    ).toBe(true);
  });

  it('does not treat an unknown generation state as completed', () => {
    expect(
      isCompletedBaselineMetadata({
        artifactKind: 'BASELINE',
        generationStatus: 'FAILED',
      })
    ).toBe(false);
  });

  it('rewrites only materially changed refresh output', () => {
    expect(baselineRefreshChanged('# Guide\r\n\r\nSame\n', '# Guide\n\nSame')).toBe(false);
    expect(baselineRefreshChanged('# Guide\n\nOld', '# Guide\n\nNew')).toBe(true);
  });
});
