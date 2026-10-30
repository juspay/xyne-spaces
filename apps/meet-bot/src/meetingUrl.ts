/**
 * Meeting links the bot can join. Mirrors packages/shared/src/utils/meetingLinks.ts
 * (the backend and dashboard side; this app doesn't depend on @xyne/shared): keep
 * both in step.
 */
export type MeetingPlatform = "google_meet" | "teams";

export interface MeetingUrl {
  platform: MeetingPlatform;
  /** Short id for titles and logs. */
  code: string;
  /** Canonical join URL. */
  url: string;
}

const TEAMS_HOSTS = new Set(["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"]);
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The meeting a link points to, or null when the bot can't join it. */
export function parseMeetingUrl(raw: string): MeetingUrl | null {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "meet.google.com") {
    const code = segments[0]?.toLowerCase();
    if (segments.length !== 1 || !code || !MEET_CODE.test(code)) return null;
    return { platform: "google_meet", code, url: `https://meet.google.com/${code}` };
  }

  if (!TEAMS_HOSTS.has(host)) return null;
  if (segments[0] === "l" && segments[1] === "meetup-join" && segments[2]) {
    const thread = safeDecode(segments[2]);
    const message = safeDecode(segments[3] ?? "0");
    const canonical = new URL(`https://${host}/l/meetup-join/${encodeURIComponent(thread)}/${encodeURIComponent(message)}`);
    const context = url.searchParams.get("context");
    if (context) canonical.searchParams.set("context", context);
    const id = thread.match(/meeting_([A-Za-z0-9]+)/)?.[1] ?? thread;
    return { platform: "teams", code: id.slice(0, 12), url: canonical.toString() };
  }
  if (segments[0] === "meet" && segments[1] && /^\d{6,}$/.test(segments[1])) {
    const canonical = new URL(`https://${host}/meet/${segments[1]}`);
    const passcode = url.searchParams.get("p");
    if (passcode) canonical.searchParams.set("p", passcode);
    return { platform: "teams", code: segments[1], url: canonical.toString() };
  }
  return null;
}
