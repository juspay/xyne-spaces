const SLACK_TEXT_LIMIT = 39_000;
const TRUNCATED_SUFFIX = "… (truncated)";

/** Convert the small Markdown subset emitted by agents into Slack mrkdwn. */
export function markdownToSlackMrkdwn(markdown: string): string {
  return markdown
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
}

export function truncateSlackText(text: string, limit = SLACK_TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  if (limit <= TRUNCATED_SUFFIX.length) return TRUNCATED_SUFFIX.slice(0, limit);
  return `${text.slice(0, limit - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`;
}

export function prepareSlackResultText(markdown: string): string {
  return truncateSlackText(markdownToSlackMrkdwn(markdown));
}

