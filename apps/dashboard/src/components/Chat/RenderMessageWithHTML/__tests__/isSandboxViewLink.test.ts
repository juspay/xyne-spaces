import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSandboxViewLink } from '../internalLinkUtils';

describe('isSandboxViewLink', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'https://app.spaces.xyne.juspay.net' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('matches live preview and VS Code links on Spaces hosts', () => {
    expect(
      isSandboxViewLink('https://app.spaces.xyne.juspay.net/claw-preview/kata-claim-e3e60c6c/'),
    ).toBe(true);
    expect(
      isSandboxViewLink(
        'https://app.spaces.xyne.juspay.net/claw-code/agent-workspace-warmpool-b-nk9zk/',
      ),
    ).toBe(true);
    expect(
      isSandboxViewLink(
        'https://spaces.xyne.juspay.net/claw-preview/euler-warmpool-a-q9hzf/vnc.html',
      ),
    ).toBe(true);
    expect(isSandboxViewLink('/claw-code/kata-claim-e3e60c6c/')).toBe(true);
  });

  it('ignores app routes and other claw paths', () => {
    expect(isSandboxViewLink('https://app.spaces.xyne.juspay.net/chat/abc')).toBe(false);
    expect(isSandboxViewLink('https://app.spaces.xyne.juspay.net/claw')).toBe(false);
    expect(isSandboxViewLink('https://app.spaces.xyne.juspay.net/claw-preview')).toBe(false);
  });

  it('ignores sandbox-shaped paths on foreign hosts', () => {
    expect(isSandboxViewLink('https://example.com/claw-preview/kata-claim-e3e60c6c/')).toBe(false);
    expect(isSandboxViewLink('javascript:alert(1)//claw-code/x/')).toBe(false);
  });
});
