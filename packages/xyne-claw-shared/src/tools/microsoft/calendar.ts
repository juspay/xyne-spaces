/**
 * Microsoft Outlook Calendar API helpers (via Microsoft Graph).
 */

import { microsoftFetch } from "./oauth.js";

const BASE = "https://graph.microsoft.com/v1.0/me";

interface DateTimeTimeZone {
  dateTime: string;
  timeZone: string;
}

interface Attendee {
  emailAddress: { name?: string; address: string };
  status?: { response?: string };
  type?: string;
}

interface CalendarEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType: string; content: string };
  start?: DateTimeTimeZone;
  end?: DateTimeTimeZone;
  location?: { displayName?: string };
  attendees?: Attendee[];
  organizer?: { emailAddress: { name?: string; address: string } };
  webLink?: string;
  onlineMeeting?: { joinUrl?: string };
  isOnlineMeeting?: boolean;
  recurrence?: unknown;
  importance?: string;
  isAllDay?: boolean;
}

interface CalendarListEntry {
  id: string;
  name: string;
  isDefaultCalendar?: boolean;
  color?: string;
  canEdit?: boolean;
}

function formatDateTime(dt: DateTimeTimeZone | undefined, isAllDay?: boolean): string {
  if (!dt) return "?";
  if (isAllDay) return dt.dateTime.split("T")[0] + " (all day)";
  // Graph API may return times in UTC — always convert to IST for display
  const d = new Date(dt.dateTime + (dt.timeZone === "UTC" ? "Z" : ""));
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function formatEvent(event: CalendarEvent): string {
  const parts = [
    `[${event.id}] ${event.subject ?? "(no title)"}`,
    `  When: ${formatDateTime(event.start, event.isAllDay)} → ${formatDateTime(event.end, event.isAllDay)}`,
  ];

  if (event.location?.displayName) parts.push(`  Where: ${event.location.displayName}`);
  if (event.bodyPreview) {
    const desc = event.bodyPreview.length > 200
      ? event.bodyPreview.slice(0, 200) + "..."
      : event.bodyPreview;
    parts.push(`  Description: ${desc}`);
  }
  if (event.attendees && event.attendees.length > 0) {
    const attendeeList = event.attendees
      .map((a) => `${a.emailAddress.name ?? a.emailAddress.address} (${a.status?.response ?? "?"})`)
      .join(", ");
    parts.push(`  Attendees: ${attendeeList}`);
  }
  if (event.onlineMeeting?.joinUrl) parts.push(`  Join: ${event.onlineMeeting.joinUrl}`);
  if (event.webLink) parts.push(`  Link: ${event.webLink}`);
  if (event.importance && event.importance !== "normal") parts.push(`  Importance: ${event.importance}`);

  return parts.join("\n");
}

/** List all calendars for the user. */
export async function listCalendars(token: string): Promise<string> {
  const result = (await microsoftFetch(`${BASE}/calendars?$select=id,name,isDefaultCalendar,color,canEdit`, token)) as {
    value: CalendarListEntry[];
  };

  if (!result.value || result.value.length === 0) {
    return "No calendars found.";
  }

  const lines = result.value.map((cal) => {
    const def = cal.isDefaultCalendar ? " (default)" : "";
    const edit = cal.canEdit ? "read-write" : "read-only";
    return `[${cal.id}] ${cal.name}${def} — ${edit}`;
  });

  return `Calendars:\n\n${lines.join("\n")}`;
}

/** Search/list calendar events in a time range. */
export async function searchEvents(
  token: string,
  query: string | undefined,
  calendarId: string | undefined,
  timeMin: string | undefined,
  timeMax: string | undefined,
  maxResults: number,
): Promise<string> {
  // Use calendarView for time-range queries (expands recurring events)
  const startDateTime = timeMin ?? new Date().toISOString();
  const endDateTime = timeMax ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const calendarPath = calendarId ? `/calendars/${calendarId}` : "";
  const params = new URLSearchParams({
    startDateTime,
    endDateTime,
    $top: String(maxResults),
    $select: "id,subject,bodyPreview,start,end,location,attendees,organizer,webLink,onlineMeeting,isOnlineMeeting,isAllDay,importance",
    $orderby: "start/dateTime",
  });

  if (query) {
    params.set("$filter", `contains(subject,'${query.replace(/'/g, "''")}')`);
  }

  const result = (await microsoftFetch(
    `${BASE}${calendarPath}/calendarView?${params}`,
    token,
  )) as { value: CalendarEvent[] };

  if (!result.value || result.value.length === 0) {
    return "No events found.";
  }

  const formatted = result.value.map(formatEvent);
  return `Found ${result.value.length} events:\n\n${formatted.join("\n\n")}`;
}

/** Create a new calendar event. */
export async function createEvent(
  token: string,
  calendarId: string | undefined,
  subject: string,
  startTime: string,
  endTime: string,
  description?: string,
  location?: string,
  attendees?: string[],
  isOnlineMeeting?: boolean,
): Promise<string> {
  const isAllDay = !startTime.includes("T");
  const timeZone = "Asia/Kolkata"; // Default timezone

  const event: Record<string, unknown> = {
    subject,
    start: isAllDay
      ? { dateTime: `${startTime}T00:00:00`, timeZone }
      : { dateTime: startTime, timeZone },
    end: isAllDay
      ? { dateTime: `${endTime}T00:00:00`, timeZone }
      : { dateTime: endTime, timeZone },
    isAllDay,
  };

  if (description) event["body"] = { contentType: "text", content: description };
  if (location) event["location"] = { displayName: location };
  if (attendees && attendees.length > 0) {
    event["attendees"] = attendees.map((email) => ({
      emailAddress: { address: email },
      type: "required",
    }));
  }
  if (isOnlineMeeting) {
    event["isOnlineMeeting"] = true;
    event["onlineMeetingProvider"] = "teamsForBusiness";
  }

  const calendarPath = calendarId ? `/calendars/${calendarId}` : "";
  const result = (await microsoftFetch(
    `${BASE}${calendarPath}/events`,
    token,
    { method: "POST", body: JSON.stringify(event) },
  )) as CalendarEvent;

  const parts = [
    "Event created successfully.",
    `ID: ${result.id}`,
    `Subject: ${result.subject}`,
    `When: ${formatDateTime(result.start, result.isAllDay)} → ${formatDateTime(result.end, result.isAllDay)}`,
    ...(result.onlineMeeting?.joinUrl ? [`Teams link: ${result.onlineMeeting.joinUrl}`] : []),
    ...(result.webLink ? [`Link: ${result.webLink}`] : []),
  ];

  return parts.join("\n");
}

/** Delete a calendar event. */
export async function deleteEvent(
  token: string,
  calendarId: string | undefined,
  eventId: string,
): Promise<string> {
  if (!eventId || eventId.trim().length === 0) {
    throw new Error("eventId must not be empty");
  }
  const calendarPath = calendarId ? `/calendars/${calendarId}` : "";
  await microsoftFetch(
    `${BASE}${calendarPath}/events/${eventId}`,
    token,
    { method: "DELETE" },
  );

  return `Event ${eventId} deleted successfully.`;
}
