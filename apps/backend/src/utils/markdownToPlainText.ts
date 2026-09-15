import removeMarkdown from 'remove-markdown';

/** Convert GitHub-flavoured Markdown to readable plain text while retaining bullets. */
export function markdownToPlainText(markdown: string): string {
  return removeMarkdown(markdown, {
    gfm: true,
    stripListLeaders: true,
    listUnicodeChar: '•',
    useImgAltText: true,
  })
    // remove-markdown preserves indentation between the bullet and its text.
    .replace(/•[ \t]*\n[ \t]*/g, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
