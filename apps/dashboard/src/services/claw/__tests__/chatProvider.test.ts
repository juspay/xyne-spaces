import { describe, expect, it } from 'vitest';
import { AGENT_DEFAULT_PROVIDER, chatProviderOptions, chatProviderValue } from '../chatProvider';
import type { ProviderCredential } from '../clawSettingsTypes';

const cred = (provider: string, hasApiKey = true): ProviderCredential => ({ provider, hasApiKey });

describe('chatProviderOptions', () => {
  it('offers only the agent default when the user has no provider keys', () => {
    expect(chatProviderOptions([], AGENT_DEFAULT_PROVIDER)).toEqual([
      { value: AGENT_DEFAULT_PROVIDER, label: 'Agent default' },
    ]);
  });

  it('adds each hosted provider the user has a key for, in a stable order', () => {
    const options = chatProviderOptions(
      [cred('copilot'), cred('claude'), cred('codex', false), cred('openrouter')],
      AGENT_DEFAULT_PROVIDER,
    );
    expect(options.map(o => o.value)).toEqual([AGENT_DEFAULT_PROVIDER, 'claude', 'copilot']);
    expect(options[1]?.label).toBe('Anthropic Claude');
  });

  it('keeps a pick made elsewhere visible so it is not cleared by accident', () => {
    const options = chatProviderOptions([cred('claude')], 'claude-code');
    expect(options.at(-1)).toEqual({
      value: 'claude-code',
      label: 'Claude Code (this device) (current pick)',
    });
  });

  it('does not duplicate a pick that is already listed', () => {
    const options = chatProviderOptions([cred('codex')], 'codex');
    expect(options.filter(o => o.value === 'codex')).toHaveLength(1);
  });
});

describe('chatProviderValue', () => {
  it('maps an inherited config to the agent default and keeps explicit picks', () => {
    expect(chatProviderValue({ provider: 'spaces', inherited: true })).toBe(AGENT_DEFAULT_PROVIDER);
    expect(chatProviderValue({ provider: 'spaces', inherited: false })).toBe('spaces');
    expect(chatProviderValue({ provider: 'claude', inherited: false })).toBe('claude');
  });
});
