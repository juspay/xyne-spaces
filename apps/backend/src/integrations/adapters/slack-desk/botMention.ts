// Text-based, not `event.type === 'app_mention'`: that needs the app_mentions:read scope,
// which desk-ingestion apps usually don't have. Slack already stamps the bot's own user id
// on every event as `authorizations[0].user_id` — no auth.test call needed.
export function extractBotUserId(payload: any): string | undefined {
  return payload?.authorizations?.[0]?.user_id;
}

/** Does this message text @-mention the given Slack user id (Slack's own `<@U…>` token)? */
export function textMentionsBot(text: string | undefined, botUserId: string | undefined): boolean {
  return !!text && !!botUserId && text.includes(`<@${botUserId}>`);
}
