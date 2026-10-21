const PAUSED_REASONS: Record<string, string> = {
  PROVIDER_AUTH: "Slack stopped accepting the app's token. Ask an admin to reconnect Slack.",
  CHANNEL_GONE: 'The Slack channel was archived, or the app was removed from it.',
  NOT_CONFIGURED: 'Slack was disconnected for this workspace.',
};

const SIGN_IN_ERRORS: Record<string, string> = {
  EXPIRED: 'The Slack sign-in link expired. Try again.',
  NOT_CONFIGURED: "Slack isn't connected for this workspace.",
  VALIDATION_ERROR: "Couldn't connect that Slack account. Use the one in this workspace's Slack.",
};

export const appLabel = (appName: string | null | undefined): string => appName || 'the Mirror app';

export const pausedReasonText = (reason: string | null): string =>
  (reason && PAUSED_REASONS[reason]) || 'Paused by a channel admin.';

export const signInErrorText = (code: string): string =>
  SIGN_IN_ERRORS[code] ?? "Couldn't connect your Slack. Try again.";
