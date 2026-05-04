/**
 * Google Calendar API helpers.
 */

import { googleFetch } from "./oauth.js";

const BASE = "https://www.googleapis.com/calendar/v3";

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
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
}

function formatDateTime(dt: { dateTime?: string; date?: string } | undefined): string {
  if (!dt) return "?";
  if (dt.dateTime) {
    const d = new Date(dt.dateTime);
    return d.toLocaleString();
  }
  if (dt.date) return dt.date + " (all day)";
  return "?";
}

function formatEvent(event: CalendarEvent): string {
  const parts = [
    `[${event.id}] ${event.summary ?? "(no title)"}`,
    `  When: ${formatDateTime(event.start)} → ${formatDateTime(event.end)}`,
  ];

  if (event.location) parts.push(`  Where: ${event.location}`);
  if (event.description) {
    const desc = event.description.length > 200
      ? event.description.slice(0, 200) + "..."
      : event.description;
    parts.push(`  Description: ${desc}`);
  }
  if (event.attendees && event.attendees.length > 0) {
    const attendeeList = event.attendees
      .map((a) => `${a.displayName ?? a.email} (${a.responseStatus ?? "?"})`)
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
    return `[${cal.id}] ${cal.summary}${primary} — ${cal.accessRole ?? "reader"}`;
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
): Promise<string> {
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
  )) as { items?: CalendarEvent[] };

  if (!result.items || result.items.length === 0) {
    return "No events found.";
  }

  const formatted = result.items.map(formatEvent);
  return `Found ${result.items.length} events:\n\n${formatted.join("\n\n")}`;
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
