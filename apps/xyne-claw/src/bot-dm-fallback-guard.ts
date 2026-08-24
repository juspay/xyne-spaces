export const BOT_DM_FALLBACK_REASON =
  "A bot DM attempt failed earlier in this run; approve only if you want this fallback to be posted as you to the shown destination.";

export function isBotDmSendFailure(
  serverType: string,
  toolName: string,
  params: Record<string, unknown>,
  content: string,
): boolean {
  return serverType === "xyne-spaces-app-tools" &&
    toolName === "apps-send-message" &&
    typeof params["targetUserId"] === "string" &&
    /apps-send-message error/i.test(content);
}

export function withUserSendFallbackReason(
  serverType: string,
  toolName: string,
  params: Record<string, unknown>,
  fallbackReason: string | null,
): Record<string, unknown> {
  if (
    serverType !== "xyne-spaces" ||
    toolName !== "user-send-message" ||
    !fallbackReason ||
    typeof params["fallbackReason"] === "string"
  ) {
    return params;
  }
  return { ...params, fallbackReason };
}
