class WikiSectionMutationError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'WikiSectionMutationError';
  }
}

interface MarkdownSection {
  start: number;
  end: number;
  level: number;
  heading: string;
}

function normalizedHeading(value: string): string {
  return value.trim().replace(/^#{1,6}\s+/, '').trim().toLocaleLowerCase();
}

function sections(markdown: string): MarkdownSection[] {
  const lines = markdown.split('\n');
  const headings: Array<Omit<MarkdownSection, 'end'>> = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      headings.push({ start: index, level: match[1]!.length, heading: match[2]! });
    }
  }
  return headings.map((heading, index) => ({
    ...heading,
    end:
      headings.slice(index + 1).find(candidate => candidate.level <= heading.level)?.start ??
      lines.length,
  }));
}

export function mutateWikiMarkdownSection(input: {
  markdown: string;
  action: 'replace_section' | 'insert_section' | 'remove_section';
  heading: string;
  sectionMarkdown?: string;
}): string {
  const matches = sections(input.markdown).filter(
    section => normalizedHeading(section.heading) === normalizedHeading(input.heading)
  );
  if (matches.length !== 1) {
    throw new WikiSectionMutationError(
      matches.length === 0
        ? `[SECTION_NOT_FOUND] Wiki section not found: ${input.heading}`
        : `[SECTION_AMBIGUOUS] Wiki section heading is not unique: ${input.heading}`,
      409
    );
  }
  const target = matches[0]!;
  const lines = input.markdown.split('\n');
  const replacement = input.sectionMarkdown?.trim();
  if (input.action !== 'remove_section') {
    if (!replacement) throw new WikiSectionMutationError('Section Markdown is required', 400);
    const replacementHeading = sections(replacement)[0];
    if (!replacementHeading || replacementHeading.start !== 0) {
      throw new WikiSectionMutationError('Section Markdown must start with a Markdown heading', 400);
    }
  }
  const replacementLines = replacement?.split('\n') ?? [];
  const next =
    input.action === 'insert_section'
      ? [...lines.slice(0, target.end), '', ...replacementLines, ...lines.slice(target.end)]
      : [
          ...lines.slice(0, target.start),
          ...replacementLines,
          ...(replacementLines.length > 0 && lines[target.end]?.trim() ? [''] : []),
          ...lines.slice(target.end),
        ];
  return `${next.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
