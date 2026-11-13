/**
 * A message the way its author wrote it: HTML when they wrote HTML, text
 * otherwise. The box these come from is a prose box, so a plain message has to
 * survive exactly as typed — newlines kept, `*` and `#` meaning themselves.
 *
 * HTML goes through `MarkdownView`, which parses and **sanitizes** it (it never
 * uses `dangerouslySetInnerHTML`). That matters here: these strings carry
 * `{{variable}}` interpolations, which is how data the author never saw arrives.
 */
import { MarkdownView } from './MarkdownView.js';

/**
 * A void tag, or a matched open/close pair. The backreference is what keeps
 * prose out: `price < 10` and `Hi <your name>` never close, so they stay text.
 */
const HTML_RE = /<(?:br|hr|img)\b[^>]*\/?>|<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*?<\/\1\s*>/i;

export const isHtml = (text: string) => HTML_RE.test(text);

export function MessageText({ text }: { text: string }) {
  return isHtml(text) ? (
    // `bare` so the bubble keeps owning its size and colour.
    <MarkdownView bare className="wui-message">{text}</MarkdownView>
  ) : (
    <span className="whitespace-pre-wrap">{text}</span>
  );
}
