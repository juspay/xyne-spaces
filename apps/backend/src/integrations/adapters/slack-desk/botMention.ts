// Text match, not `app_mention` events: those need the app_mentions:read scope desk apps usually lack.
export function extractBotUserId(payload: any): string | undefined {
  return payload?.authorizations?.[0]?.user_id;
}

export function textMentionsBot(text: string | undefined, botUserId: string | undefined): boolean {
  return !!text && !!botUserId && text.includes(`<@${botUserId}>`);
}
