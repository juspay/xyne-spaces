class WikiMermaidValidationError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = 'WikiMermaidValidationError';
  }
}

const ALLOWED_DIAGRAM_START =
  /^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|classDiagram)\b/;

export interface WikiMermaidDiagram {
  type: string;
  source: string;
}

/**
 * Validate the bounded, security-relevant Mermaid structure at the trusted
 * write boundary. The browser renderer remains responsible for the full
 * grammar and shows a safe inline parse error for errors this lightweight
 * check cannot know without a DOM.
 */
export function validateWikiMermaid(markdown: string): WikiMermaidDiagram[] {
  const lines = markdown.split('\n');
  const diagrams: WikiMermaidDiagram[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== '```mermaid') continue;
    const closingIndex = lines.slice(index + 1).findIndex(line => line.trim() === '```');
    if (closingIndex < 0) {
      throw new WikiMermaidValidationError('[INVALID_MERMAID] Mermaid fence is not closed');
    }
    const end = index + 1 + closingIndex;
    const source = lines.slice(index + 1, end).join('\n').trim();
    const firstLine = source.split('\n').find(line => line.trim())?.trim() ?? '';
    if (!ALLOWED_DIAGRAM_START.test(firstLine)) {
      throw new WikiMermaidValidationError(
        `[INVALID_MERMAID] Unsupported or missing diagram type: ${firstLine || '(empty)'}`
      );
    }
    if (/\b(?:click|href)\b|javascript:|<script|\bsecurityLevel\b/i.test(source)) {
      throw new WikiMermaidValidationError(
        '[UNSAFE_MERMAID] Mermaid links, scripts, and security directives are not allowed'
      );
    }
    diagrams.push({ type: firstLine.split(/\s+/)[0]!, source });
    index = end;
  }
  return diagrams;
}
