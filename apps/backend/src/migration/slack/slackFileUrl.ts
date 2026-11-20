/** File URLs come from Slack API responses; the bot token only goes back to https slack.com hosts. */
export function isSlackFileUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (h === 'slack.com' || h.endsWith('.slack.com'));
  } catch {
    return false;
  }
}
