import { SendInvitationEmailParams } from '../base-email-service';

export function invitationEmailHtml({
  inviterName,
  workspaceName,
  invitationLink,
  tempPassword,
  frontendUrl,
}: Pick<
  SendInvitationEmailParams,
  'inviterName' | 'workspaceName' | 'invitationLink' | 'tempPassword' | 'frontendUrl'
>): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to Xyne Spaces</title>
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
              <h2 style="color:#1f2937;margin:0 0 16px 0;font-size:22px;text-align:center;">You've been invited!</h2>
              <p style="color:#4b5563;margin:0 0 32px 0;text-align:center;">
                <strong>${inviterName}</strong> has invited you to join <strong>${workspaceName}</strong> on Xyne Spaces — a collaborative workspace for teams to communicate, manage tickets, and work together efficiently.
              </p>

              <!-- Primary CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
                <tr>
                  <td align="center">
                    <a href="${invitationLink}" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;padding:14px 44px;border-radius:10px;font-weight:700;font-size:16px;">Join Xyne</a>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <p style="color:#9ca3af;font-size:11px;margin:0;word-break:break-all;text-align:center;">Or copy and paste this link: <a href="${invitationLink}" style="color:#6366f1;">${invitationLink}</a></p>
                  </td>
                </tr>
              </table>

              ${tempPassword ? `
              <!-- Temp Password Banner -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#ecfdf5;border:1px solid #10b981;border-radius:8px;padding:12px 16px;">
                    <span style="display:block;color:#065f46;font-size:13px;margin-bottom:8px;">Sign in with Google/Microsoft SSO, or use this temporary password to sign in with your email — it will remain your password until you set it manually.</span>
                    <strong style="display:block;color:#065f46;font-size:13px;margin-bottom:4px;">🔑 Your Temporary Password</strong>
                    <p style="font-size:18px;font-weight:bold;color:#047857;margin:8px 0 0 0;letter-spacing:1px;">${tempPassword}</p>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- Desktop app mention -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-top:1px solid #e5e7eb;padding-top:28px;" align="center">
                    <p style="color:#6b7280;font-size:13px;margin:0 0 14px 0;text-align:center;">Want the full desktop experience?</p>
                    <a href="${frontendUrl}/apps/downloads" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Download Xyne Spaces App</a>
                  </td>
                </tr>
              </table>

              <!-- Footer -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-top:1px solid #e5e7eb;padding-top:24px;margin-top:24px;font-size:12px;color:#9ca3af;">
                    <p style="margin:0;">This invitation was sent by Xyne Spaces.<br>If you weren't expecting this email, you can safely ignore it.</p>
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

export function invitationEmailText({
  inviterName,
  workspaceName,
  invitationLink,
  tempPassword,
  frontendUrl,
}: Pick<
  SendInvitationEmailParams,
  'inviterName' | 'workspaceName' | 'invitationLink' | 'tempPassword' | 'frontendUrl'
>): string {
  return `
You've been invited to join ${workspaceName} on Xyne Spaces!

${inviterName} has invited you to collaborate on Xyne Spaces — a platform for teams to communicate, manage tickets, and work together efficiently.

──────────────────────────────────────────
JOIN XYNE
──────────────────────────────────────────
  ${invitationLink}

${tempPassword ? `──────────────────────────────────────────
Sign in with Google/Microsoft SSO, or use this temporary password to sign in with your email — it will remain your password until you set it manually.

🔑 YOUR TEMPORARY PASSWORD
──────────────────────────────────────────
  ${tempPassword}
` : ''}
Want the full desktop experience? Download the app:

  ${frontendUrl}/apps/downloads

──────────────────────────────────────────
This invitation was sent by Xyne Spaces. If you weren't expecting this email, you can safely ignore it.
  `.trim();
}
