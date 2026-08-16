import { BASELINE_DEFINITIONS } from '../../src/sdlc/baselineDefinitions';
import { buildBaselineExecutionPrompt } from '../../src/sdlc/baselinePrompt';

describe('SDLC baseline execution prompt', () => {
  it('checkpoints every Core Code Map section before finalizing', () => {
    const definition = BASELINE_DEFINITIONS[0];
    const prompt = buildBaselineExecutionPrompt({
      repoId: 'repo-pets',
      repoName: 'Pets',
      repoUrl: 'https://github.com/github-samples/pets-workshop.git',
      baseBranch: 'main',
      channelId: 'channel-pets',
      setupExecutionId: 'setup-1',
      definition,
      wikiState: 'AVAILABLE',
      generationCommit: 'a'.repeat(40),
    });

    expect(prompt).toContain('action: begin');
    for (const section of definition.sections) {
      expect(prompt).toContain(`sectionKey: ${section.key}`);
    }
    expect(prompt).toContain('action: finalize');
    expect(prompt.indexOf('action: begin')).toBeLessThan(prompt.indexOf('action: finalize'));
  });

  it('uses completed Wiki evidence as orientation', () => {
    const prompt = buildBaselineExecutionPrompt({
      repoId: 'repo-pets',
      repoName: 'Pets',
      repoUrl: 'https://github.com/github-samples/pets-workshop.git',
      baseBranch: 'main',
      channelId: 'channel-pets',
      setupExecutionId: 'setup-1',
      definition: BASELINE_DEFINITIONS[0],
      wikiState: 'AVAILABLE',
      generationCommit: 'a'.repeat(40),
    });

    expect(prompt).toContain('spaces-search');
    expect(prompt).toContain('type: canvas');
    expect(prompt).toContain('in: channel-pets');
    expect(prompt).toContain('spaces-read-canvas');
    expect(prompt).toContain('at most three high-value Wiki canvases');
    expect(prompt).toContain('orientation evidence');
    expect(prompt).toContain('may describe an older commit');
    expect(prompt).toContain('never search for repoId');
    expect(prompt).not.toContain('Do not search Spaces');
  });

  it.each([
    ['GENERATING', 'Wiki generation is still in progress'],
    ['UNAVAILABLE', 'No completed current Wiki run is available'],
  ] as const)('reads existing Wiki with a warning when Wiki is %s', (wikiState, message) => {
    const prompt = buildBaselineExecutionPrompt({
      repoId: 'repo-pets',
      repoName: 'Pets',
      repoUrl: 'https://github.com/github-samples/pets-workshop.git',
      baseBranch: 'main',
      channelId: 'channel-pets',
      setupExecutionId: 'setup-1',
      definition: BASELINE_DEFINITIONS[0],
      wikiState,
      generationCommit: 'a'.repeat(40),
    });

    expect(prompt).toContain(message);
    expect(prompt).toContain('Call spaces-search once');
    expect(prompt).toContain('spaces-read-canvas');
    expect(prompt).toMatch(/partial, stale, or internally inconsistent|generation status and commit freshness are unknown/);
    expect(prompt).toContain('live pinned repository');
  });

  it.each(BASELINE_DEFINITIONS)(
    'keeps $title compact because baselines are loaded into every session',
    (definition) => {
      const prompt = buildBaselineExecutionPrompt({
        repoId: 'repo-pets',
        repoName: 'Pets',
        repoUrl: 'https://github.com/github-samples/pets-workshop.git',
        baseBranch: 'main',
        channelId: 'channel-pets',
        setupExecutionId: 'setup-1',
        definition,
        wikiState: 'AVAILABLE',
        generationCommit: 'a'.repeat(40),
      });

      expect(prompt).toContain(
        'All approved baseline documents are automatically added to every SDLC and Ask AI session'
      );
      expect(prompt).toContain('compact navigation brief');
      expect(prompt).toContain('Keep each section at 120 words or fewer');
      expect(prompt).toContain('Supply section body Markdown');
      expect(prompt).toContain('never repeat the artifact title or the current section title');
      expect(prompt).toContain('**Explore deeper**');
      expect(prompt).toContain('use direct Wiki canvas links');
      expect(prompt).toContain('exact repository-relative paths');
      expect(prompt).toContain('preserving the applicable freshness warning');
      expect(prompt).toContain('[[source:N]]');
      expect(prompt).toContain('sourceReferences');
      expect(prompt).toContain('Submit only after finalize succeeds');
    }
  );
});
