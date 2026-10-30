/**
 * Online-meeting links the Xyne Automatic notetaker bot can join: Google Meet and
 * Microsoft Teams. Used by the backend (sending the bot, calendar auto-join) and the
 * dashboard (the "add notetaker" box). apps/meet-bot/src/meetingUrl.ts mirrors the
 * same rules on the bot's side.
 */

export type MeetingPlatform = 'google_meet' | 'teams';

export interface MeetingLink {
  platform: MeetingPlatform;
  /** Short id for titles and logs, e.g. "abc-defg-hij" or a Teams meeting id. */
  code: string;
  /** Canonical join URL: the same meeting always gives the same string. */
  url: string;
}

export const MEETING_PLATFORM_LABELS: Record<MeetingPlatform, string> = {
  google_meet: 'Google Meet',
  teams: 'Microsoft Teams',
};

const TEAMS_HOSTS = new Set(['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft']);
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Outlook rewrites links in invites as safelinks.protection.outlook.com/?url=<link>. */
function unwrapSafeLink(url: URL): URL {
  if (!url.hostname.endsWith('safelinks.protection.outlook.com')) return url;
  const inner = url.searchParams.get('url');
  try {
    return inner ? new URL(inner) : url;
  } catch {
    return url;
  }
}

/** The meeting a single URL points to, or null when it isn't a supported meeting link. */
export function parseMeetingLink(raw: string): MeetingLink | null {
  const text = raw.trim();
  let url: URL;
  try {
    url = unwrapSafeLink(new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'meet.google.com') {
    const code = segments[0]?.toLowerCase();
    if (segments.length !== 1 || !code || !MEET_CODE.test(code)) return null;
    return { platform: 'google_meet', code, url: `https://meet.google.com/${code}` };
  }

  if (!TEAMS_HOSTS.has(host)) return null;
  // Classic: /l/meetup-join/<thread id>/<message id>?context={"Tid":…,"Oid":…}
  if (segments[0] === 'l' && segments[1] === 'meetup-join' && segments[2]) {
    const thread = safeDecode(segments[2]);
    const message = safeDecode(segments[3] ?? '0');
    const canonical = new URL(
      `https://${host}/l/meetup-join/${encodeURIComponent(thread)}/${encodeURIComponent(message)}`,
    );
    const context = url.searchParams.get('context');
    if (context) canonical.searchParams.set('context', context);
    const id = thread.match(/meeting_([A-Za-z0-9]+)/)?.[1] ?? thread;
    return { platform: 'teams', code: id.slice(0, 12), url: canonical.toString() };
  }
  // Newer short links: /meet/<numeric id>?p=<passcode>
  if (segments[0] === 'meet' && segments[1] && /^\d{6,}$/.test(segments[1])) {
    const canonical = new URL(`https://${host}/meet/${segments[1]}`);
    const passcode = url.searchParams.get('p');
    if (passcode) canonical.searchParams.set('p', passcode);
    return { platform: 'teams', code: segments[1], url: canonical.toString() };
  }
  return null;
}

/** Every supported meeting link in free text, e.g. a calendar invite's HTML body. */
export function findMeetingLinks(text: string): MeetingLink[] {
  const found = new Map<string, MeetingLink>();
  const candidates = text.replace(/&amp;/g, '&').match(/https?:\/\/[^\s"'<>()]+/gi) ?? [];
  for (const candidate of candidates) {
    const link = parseMeetingLink(candidate.replace(/[.,;:!?]+$/, ''));
    if (link && !found.has(link.url)) found.set(link.url, link);
  }
  return [...found.values()];
}
