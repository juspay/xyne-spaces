const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

type SuggestionFields = {
  title: string;
  priority: string;
  description: string;
  assignee: string;
};

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const formatPriorityLabel = (priority: string): string => {
  const normalized = priority.trim().toLowerCase();
  const labels: Record<string, string> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  };
  return labels[normalized] ?? priority;
};

const readFoldedBlock = (
  lines: string[],
  startIndex: number,
): { value: string; endIndex: number } => {
  const indent = lines[startIndex + 1]?.match(/^(\s+)/)?.[1]?.length ?? 2;
  const parts: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index];
    if (!line || (line.trim() !== '' && !line.startsWith(' '.repeat(indent)))) break;
    if (line.trim()) parts.push(line.slice(indent).trim());
    index += 1;
  }

  return { value: parts.join(' '), endIndex: index - 1 };
};

const parseSuggestions = (yaml: string): SuggestionFields[] => {
  const lines = yaml.split('\n');
  const suggestions: SuggestionFields[] = [];
  let current: SuggestionFields | null = null;
  let inSuggestions = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line) {
      index += 1;
      continue;
    }

    if (line === 'suggestions:') {
      inSuggestions = true;
      index += 1;
      continue;
    }

    if (inSuggestions && /^[^\s-]/.test(line)) break;
    if (!inSuggestions) {
      index += 1;
      continue;
    }

    if (/^\s*-\s/.test(line)) {
      if (current?.title) suggestions.push(current);
      current = { title: '', priority: '', description: '', assignee: '' };
      const inline = line.replace(/^\s*-\s*/, '');
      const match = inline.match(/^([\w]+):\s*(.*)$/);
      if (match?.[1] === 'title') current.title = unquote(match[2] ?? '');
      index += 1;
      continue;
    }

    if (current) {
      const match = line.match(/^\s+([\w]+):\s*(.*)$/);
      if (!match?.[1]) {
        index += 1;
        continue;
      }
      const key = match[1];
      const rawValue = match[2] ?? '';
      if (rawValue === '>-' || rawValue === '>' || rawValue === '|-' || rawValue === '|') {
        const block = readFoldedBlock(lines, index);
        if (key === 'description') current.description = block.value;
        index = block.endIndex + 1;
        continue;
      }
      const value = unquote(rawValue);
      if (key === 'title') current.title = value;
      if (key === 'priority') current.priority = value;
      if (key === 'description') current.description = value;
      if (key === 'assignee') current.assignee = value;
    }

    index += 1;
  }

  if (current?.title) suggestions.push(current);
  return suggestions;
};

export const isCallSuggestedTicketsMessage = (metadata: unknown): boolean => {
  if (!metadata || typeof metadata !== 'object') return false;
  const record = metadata as Record<string, unknown>;
  return (
    record['messageSubtype'] === 'call_suggested_tickets' || record['hasSuggestedTickets'] === true
  );
};

const formatSuggestionBlock = (suggestion: SuggestionFields, index: number): string[] => {
  const meta: string[] = [];
  if (suggestion.priority.trim()) {
    meta.push(formatPriorityLabel(suggestion.priority));
  }
  if (suggestion.assignee.trim()) {
    meta.push(suggestion.assignee.trim());
  }

  const lines = [`**${index + 1}. ${suggestion.title.trim()}**`];
  if (meta.length > 0) {
    lines.push(`*${meta.join(' · ')}*`);
  }
  if (suggestion.description.trim()) {
    lines.push('');
    lines.push(suggestion.description.trim());
  }
  return lines;
};

/** Strip YAML frontmatter and render suggestions as readable markdown. */
export const formatCallSuggestedTicketsMarkdown = (markdown: string): string | null => {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) return null;

  const suggestions = parseSuggestions(match[1] ?? '');
  if (suggestions.length === 0) return null;

  const lines = ['## Suggested Tickets', ''];
  suggestions.forEach((suggestion, index) => {
    lines.push(...formatSuggestionBlock(suggestion, index));
    if (index < suggestions.length - 1) {
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  });

  return lines.join('\n').trim();
};
