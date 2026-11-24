import { prepareChatMarkdownForMd4c } from '@/src/utils/markdownNativePreparation';
import { softWrapLongCodeFenceLines } from '@/src/utils/markdownSoftWrap';

// The shared renderer's own test for a body that ends in a list item (see
// `prepareMarkdownForNativeRender` in conversation-composer-markdown-body).
const LIST_PATTERN = /(?:^|\n)[ \t]{0,3}(?:\d+[.)]|[-+*])[ \t]+/;
const TRAILING_LIST_ITEM_PATTERN = /(?:^|\n)[ \t]{0,8}(?:\d+[.)]|[-+*])[ \t]+[^\n]*$/;
const GUARD_TAIL = '\n​';

/**
 * Whether the shared markdown renderer ends this body with its invisible
 * guard line: it adds one after a closing list item or code block so the
 * native text measures the last line in full. That line is empty but still
 * takes a line of height, which reads as a gap under the words.
 */
export function bodyEndsWithGuardLine(markdown: string): boolean {
  const source = softWrapLongCodeFenceLines(markdown);
  if (LIST_PATTERN.test(source) && TRAILING_LIST_ITEM_PATTERN.test(source.trimEnd())) return true;
  return prepareChatMarkdownForMd4c(source).endsWith(GUARD_TAIL);
}
