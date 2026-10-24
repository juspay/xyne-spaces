import type { ProviderCredential } from './clawSettingsTypes';
import { PROVIDER_DISPLAY } from './modelProviderConfig';

export const AGENT_DEFAULT_PROVIDER = '__agent_default__';

export const CHAT_PROVIDERS = ['claude', 'codex', 'copilot'] as const;

export interface ChatProviderOption {
  value: string;
  label: string;
}

export const chatProviderLabel = (provider: string): string =>
  provider === AGENT_DEFAULT_PROVIDER ? 'Agent default' : (PROVIDER_DISPLAY[provider] ?? provider);

export function chatProviderValue(config: { provider: string; inherited: boolean }): string {
  return config.inherited ? AGENT_DEFAULT_PROVIDER : config.provider;
}

export function chatProviderOptions(
  credentials: readonly ProviderCredential[],
  current: string,
): ChatProviderOption[] {
  const options: ChatProviderOption[] = [
    { value: AGENT_DEFAULT_PROVIDER, label: chatProviderLabel(AGENT_DEFAULT_PROVIDER) },
  ];
  for (const provider of CHAT_PROVIDERS) {
    if (credentials.some(c => c.provider === provider && c.hasApiKey)) {
      options.push({ value: provider, label: chatProviderLabel(provider) });
    }
  }
  if (!options.some(option => option.value === current)) {
    options.push({ value: current, label: `${chatProviderLabel(current)} (current pick)` });
  }
  return options;
}
