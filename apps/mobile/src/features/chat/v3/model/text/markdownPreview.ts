/** §8.1 reuse gate: **Adopt**. Characterised against v2 markdownPreview. Pure. */

const INLINE_IMAGE_GUARD_PATTERN = /\u2060/g;

export const stripMarkdownForPreview = (markdown: string): string => {
  if (!markdown) return '';

  return markdown
    .replace(INLINE_IMAGE_GUARD_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/```(?:[A-Za-z0-9_-]+)?\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^\s{0,3}[-+*]\s+/gm, '• ')
    .replace(/^\s{0,3}(\d+)[.)]\s+/gm, '$1. ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
