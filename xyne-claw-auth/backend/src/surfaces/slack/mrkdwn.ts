import { slackifyMarkdown } from "slackify-markdown";
import { SLACK_TEXT_LIMIT, TRUNCATED_SUFFIX } from "./const.js";

export function truncateSlackText(text: string, limit = SLACK_TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  if (limit <= TRUNCATED_SUFFIX.length) return TRUNCATED_SUFFIX.slice(0, limit);
  return `${text.slice(0, limit - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`;
}

export function prepareSlackResultText(markdown: string): string {
  return truncateSlackText(slackifyMarkdown(markdown));
}
