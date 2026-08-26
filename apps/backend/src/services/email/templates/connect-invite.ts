/**
 * Slack-Connect — the email sent to an external invitee once the host workspace's admin approves
 * their connect-channel invitation (Phase 9, `hostAdminApprove` → AWAITING_GUEST). The invitee clicks
 * "Accept Invitation" to open the connect-accept page, pick their workspace, and join the shared channel.
 */
export interface ConnectInviteEmailParams {
  /** Name of the person who initiated the invite (may be null → fall back to the workspace). */
  inviterName?: string | null;
  /** The host workspace that owns the shared channel. */
  hostWorkspaceName: string;
  /** The connect (shared) channel's name. */
  channelName: string;
  /** The connect-accept deep link (carries the invite token). */
  inviteLink: string;
  /** Base app URL, for the desktop-app download links. */
  frontendUrl: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function connectInviteEmailHtml({
  inviterName,
  hostWorkspaceName,
  channelName,
  inviteLink,
  frontendUrl,
}: ConnectInviteEmailParams): string {
  const inviter = inviterName?.trim();
  const workspace = escapeHtml(hostWorkspaceName);
  const channel = escapeHtml(channelName);
  const invitedByLine = inviter
    ? `<strong>${escapeHtml(inviter)}</strong> from <strong>${workspace}</strong>`
    : `<strong>${workspace}</strong>`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been invited to a shared channel on Xyne Spaces</title>
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
              <h2 style="color:#1f2937;margin:0 0 16px 0;font-size:22px;">You've been invited to a shared channel</h2>
              <p style="color:#4b5563;margin:0 0 24px 0;">
                ${invitedByLine} has invited you to collaborate in the shared channel <strong>#${channel}</strong> on Xyne Spaces. A shared (connect) channel lets two organizations work together in one place while each side stays in its own workspace.
              </p>

              <!-- Connect Banner -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#eef2ff;border:1px solid #6366f1;border-radius:8px;padding:12px 16px;">
                    <strong style="display:block;color:#3730a3;font-size:13px;margin-bottom:4px;">🔗 Shared channel with ${workspace}</strong>
                    <span style="color:#3730a3;font-size:13px;">When you accept, you'll pick which of your workspaces to join from. Only this channel is shared — the rest of each workspace stays private.</span>
                  </td>
                </tr>
              </table>

              <!-- Warning Banner -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px 16px;">
                    <strong style="display:block;color:#92400e;font-size:13px;margin-bottom:4px;">⚠️ Important: Complete both steps below in order.</strong>
                    <span style="color:#92400e;font-size:13px;">You must download and install the Xyne Spaces desktop app <em>before</em> clicking the invitation link. The invitation will only work correctly inside the app.</span>
                  </td>
                </tr>
              </table>

              <!-- Step 1 -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
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
                    <strong style="display:block;color:#1f2937;font-size:15px;margin-bottom:6px;">Download &amp; Install the Xyne Spaces Desktop App</strong>
                    <p style="color:#6b7280;font-size:13px;margin:0 0 14px 0;">The desktop app is required to access the shared channel. Download it for your platform from the link below and complete the installation before proceeding.</p>
                    <a href="${frontendUrl}/apps/downloads" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:600;font-size:14px;">Download Xyne Spaces App</a>
                    <p style="color:#6b7280;font-size:12px;margin:10px 0 0 0;">
                      Or visit: <a href="${frontendUrl}/apps/downloads" style="color:#6366f1;word-break:break-all;">${frontendUrl}/apps/downloads</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td style="border-top:1px solid #e5e7eb;"></td>
                </tr>
              </table>

              <!-- Step 2 -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td width="44" valign="top" style="padding-top:2px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="32" height="32" align="center" valign="middle" style="background:#000000;border-radius:50%;color:#ffffff;font-weight:700;font-size:14px;width:32px;height:32px;text-align:center;line-height:32px;">
                          2
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td valign="top">
                    <strong style="display:block;color:#1f2937;font-size:15px;margin-bottom:6px;">Accept &amp; Join the Shared Channel</strong>
                    <p style="color:#6b7280;font-size:13px;margin:0 0 6px 0;">Once the app is installed, click the button below to review the invitation, choose your workspace, and join <strong>#${channel}</strong>.</p>
                    <p style="color:#6b7280;font-size:13px;margin:0 0 14px 0;"><strong style="color:#1f2937;">Do not open this link in a browser</strong> — it must be opened in the Xyne Spaces desktop app. This link expires in 30 minutes.</p>
                    <a href="${inviteLink}" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Accept Invitation</a>
                    <p style="color:#6b7280;font-size:12px;margin:10px 0 0 0;word-break:break-all;">
                      Or copy and paste this link: <a href="${inviteLink}" style="color:#6366f1;">${inviteLink}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Footer -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-top:1px solid #e5e7eb;padding-top:24px;font-size:12px;color:#9ca3af;">
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

export function connectInviteEmailText({
  inviterName,
  hostWorkspaceName,
  channelName,
  inviteLink,
  frontendUrl,
}: ConnectInviteEmailParams): string {
  const inviter = inviterName?.trim();
  const invitedBy = inviter
    ? `${inviter} from ${hostWorkspaceName}`
    : hostWorkspaceName;

  return `
You've been invited to a shared channel on Xyne Spaces!

${invitedBy} has invited you to collaborate in the shared channel #${channelName} on Xyne Spaces.

A shared (connect) channel lets two organizations work together in one place while each side stays in its own workspace. When you accept, you'll pick which of your workspaces to join from — only this channel is shared, the rest of each workspace stays private.

⚠️  IMPORTANT: You must complete BOTH steps below in order. The invitation will only work correctly inside the desktop app.

──────────────────────────────────────────
STEP 1 — Download & Install the Desktop App (REQUIRED)
──────────────────────────────────────────
Before doing anything else, download and install the Xyne Spaces desktop app for your platform:

  ${frontendUrl}/apps/downloads

Complete the installation before moving to Step 2.

──────────────────────────────────────────
STEP 2 — Accept & Join the Shared Channel
──────────────────────────────────────────
Once the app is installed, open the link below to review the invitation, choose your workspace, and join #${channelName}.
Do NOT open this link in a browser — it must be opened in the Xyne Spaces desktop app.
This link expires in 30 minutes.

  ${inviteLink}

──────────────────────────────────────────
This invitation was sent by Xyne Spaces. If you weren't expecting this email, you can safely ignore it.
  `.trim();
}
