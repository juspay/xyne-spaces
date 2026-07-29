const HAS_EXISTING_QUOTE_MARKERS: RegExp[] = [
  /<div[^>]*\bclass=["']?[^"'>]*\bgmail_quote\b/i,
  /<blockquote[^>]*\bclass=["']?[^"'>]*\bgmail_quote\b/i,
  /<div[^>]*\bid=["']?appendonsend["']?/i, // Outlook web
  /<div[^>]*\bid=["']?divRplyFwdMsg["']?/i, // Outlook desktop
  /<p[^>]*>\s*<b>\s*From:\s*<\/b>/i, // Outlook plain
  /<div[^>]*\bclass=["']?[^"'>]*\byahoo_quoted\b/i,
  /<blockquote[^>]*\btype=["']?cite["']?/i, // Apple Mail / Mozilla
  /<div[^>]*\bclass=["']?[^"'>]*\bmoz-cite-prefix\b/i,
];

const hasExistingQuote = (body: string): boolean =>
  HAS_EXISTING_QUOTE_MARKERS.some(re => re.test(body));

const escapeHtml = (raw: string): string =>
  raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface PrevEmail {
  from: string;
  body: string;
  createdAt: Date | number;
}

export const appendReplyQuote = (body: string, prev: PrevEmail): string => {
  if (!prev?.body) return body;
  if (hasExistingQuote(body)) return body;

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
  const quote = [
    `<br>`,
    `<div class="gmail_quote gmail_quote_container">`,
    `<div dir="ltr" class="gmail_attr">${attribution}<br></div>`,
    `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">`,
    prev.body,
    `</blockquote>`,
    `</div>`,
  ].join('');

  return `${body}${quote}`;
};
