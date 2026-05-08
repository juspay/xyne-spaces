import { SendInvitationEmailParams } from '../base-email-service';

export function invitationEmailHtml({
  inviterName,
  workspaceName,
  invitationLink,
}: Pick<SendInvitationEmailParams, 'inviterName' | 'workspaceName' | 'invitationLink'>): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to Xyne Spaces</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background: #ffffff;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      color: #000000;
      letter-spacing: -0.5px;
    }
    .content {
      margin-bottom: 32px;
    }
    .content h2 {
      color: #1f2937;
      margin-bottom: 16px;
    }
    .content p {
      color: #4b5563;
      margin-bottom: 16px;
    }
    .button-container {
      text-align: center;
      margin: 32px 0;
    }
    .button {
      display: inline-block;
      background: #000000;
      color: #ffffff;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
    }
    .button:hover {
      background: #333333;
    }
    .link-fallback {
      font-size: 13px;
      color: #6b7280;
      word-break: break-all;
    }
    .link-fallback a {
      color: #6366f1;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #9ca3af;
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Xyne Spaces</div>
    </div>
    <div class="content">
      <h2>You've been invited!</h2>
      <p><strong>${inviterName}</strong> has invited you to join <strong>${workspaceName}</strong> on Xyne Spaces.</p>
      <p>Xyne Spaces is a collaborative workspace for teams to communicate, manage tickets, and work together efficiently.</p>
      <div class="button-container">
        <a href="${invitationLink}" class="button" style="color: #ffffff;">Accept Invitation</a>
      </div>
      <p class="link-fallback">
        Or copy and paste this link into your browser:
        <a href="${invitationLink}">${invitationLink}</a>
      </p>
      <p style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
        Download the app from <a href="https://spaces.xyne.juspay.net/invite" style="color: #6366f1;">https://spaces.xyne.juspay.net/invite</a>
      </p>
    </div>
    <div class="footer">
      <p>This invitation was sent by Xyne Spaces.<br>If you weren't expecting this email, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export function invitationEmailText({
  inviterName,
  workspaceName,
  invitationLink,
}: Pick<SendInvitationEmailParams, 'inviterName' | 'workspaceName' | 'invitationLink'>): string {
  return `
You've been invited to join ${workspaceName} on Xyne Spaces!

${inviterName} has invited you to collaborate.

Accept your invitation: ${invitationLink}

---
This invitation was sent by Xyne Spaces. If you weren't expecting this email, you can safely ignore it.
  `.trim();
}
