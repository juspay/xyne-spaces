import { plainTextToHtml } from '@/src/utils/plainTextToHtml';

/** Full document wrapper required by `EnrichedTextInput.setValue`. */
function wrapForEnrichedSetValue(fragment: string): string {
  const trimmed = fragment.trim();
  if (trimmed.length === 0) return fragment;
  if (/^<html\b/i.test(trimmed) && /<\/html>\s*$/i.test(trimmed)) {
    return fragment;
  }
  return `<html>${fragment}</html>`;
}

/** Inner body of `<html>…</html>` (empty string when wrapper missing). */
function composerDocumentBody(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return '';
  if (/^<html\b/i.test(trimmed) && /<\/html>\s*$/i.test(trimmed)) {
    return trimmed
      .replace(/^<html\b[^>]*>/i, '')
      .replace(/<\/html>\s*$/i, '')
      .trim();
  }
  return trimmed;
}

/**
 * True when the composer has no meaningful blocks yet.
 * Matches empty `<html></html>` and TipTap-style blank `<p></p>`.
 */
function isBlankComposerHtml(html: string): boolean {
  const body = composerDocumentBody(html);
  if (body.length === 0) return true;
  return /^<p(\s[^>]*)?>\s*(<br\s*\/?>)?\s*<\/p>$/i.test(body);
}

function appendInsideComposerParagraph(html: string, insert: string): string {
  const trimmed = html.trim();

  if (!trimmed || isBlankComposerHtml(trimmed)) {
    return wrapForEnrichedSetValue(`<p>${insert}</p>`);
  }

  const lastParagraphClose = trimmed.lastIndexOf('</p>');
  if (lastParagraphClose !== -1) {
    return wrapForEnrichedSetValue(
      `${trimmed.slice(0, lastParagraphClose)}${insert}${trimmed.slice(lastParagraphClose)}`,
    );
  }

  // `<html>` wrapper without paragraphs — never append directly under `<html>`.
  if (/<\/html>\s*$/i.test(trimmed)) {
    return wrapForEnrichedSetValue(trimmed.replace(/<\/html>\s*$/i, `<p>${insert}</p></html>`));
  }

  return wrapForEnrichedSetValue(`${trimmed}${insert}`);
}

/**
 * Append plain characters (emoji, spacing) to the current composer HTML without
 * replacing mention tags or other rich markup.
 */
export function appendTextToComposerHtml(html: string, append: string, plainBody: string): string {
  if (!append) return html;

  const trimmed = html.trim();
  if (!trimmed || isBlankComposerHtml(trimmed)) {
    return wrapForEnrichedSetValue(plainTextToHtml(plainBody));
  }

  return appendInsideComposerParagraph(trimmed, append);
}

/**
 * Append raw markup (e.g. a native `<img>`) at the end of the last paragraph.
 * Unlike `appendTextToComposerHtml`, empty documents keep the markup instead of
 * rebuilding from a plain-text body — custom emoji must not collapse to `:name:`.
 */
export function appendMarkupToComposerHtml(html: string, markup: string): string {
  if (!markup) return html;
  return appendInsideComposerParagraph(html, markup);
}
