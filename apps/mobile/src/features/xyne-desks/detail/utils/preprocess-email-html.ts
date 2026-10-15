import { replaceUntilStable } from '@/src/utils/htmlText';

const MSO_CONDITIONAL_RE = /<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi;
const STYLE_TAG_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const SCRIPT_TAG_RE = /<script\b[^>]*>[\s\S]*?<\/script(?:\s[^>]*)?>/gi;
const OFFICE_NS_TAG_RE = /<\/?(?:o|v|w|x|m|st1):[^>]*>/gi;
const OFFICE_NS_SELFCLOSE_RE = /<(?:o|v|w|x|m|st1):[^>]*\/>/gi;
const DANGEROUS_TAG_RE =
  /<\/?(?:script|iframe|object|embed|form|input|meta|link|base|svg|math)\b[^>]*>/gi;

/** Strip Outlook/Office noise and extract body — port of dashboard preprocessEmailHtml. */
export function preprocessEmailHtml(raw: string): string {
  if (!raw) return '';

  let html = raw;

  html = replaceUntilStable(html, MSO_CONDITIONAL_RE);
  html = replaceUntilStable(html, SCRIPT_TAG_RE);
  html = replaceUntilStable(html, STYLE_TAG_RE);
  html = replaceUntilStable(html, OFFICE_NS_SELFCLOSE_RE);
  html = replaceUntilStable(html, OFFICE_NS_TAG_RE);
  html = replaceUntilStable(html, DANGEROUS_TAG_RE);

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1] !== undefined) {
    html = bodyMatch[1];
  }

  return html;
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
