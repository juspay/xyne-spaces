// RFC 5545 VCALENDAR with METHOD:REQUEST. Attached as `text/calendar`.

export interface CallInvitationIcsInput {
  uid: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  organizerName: string;
  organizerEmail: string;
  attendeeEmails: string[];
  description: string;
  joinUrl: string;
}

export function buildCallInvitationIcs(input: CallInvitationIcsInput): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const toIcsUtc = (d: Date): string =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

  const esc = (s: string): string =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');

  // RFC 5545 line-folding: 75 octets per line, continuation prefixed with space.
  const fold = (line: string): string => {
    if (line.length <= 74) return line;
    const pieces: string[] = [];
    let i = 0;
    pieces.push(line.slice(i, i + 74));
    i += 74;
    while (i < line.length) {
      pieces.push(' ' + line.slice(i, i + 73));
      i += 73;
    }
    return pieces.join('\r\n');
  };

  const fullDescription = `${input.description}\n\nJoin: ${input.joinUrl}`;
  const now = toIcsUtc(new Date());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Xyne Spaces//Call Invitation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${esc(input.uid)}@xyne`,
    `DTSTAMP:${now}`,
    `DTSTART:${toIcsUtc(input.startsAt)}`,
    `DTEND:${toIcsUtc(input.endsAt)}`,
    `SUMMARY:${esc(input.title)}`,
    `DESCRIPTION:${esc(fullDescription)}`,
    `LOCATION:${esc(input.joinUrl)}`,
    `ORGANIZER;CN=${esc(input.organizerName)}:mailto:${esc(input.organizerEmail)}`,
    ...input.attendeeEmails.map(
      (email) =>
        `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${esc(email)}`,
    ),
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(fold).join('\r\n') + '\r\n';
}
