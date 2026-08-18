import { mutateWikiMarkdownSection } from '../../../src/sdlc/wiki/wikiSectionMutation';

describe('mutateWikiMarkdownSection', () => {
  const page = '# System\n\nIntro.\n\n## Flow\n\nOld flow.\n\n### Detail\n\nKeep with flow.\n\n## Failure\n\nRetries.\n';

  it('replaces one complete headed section and preserves siblings', () => {
    expect(
      mutateWikiMarkdownSection({
        markdown: page,
        action: 'replace_section',
        heading: 'Flow',
        sectionMarkdown: '## Flow\n\nNew flow.',
      })
    ).toBe('# System\n\nIntro.\n\n## Flow\n\nNew flow.\n\n## Failure\n\nRetries.\n');
  });

  it('inserts after the selected section', () => {
    const result = mutateWikiMarkdownSection({
      markdown: page,
      action: 'insert_section',
      heading: 'Flow',
      sectionMarkdown: '## Operations\n\nMetrics.',
    });
    expect(result.indexOf('## Operations')).toBeLessThan(result.indexOf('## Failure'));
  });

  it('rejects missing and duplicate headings', () => {
    expect(() =>
      mutateWikiMarkdownSection({ markdown: page, action: 'remove_section', heading: 'Unknown' })
    ).toThrow('[SECTION_NOT_FOUND]');
    expect(() =>
      mutateWikiMarkdownSection({
        markdown: `${page}\n## Flow\nAgain.`,
        action: 'remove_section',
        heading: 'Flow',
      })
    ).toThrow('[SECTION_AMBIGUOUS]');
  });

  it('ignores heading-like text inside fenced diagrams', () => {
    const markdown = '# Page\n\n```mermaid\n# Not a heading\n```\n\n## Real\nText.\n';
    expect(
      mutateWikiMarkdownSection({ markdown, action: 'remove_section', heading: 'Real' })
    ).toContain('```mermaid\n# Not a heading\n```');
  });
});
