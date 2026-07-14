/**
 * Google Calendar API helpers.
 */

import { googleFetch } from "./oauth.js";
import { type CitedText, inlineCitationToken, externalCitation } from "./citations.js";
import type { Citation } from "../../types/citation.js";

const BASE = "https://www.googleapis.com/calendar/v3";

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  // attendee.optional (may decline w/o affecting the event) and attendee.resource
  // (meeting room / equipment) are surfaced by formatEvent — previously dropped.
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
    optional?: boolean;
    resource?: boolean;
  }>;
  organizer?: { email: string; displayName?: string };
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ uri?: string; label?: string }> };
  recurrence?: string[];
  recurringEventId?: string;
}

interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
  // calendarList entry timeZone — surfaced per line so callers know the calendar's
  // native zone; previously dropped.
  timeZone?: string;
}

function formatDateTime(
  dt: { dateTime?: string; date?: string; timeZone?: string } | undefined,
): string {
  if (!dt) return "?";
  if (dt.dateTime) {
    // Render the event in ITS OWN timezone (event.start/end.timeZone), NOT the
    // server locale. `new Date(dt.dateTime).toLocaleString()` shifted a 2 PM New
    // York meeting to the server's wall clock (the audit's HIGH bug, L40).
    if (dt.timeZone) {
      const d = new Date(dt.dateTime);
      if (!isNaN(d.getTime())) {
        const formatted = new Intl.DateTimeFormat("en-US", {
          timeZone: dt.timeZone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(d);
        return `${formatted} (${dt.timeZone})`;
      }
    }
    // No timeZone available: show the original offset-bearing string verbatim
    // rather than converting it into the server locale (which would mislead).
    return dt.dateTime;
  }
  if (dt.date) return dt.date + " (all day)";
  return "?";
}

/** Concise label for a calendar citation chip, e.g. "Standup · Jun 24". The
 *  full date/time stays in the result text via formatEvent(). */
function shortEventLabel(
  summary: string | undefined,
  start: { dateTime?: string; date?: string } | undefined,
): string {
  const title = summary ?? "Event";
  const raw = start?.dateTime ?? start?.date;
  if (!raw) return title;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return title;
  return `${title} · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function formatEvent(event: CalendarEvent): string {
  // Mark recurring instances so a one-off can be told from a series member
  // (API field recurringEventId); previously ignored.
  const recurringMarker = event.recurringEventId ? " (recurring)" : "";
  const parts = [
    `[${event.id}] ${event.summary ?? "(no title)"}${recurringMarker}`,
    `  When: ${formatDateTime(event.start)} → ${formatDateTime(event.end)}`,
  ];

  if (event.location) parts.push(`  Where: ${event.location}`);
  if (event.description) {
    const desc = event.description.length > 200
      ? event.description.slice(0, 200) + "..."
      : event.description;
    parts.push(`  Description: ${desc}`);
  }
  // organizer (email/displayName) was parsed into the interface but never emitted.
  if (event.organizer) {
    const org = event.organizer.displayName
      ? `${event.organizer.displayName} <${event.organizer.email}>`
      : event.organizer.email;
    parts.push(`  Organizer: ${org}`);
  }
  if (event.attendees && event.attendees.length > 0) {
    const attendeeList = event.attendees
      .map((a) => {
        const name = a.displayName ?? a.email;
        // Surface attendee.optional and attendee.resource (meeting room) flags.
        const flags: string[] = [];
        if (a.optional) flags.push("optional");
        if (a.resource) flags.push("room");
        const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
        return `${name} (${a.responseStatus ?? "?"})${suffix}`;
      })
      .join(", ");
    parts.push(`  Attendees: ${attendeeList}`);
  }
  if (event.hangoutLink) parts.push(`  Meet: ${event.hangoutLink}`);
  if (event.conferenceData?.entryPoints) {
    for (const ep of event.conferenceData.entryPoints) {
      if (ep.uri) parts.push(`  Join: ${ep.uri}`);
    }
  }
  if (event.status && event.status !== "confirmed") parts.push(`  Status: ${event.status}`);

  return parts.join("\n");
}

export async function listCalendars(token: string): Promise<string> {
  const result = (await googleFetch(`${BASE}/users/me/calendarList`, token)) as {
    items?: CalendarListEntry[];
  };

  if (!result.items || result.items.length === 0) {
    return "No calendars found.";
  }

  const lines = result.items.map((cal) => {
    const primary = cal.primary ? " (primary)" : "";
    // Append the calendar's native timeZone (API field timeZone) when present.
    const tz = cal.timeZone ? ` — ${cal.timeZone}` : "";
    return `[${cal.id}] ${cal.summary}${primary} — ${cal.accessRole ?? "reader"}${tz}`;
  });

  return `Calendars:\n\n${lines.join("\n")}`;
}

export async function searchEvents(
  token: string,
  query: string | undefined,
  calendarId: string,
  timeMin: string | undefined,
  timeMax: string | undefined,
  maxResults: number,
): Promise<CitedText> {
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });

  if (timeMin) {
    params.set("timeMin", timeMin);
  } else {
    params.set("timeMin", new Date().toISOString());
  }

  if (timeMax) {
    params.set("timeMax", timeMax);
  }

  if (query) {
    params.set("q", query);
  }

  const result = (await googleFetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    token,
  )) as { items?: CalendarEvent[]; nextPageToken?: string };

  if (!result.items || result.items.length === 0) {
    return { text: "No events found." };
  }

  const citations: Citation[] = [];
  const formatted = result.items.map((event, i) => {
    const idx = i + 1;
    const c = externalCitation({
      app: "gcal",
      url: event.htmlLink,
      chunkIndex: idx,
      label: shortEventLabel(event.summary, event.start),
    });
    if (c) citations.push(c);
    return `${inlineCitationToken(idx)} ${formatEvent(event)}`;
  });
  // Be honest about the count: a nextPageToken means the API had more results
  // than this page, so N is a cap, not the total (the audit's HIGH bug, L156).
  const count = result.items.length;
  const header = result.nextPageToken
    ? `Found ${count}+ events (showing the first ${count}; more exist — narrow the time range or raise maxResults)`
    : `Found ${count} events`;
  return { text: `${header}:\n\n${formatted.join("\n\n")}`, citations };
}

export async function deleteEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<string> {
  await googleFetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    token,
    { method: "DELETE" },
  );

  return `Event ${eventId} deleted successfully.`;
}

export async function createEvent(
  token: string,
  calendarId: string,
  summary: string,
  startTime: string,
  endTime: string,
  description?: string,
  location?: string,
  attendees?: string[],
): Promise<string> {
  const isAllDay = !startTime.includes("T");

  // If dateTime lacks a timezone offset (e.g. "2026-04-10T14:00:00"), add timeZone
  const needsTz = (dt: string) => !isAllDay && !/[+-]\d{2}:\d{2}$/.test(dt) && !dt.endsWith("Z");
  const DEFAULT_TZ = "Asia/Kolkata";

  const event: Record<string, unknown> = {
    summary,
    start: isAllDay
      ? { date: startTime }
      : needsTz(startTime)
        ? { dateTime: startTime, timeZone: DEFAULT_TZ }
        : { dateTime: startTime },
    end: isAllDay
      ? { date: endTime }
      : needsTz(endTime)
        ? { dateTime: endTime, timeZone: DEFAULT_TZ }
        : { dateTime: endTime },
  };

  if (description) event["description"] = description;
  if (location) event["location"] = location;
  if (attendees && attendees.length > 0) {
    event["attendees"] = attendees.map((email) => ({ email }));
  }

  const result = (await googleFetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    token,
    { method: "POST", body: JSON.stringify(event) },
  )) as CalendarEvent;

  return [
    "Event created successfully.",
    `ID: ${result.id}`,
    `Summary: ${result.summary}`,
    `When: ${formatDateTime(result.start)} → ${formatDateTime(result.end)}`,
    ...(result.htmlLink ? [`Link: ${result.htmlLink}`] : []),
  ].join("\n");
}
