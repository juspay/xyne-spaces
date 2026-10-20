export type AnswerLinkTarget = { kind: 'chat'; channelId: string };

// The dashboard's DM route; `chat/dir/…` links already open natively through the message deep links.
const DM_LINK = /^\/([^/?#]+)\/chat\/dm\/([^/?#]+)\/?(?:[?#].*)?$/;

/**
 * The screen a dashboard link in an answer stands for, when it belongs to the workspace
 * the app is in. Everything else keeps going through the usual link handling.
 */
export function answerLinkTarget(
  url: string,
  appOrigin: string,
  workspaceId: string | null,
): AnswerLinkTarget | undefined {
  const origin = appOrigin.replace(/\/$/, '');
  if (!url.startsWith(`${origin}/`)) return undefined;
  const dm = url.slice(origin.length).match(DM_LINK);
  return dm && dm[1] === workspaceId && dm[2] !== 'compose'
    ? { kind: 'chat', channelId: dm[2]! }
    : undefined;
}
