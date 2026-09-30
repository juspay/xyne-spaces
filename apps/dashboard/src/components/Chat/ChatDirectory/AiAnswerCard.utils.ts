import type { CmdkAnswerSource } from '../../../types/search';
import { plain } from '../ChatInput/relatedContextDisplay';

export const SOURCE_HREF = '#cmdk-source-';

const CITATION = /\s*\[clf-(\d+)\]/g;
const PARTIAL_CITATION = /\s*\[(?:c(?:l(?:f(?:-\d*)?)?)?)?$/;

export const citationOrder = (content: string, sourceCount: number): number[] => {
  const order: number[] = [];
  for (const match of content.matchAll(CITATION)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= sourceCount && !order.includes(n)) order.push(n);
  }
  return order;
};

export const linkCitations = (content: string, order: number[]): string =>
  content
    .replace(CITATION, (_marker, n: string) => {
      const shown = order.indexOf(Number(n)) + 1;
      return shown > 0 ? `[${shown}](${SOURCE_HREF}${n})` : '';
    })
    .replace(PARTIAL_CITATION, '');

export const sourceNumberOf = (href: string | undefined): number | null =>
  href?.startsWith(SOURCE_HREF) ? Number(href.slice(SOURCE_HREF.length)) || null : null;

export const senderOf = (source: CmdkAnswerSource): string =>
  source.kind === 'thread' ? plain(source.result.subtitle).replace(/^By\s+/i, '') : '';
