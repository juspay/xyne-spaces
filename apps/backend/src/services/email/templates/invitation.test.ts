jest.mock('@xyne/shared', () => ({
  InviteExperience: { DESKTOP: 'DESKTOP', BROWSER: 'BROWSER' },
}));

import { invitationEmailHtml, invitationEmailText } from './invitation';

const baseParams = {
  inviterName: 'Ada Lovelace',
  workspaceName: 'Analytics Engine',
  invitationLink: 'https://app.spaces.xyne.juspay.net/launch?path=invite%3FworkspaceId%3Dws1%26invitationId%3Dinv1',
  tempPassword: 'temp-pass-123',
  frontendUrl: 'https://app.spaces.xyne.juspay.net',
};

describe('invitationEmailHtml', () => {
  it('renders the desktop-mode template (default/unset inviteExperience) — regression snapshot', () => {
    expect(invitationEmailHtml(baseParams)).toMatchSnapshot();
  });

  it('desktop mode requires app install and warns against opening in a browser', () => {
    const html = invitationEmailHtml(baseParams);
    expect(html).toContain('Download &amp; Install the Xyne Spaces Desktop App');
    expect(html).toContain('Do not open this link in a browser');
    expect(html).toContain('>Accept Invitation<');
  });

  it('browser mode drops the install step and browser warning, and relabels the CTA', () => {
    const html = invitationEmailHtml({ ...baseParams, inviteExperience: 'BROWSER' });
    expect(html).not.toContain('Download &amp; Install the Xyne Spaces Desktop App');
    expect(html).not.toContain('Do not open this link in a browser');
    expect(html).toContain('>Open My Workspace<');
    expect(html).toContain(baseParams.invitationLink);
    expect(html).toContain(baseParams.tempPassword);
  });

  it('null inviteExperience behaves as desktop (CAC/DB-unset fallback)', () => {
    const html = invitationEmailHtml({ ...baseParams, inviteExperience: null });
    expect(html).toContain('Download &amp; Install the Xyne Spaces Desktop App');
  });
});

describe('invitationEmailText', () => {
  it('renders the desktop-mode template (default/unset inviteExperience) — regression snapshot', () => {
    expect(invitationEmailText(baseParams)).toMatchSnapshot();
  });

  it('desktop mode includes STEP 1 install instructions and the browser warning', () => {
    const text = invitationEmailText(baseParams);
    expect(text).toContain('STEP 1 — Download & Install the Desktop App');
    expect(text).toContain('Do NOT open this link in a browser');
  });

  it('browser mode drops STEP 1 and the browser warning', () => {
    const text = invitationEmailText({ ...baseParams, inviteExperience: 'BROWSER' });
    expect(text).not.toContain('STEP 1');
    expect(text).not.toContain('Do NOT open this link in a browser');
    expect(text).toContain(baseParams.invitationLink);
    expect(text).toContain(baseParams.tempPassword);
  });
});
