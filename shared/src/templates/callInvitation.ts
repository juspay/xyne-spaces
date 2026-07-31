// Email-safe HTML (table layout, inline styles). `userBodyHtml` is inserted
// verbatim — callers MUST sanitize it upstream.

export interface CallInvitationInput {
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  organizerName: string;
  organizerEmail: string;
  orgName?: string;
  joinUrl: string;
  userBodyHtml: string;
}

const FONT_SANS = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

// Email clients strip <link>; the in-app preview uses it.
const FONT_PRELOAD = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateParts(d: Date, timezone: string) {
  const tz = timezone || 'UTC';
  return {
    month: new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' }).format(d),
    day: new Intl.DateTimeFormat('en-US', { timeZone: tz, day: '2-digit' }).format(d),
    weekday: new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d),
    time: new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d),
  };
}

export function renderCallInvitationHtml(i: CallInvitationInput): string {
  const esc = escapeHtml;
  const { month, day, weekday, time } = formatDateParts(i.startsAt, i.timezone);
  const { time: endTime } = formatDateParts(i.endsAt, i.timezone);
  const durationMin = Math.max(1, Math.round((i.endsAt.getTime() - i.startsAt.getTime()) / 60000));
  const durationLabel =
    durationMin >= 60 ? `${Math.round((durationMin / 60) * 10) / 10} hr` : `${durationMin} min`;

  // Anchored to Xyne Spaces brand tokens in dashboard/src/global.css.
  const PRIMARY = '#57ab02';
  const PRIMARY_FG = '#ffffff';
  const ACCENT = '#27699d';
  const ACCENT_SOFT = '#EAF1F8';
  const INK = '#181B1D';
  const MUTED = '#788187';
  const LINE = '#E5EBF0';
  const CANVAS_TOP = '#e2eefb';
  const CANVAS_BOTTOM = '#eaefdb';
  const CARD_FOOTER = '#F7F9F6';

  const initial = esc((i.organizerName.trim().charAt(0) || 'A').toUpperCase());
  const orgChip = i.orgName
    ? `<span style="display:inline-block;padding:4px 10px;background:${ACCENT_SOFT};color:${ACCENT};font:600 10px/1 ${FONT_SANS};letter-spacing:0.14em;text-transform:uppercase;border-radius:999px;">${esc(i.orgName)}</span>`
    : '';

  return `<!doctype html>
<html><head>${FONT_PRELOAD}</head><body style="margin:0;background:${CANVAS_TOP};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS_TOP};background-image:linear-gradient(180deg, ${CANVAS_TOP} 0%, ${CANVAS_BOTTOM} 100%);">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:600px;border:1px solid ${LINE};border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(24,27,29,0.04);">

      <tr><td style="height:4px;background:${ACCENT};line-height:0;font-size:0">&nbsp;</td></tr>

      <tr><td style="padding:28px 40px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle">
              <p style="margin:0;font:600 11px/1 ${FONT_SANS};letter-spacing:0.2em;text-transform:uppercase;color:${ACCENT}">Meeting invitation</p>
            </td>
            <td align="right" style="vertical-align:middle">${orgChip}</td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:14px 40px 28px">
        <h1 style="margin:0;font:600 26px/1.25 ${FONT_SANS};color:${INK};letter-spacing:-0.01em">${esc(i.title)}</h1>
      </td></tr>

      <tr><td style="padding:0 40px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ACCENT_SOFT};border:1px solid ${LINE};border-radius:10px">
          <tr>
            <td style="width:96px;padding:20px 0;vertical-align:middle;text-align:center;border-right:1px solid #d6e3ee">
              <p style="margin:0;font:600 11px/1 ${FONT_SANS};letter-spacing:0.22em;text-transform:uppercase;color:${ACCENT}">${esc(month)}</p>
              <p style="margin:4px 0 0;font:600 32px/1 ${FONT_SANS};color:${INK}">${esc(day)}</p>
              <p style="margin:4px 0 0;font:500 11px/1 ${FONT_SANS};color:${MUTED}">${esc(weekday)}</p>
            </td>
            <td style="padding:18px 22px;vertical-align:middle">
              <p style="margin:0 0 6px;font:600 10px/1 ${FONT_SANS};letter-spacing:0.2em;text-transform:uppercase;color:${MUTED}">Time</p>
              <p style="margin:0;font:600 17px/1.2 ${FONT_SANS};color:${INK}">${esc(time)} – ${esc(endTime)}</p>
              <p style="margin:6px 0 0;font:400 12px/1.3 ${FONT_SANS};color:${MUTED}">${esc(i.timezone || 'UTC')} · ${esc(durationLabel)}</p>
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:20px 40px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:44px;vertical-align:middle">
              <div style="width:36px;height:36px;line-height:36px;text-align:center;border-radius:999px;background:${ACCENT};color:#ffffff;font:600 13px/36px ${FONT_SANS}">${initial}</div>
            </td>
            <td style="vertical-align:middle;padding-left:10px">
              <p style="margin:0;font:600 13px/1.2 ${FONT_SANS};color:${INK}">${esc(i.organizerName)}</p>
              <p style="margin:2px 0 0;font:400 12px/1.2 ${FONT_SANS};color:${MUTED}">Organizer · <a href="mailto:${esc(i.organizerEmail)}" style="color:${ACCENT};text-decoration:none">${esc(i.organizerEmail)}</a></p>
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:22px 40px 0"><div style="border-top:1px solid ${LINE};line-height:0;font-size:0">&nbsp;</div></td></tr>

      <tr><td style="padding:20px 40px 0;font:400 14px/1.65 ${FONT_SANS};color:${INK}">
        ${i.userBodyHtml}
      </td></tr>

      <tr><td style="padding:28px 40px 24px">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:${PRIMARY};border-radius:8px;">
              <a href="${esc(i.joinUrl)}" style="display:inline-block;padding:13px 26px;color:${PRIMARY_FG};text-decoration:none;font:600 14px/1 ${FONT_SANS};letter-spacing:0.01em">Join the meeting</a>
            </td>
            <td style="padding-left:14px;vertical-align:middle">
              <p style="margin:0;font:400 12px/1.4 ${FONT_SANS};color:${MUTED}">or copy the link:<br/><a href="${esc(i.joinUrl)}" data-action="copy-link" style="color:${ACCENT};text-decoration:none;word-break:break-all">${esc(i.joinUrl)}</a></p>
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:14px 40px;border-top:1px solid ${LINE};background:${CARD_FOOTER};font:500 10px/1.4 ${FONT_SANS};letter-spacing:0.18em;text-transform:uppercase;color:${MUTED}" align="center">
        Sent via Xyne Spaces
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
