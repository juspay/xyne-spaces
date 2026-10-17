interface MarkdownSegment {
  kind: 'text' | 'code';
  value: string;
}

// A top-level fence; one still open at the end is a block mid-stream.
const FENCE_RE = /^ {0,3}```[^\n]*\n([\s\S]*?)(?:^ {0,3}```[ \t]*$|(?![\s\S]))/gm;

/** Splits an answer into prose and fenced code, so code can render with its own copy button. */
export function splitCodeBlocks(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const pushText = (text: string): void => {
    if (text.trim()) segments.push({ kind: 'text', value: text });
  };
  let end = 0;
  for (const match of markdown.matchAll(FENCE_RE)) {
    pushText(markdown.slice(end, match.index));
    segments.push({ kind: 'code', value: (match[1] ?? '').replace(/\n$/, '') });
    end = match.index + match[0].length;
  }
  pushText(markdown.slice(end));
  return segments;
}
