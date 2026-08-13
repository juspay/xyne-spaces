import { validateWikiMermaid } from '../../../src/sdlc/wiki/wikiMermaidValidation';

describe('validateWikiMermaid', () => {
  it.each([
    ['flowchart', 'flowchart LR\nA --> B'],
    ['sequenceDiagram', 'sequenceDiagram\nA->>B: request'],
    ['stateDiagram-v2', 'stateDiagram-v2\n[*] --> Ready'],
    ['erDiagram', 'erDiagram\nUSER ||--o{ ORDER : places'],
  ])('accepts evidence-backed %s source in ordinary Markdown', (type, source) => {
    expect(validateWikiMermaid(`# Page\n\n\`\`\`mermaid\n${source}\n\`\`\``)).toEqual([
      { type, source },
    ]);
  });

  it('accepts no diagram as a valid editorial choice', () => {
    expect(validateWikiMermaid('# Failure policy\n\nThree retries.')).toEqual([]);
  });

  it.each([
    ['unclosed fence', '```mermaid\nflowchart LR\nA-->B', 'INVALID_MERMAID'],
    ['unknown grammar', '```mermaid\nunknownDiagram\nA-->B\n```', 'INVALID_MERMAID'],
    ['external click', '```mermaid\nflowchart LR\nA-->B\nclick A "https://evil.example"\n```', 'UNSAFE_MERMAID'],
  ])('rejects %s', (_name, markdown, code) => {
    expect(() => validateWikiMermaid(markdown)).toThrow(code);
  });
});
