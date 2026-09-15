const LANGUAGE_CLASS_RE = /(?:^|\s)language-([\w+-]+)(?:\s|$)/;

export function markdownCodeLanguage(className: string | undefined): string {
  return LANGUAGE_CLASS_RE.exec(className ?? '')?.[1] ?? '';
}

export function isMarkdownCodeBlock(className: string | undefined, source: string): boolean {
  // react-markdown supplies language-* for tagged fences. Untagged fences have
  // no class, but their code text retains the terminal newline; inline code
  // does not. Supporting both avoids silently flattening plain fenced blocks.
  return Boolean(markdownCodeLanguage(className)) || source.endsWith('\n');
}
