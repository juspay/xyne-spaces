export interface CommunityJoinApprovedEmailParams {
  workspaceName: string;
  joinLink: string;
  message: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const messageParagraphs = (message: string): string =>
  message
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="color:#4b5563;margin:0 0 16px 0;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`
    )
    .join('');

export function communityJoinApprovedEmailHtml({
  workspaceName,
  joinLink,
  message,
}: CommunityJoinApprovedEmailParams): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Community request approved</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#333;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f5;">
    <tr>
      <td align="center" style="padding:20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;padding:40px;max-width:600px;">
          <tr>
            <td style="padding:40px;">

              <!-- Header -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:32px;">
                    <span style="font-size:28px;font-weight:bold;color:#000000;letter-spacing:-0.5px;">Xyne Spaces</span>
                  </td>
                </tr>
              </table>

              <!-- Greeting -->
              <h2 style="color:#1f2937;margin:0 0 16px 0;font-size:22px;">Your community request is approved</h2>
              <p style="color:#4b5563;margin:0 0 24px 0;">
                You can now join <strong>${escapeHtml(workspaceName)}</strong> Community on Xyne Spaces.
              </p>

              <!-- Success Banner -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#ecfdf5;border:1px solid #10b981;border-radius:8px;padding:12px 16px;">
                    <strong style="display:block;color:#065f46;font-size:13px;margin-bottom:4px;">Approved</strong>
                    <span style="color:#065f46;font-size:13px;">Your request has been approved by the community owners. Excited to have you onboard.</span>
                  </td>
                </tr>
              </table>

              <!-- Message -->
              ${messageParagraphs(message)}

              <!-- Step -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td width="44" valign="top" style="padding-top:2px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="32" height="32" align="center" valign="middle" style="background:#000000;border-radius:50%;color:#ffffff;font-weight:700;font-size:14px;width:32px;height:32px;text-align:center;line-height:32px;">
                          1
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td valign="top">
                    <strong style="display:block;color:#1f2937;font-size:15px;margin-bottom:6px;">Open Community &amp; Log In</strong>
                    <p style="color:#6b7280;font-size:13px;margin:0 0 14px 0;">Click the button below to login community now.</p>
                    <a href="${escapeHtml(joinLink)}" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Open Community</a>
                    <p style="color:#6b7280;font-size:12px;margin:10px 0 0 0;word-break:break-all;">
                      Or copy and paste this link: <a href="${escapeHtml(joinLink)}" style="color:#6366f1;">${escapeHtml(joinLink)}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Footer -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-top:1px solid #e5e7eb;padding-top:24px;font-size:12px;color:#9ca3af;">
                    <p style="margin:0;">This approval email was sent by Xyne Spaces.<br>If you weren't expecting this email, you can safely ignore it.</p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
