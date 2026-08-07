/**
 * HTML page templates for the OAuth authorization flow.
 *
 * Minimal, dependency-free HTML served directly by the backend.
 * No frontend framework required.
 */

import type { Scope, ScopeDefinition } from '@xyne/spaces-contract';

const COMMON_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .card {
    background: white;
    border-radius: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    max-width: 480px;
    width: 100%;
    padding: 40px;
  }
  .logo {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 24px;
    color: white;
    font-size: 28px;
    font-weight: bold;
  }
  h1 {
    font-size: 24px;
    color: #1a1a2e;
    text-align: center;
    margin-bottom: 8px;
  }
  .subtitle {
    color: #6b7280;
    text-align: center;
    margin-bottom: 32px;
    font-size: 15px;
  }
  .user-info {
    background: #f8fafc;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .user-avatar {
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 600;
    font-size: 18px;
  }
  .user-details {
    flex: 1;
  }
  .user-name {
    font-weight: 600;
    color: #1a1a2e;
  }
  .user-email {
    color: #6b7280;
    font-size: 14px;
  }
  .scopes-section {
    margin-bottom: 24px;
  }
  .scopes-title {
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 12px;
  }
  .scope-list {
    background: #f8fafc;
    border-radius: 12px;
    padding: 4px;
    max-height: 200px;
    overflow-y: auto;
  }
  .scope-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
  }
  .scope-item:hover {
    background: #e5e7eb;
  }
  .scope-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
  }
  .scope-icon.read { color: #10b981; }
  .scope-icon.write { color: #f59e0b; }
  .scope-text {
    font-size: 14px;
    color: #374151;
  }
  .buttons {
    display: flex;
    gap: 12px;
  }
  button {
    flex: 1;
    padding: 14px 24px;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }
  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }
  .btn-primary:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
  }
  .btn-secondary:hover {
    background: #e5e7eb;
  }
  .error-icon {
    width: 64px;
    height: 64px;
    background: #fee2e2;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 24px;
    color: #ef4444;
    font-size: 32px;
  }
  .success-icon {
    width: 64px;
    height: 64px;
    background: #d1fae5;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 24px;
    color: #10b981;
    font-size: 32px;
  }
  .footer {
    margin-top: 24px;
    text-align: center;
    font-size: 12px;
    color: #9ca3af;
  }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

interface AuthorizePageParams {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scopes: Scope[];
  scopeDescriptions: readonly ScopeDefinition[];
  user: {
    name: string;
    email: string;
  };
}

export function renderAuthorizePage(params: AuthorizePageParams): string {
  const { clientId, redirectUri, state, codeChallenge, scopes, scopeDescriptions, user } = params;

  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const scopeItems = scopeDescriptions
    .map(
      (s) => `
      <div class="scope-item">
        <span class="scope-icon ${s.isWrite ? 'write' : 'read'}">${s.isWrite ? '&#9998;' : '&#128065;'}</span>
        <span class="scope-text">${escapeHtml(s.description)}</span>
      </div>
    `,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize - Xyne Spaces SDK</title>
  <style>${COMMON_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="logo">X</div>
    <h1>Authorize Application</h1>
    <p class="subtitle"><strong>${escapeHtml(clientId)}</strong> wants to access your Xyne Spaces account</p>

    <div class="user-info">
      <div class="user-avatar">${escapeHtml(initials)}</div>
      <div class="user-details">
        <div class="user-name">${escapeHtml(user.name)}</div>
        <div class="user-email">${escapeHtml(user.email)}</div>
      </div>
    </div>

    <div class="scopes-section">
      <div class="scopes-title">This application will be able to:</div>
      <div class="scope-list">
        ${scopeItems}
      </div>
    </div>

    <form method="POST" action="/api/v1/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="scope" value="${escapeHtml(scopes.join(' '))}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="S256">
      ${state ? `<input type="hidden" name="state" value="${escapeHtml(state)}">` : ''}

      <div class="buttons">
        <button type="submit" name="action" value="deny" class="btn-secondary">Deny</button>
        <button type="submit" name="action" value="authorize" class="btn-primary">Authorize</button>
      </div>
    </form>

    <div class="footer">
      Authorizing will redirect you back to the application.
    </div>
  </div>
</body>
</html>`;
}

export function renderErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - Xyne Spaces SDK</title>
  <style>${COMMON_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="error-icon">!</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(message)}</p>
    <div class="footer">
      Please close this window and try again.
    </div>
  </div>
</body>
</html>`;
}

export function renderSuccessPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Success - Xyne Spaces SDK</title>
  <style>${COMMON_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="success-icon">&#10003;</div>
    <h1>Authorization Successful</h1>
    <p class="subtitle">You have successfully authorized the application. You can close this window now.</p>
    <div class="footer">
      Return to your terminal to continue.
    </div>
  </div>
</body>
</html>`;
}
