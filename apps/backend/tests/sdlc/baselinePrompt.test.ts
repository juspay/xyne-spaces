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
    });

    expect(prompt).toContain('action: begin');
    for (const section of definition.sections) {
      expect(prompt).toContain(`sectionKey: ${section.key}`);
    }
    expect(prompt).toContain('action: finalize');
    expect(prompt.indexOf('action: begin')).toBeLessThan(prompt.indexOf('action: finalize'));
  });

  it('requires repository-scoped Wiki evidence before drafting the baseline', () => {
    const prompt = buildBaselineExecutionPrompt({
      repoId: 'repo-pets',
      repoName: 'Pets',
      repoUrl: 'https://github.com/github-samples/pets-workshop.git',
      baseBranch: 'main',
      channelId: 'channel-pets',
      setupExecutionId: 'setup-1',
      definition: BASELINE_DEFINITIONS[0],
    });

    expect(prompt).toContain('spaces-search');
    expect(prompt).toContain('type: canvas');
    expect(prompt).toContain('in: channel-pets');
    expect(prompt).toContain('spaces-read-canvas');
    expect(prompt).toContain('at most three high-value imported Wiki canvases');
    expect(prompt).toContain('never search for repoId');
    expect(prompt).not.toContain('Do not search Spaces');
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
      });

      expect(prompt).toContain(
        'All five approved baseline documents are automatically added to every SDLC and Ask AI session'
      );
      expect(prompt).toContain('compact navigation brief');
      expect(prompt).toContain('Keep each section at 120 words or fewer');
      expect(prompt).toContain('Supply section body Markdown');
      expect(prompt).toContain('never repeat the artifact title or the current section title');
      expect(prompt).toContain('**Explore deeper**');
      expect(prompt).toContain('links to the most relevant imported Wiki canvases');
      expect(prompt).toContain('exact repository-relative paths and symbols');
    }
  );
});
