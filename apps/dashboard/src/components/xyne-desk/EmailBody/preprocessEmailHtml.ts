const MSO_CONDITIONAL_RE = /<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi;
const STYLE_TAG_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const SCRIPT_TAG_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const OFFICE_NS_TAG_RE = /<\/?(?:o|v|w|x|m|st1):[^>]*>/gi;
const OFFICE_NS_SELFCLOSE_RE = /<(?:o|v|w|x|m|st1):[^>]*\/>/gi;

export const preprocessEmailHtml = (raw: string): string => {
  if (!raw) return '';

  let html = raw;

  html = html.replace(MSO_CONDITIONAL_RE, '');
  html = html.replace(SCRIPT_TAG_RE, '');
  html = html.replace(STYLE_TAG_RE, '');
  html = html.replace(OFFICE_NS_SELFCLOSE_RE, '');
  html = html.replace(OFFICE_NS_TAG_RE, '');

  const headMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (headMatch && headMatch[1] !== undefined) {
    html = headMatch[1];
  }

  return html;
};
