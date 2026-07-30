import type { PartialBlock } from '@blocknote/core';

export const DEFAULT_CANVAS_TITLE = 'Untitled Canvas';
export const MAX_CANVAS_TITLE_LENGTH = 100;
export const MIN_CANVAS_TITLE_CONTENT_LENGTH = 20;
export const MAX_CANVAS_TITLE_CONTENT_LENGTH = 15_000;

export function isUntitledCanvasTitle(title: string | null | undefined): boolean {
  const normalized = title?.trim().toLocaleLowerCase();
  return !normalized || normalized === DEFAULT_CANVAS_TITLE.toLocaleLowerCase();
}

function collectContentText(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text) output.push(text);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectContentText(item, output));
    return;
  }

  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (typeof record['text'] === 'string') {
    const text = record['text'].trim();
    if (text) output.push(text);
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (
      key === 'text' ||
      key === 'type' ||
      key === 'props' ||
      key === 'id' ||
      key === 'url' ||
      key === 'href'
    ) {
      continue;
    }
    collectContentText(nestedValue, output);
  }
}

function extractBlockText(block: PartialBlock): string {
  const output: string[] = [];
  collectContentText((block as { content?: unknown }).content, output);
  return output.join(' ').replace(/\s+/g, ' ').trim();
}

function cleanTitleCandidate(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenBlocks(blocks: PartialBlock[], output: PartialBlock[]): void {
  for (const block of blocks) {
    output.push(block);
    const children = (block as { children?: PartialBlock[] }).children;
    if (Array.isArray(children)) flattenBlocks(children, output);
  }
}

export function extractCanvasPlainText(blocks: PartialBlock[] | undefined): string {
  if (!blocks?.length) return '';

  const flattened: PartialBlock[] = [];
  flattenBlocks(blocks, flattened);

  return flattened
    .map(extractBlockText)
    .filter(Boolean)
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CANVAS_TITLE_CONTENT_LENGTH);
}

export function hasMeaningfulCanvasContent(blocks: PartialBlock[] | undefined): boolean {
  return extractCanvasPlainText(blocks).length >= MIN_CANVAS_TITLE_CONTENT_LENGTH;
}

export function deriveFallbackCanvasTitle(blocks: PartialBlock[] | undefined): string {
  if (!blocks?.length) return '';

  const flattened: PartialBlock[] = [];
  flattenBlocks(blocks, flattened);
  const heading = flattened.find(block => (block as { type?: string }).type === 'heading');
  const source = cleanTitleCandidate(
    (heading ? extractBlockText(heading) : '') ||
      flattened.map(extractBlockText).find(Boolean) ||
      '',
  );

  if (source.length <= MAX_CANVAS_TITLE_LENGTH) return source;
  return `${source.slice(0, MAX_CANVAS_TITLE_LENGTH - 3).trimEnd()}...`;
}
