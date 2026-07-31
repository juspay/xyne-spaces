/** Mirrors apps/backend/src/utils/replyQuote.ts — dashboard has no shared-utils access to it. */

const escapeHtml = (raw: string): string =>
  raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface PrevEmail {
  from: string;
  body: string;
  createdAt: Date | number;
}

export const buildQuotedTrailHtml = (prev: PrevEmail): string => {
  const date = prev.createdAt instanceof Date ? prev.createdAt : new Date(prev.createdAt);
  const dateLabel = date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const attribution = `On ${escapeHtml(dateLabel)}, ${escapeHtml(prev.from)} wrote:`;
  return `<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">${attribution}<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${prev.body}</blockquote></div>`;
};
