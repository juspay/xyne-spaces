import { clawApiRequest } from './clawRequest';

export type ClawProviderModel = {
  value: string;
  label: string;
};

const PROVIDER_MODEL_PATH: Record<'claude' | 'codex' | 'copilot', string> = {
  claude: '/settings/claude/models',
  codex: '/settings/codex/models',
  copilot: '/settings/copilot/models',
};

export const listClawProviderModels = async (
  provider: 'claude' | 'codex' | 'copilot',
  userId: string,
): Promise<ClawProviderModel[]> => {
  const rows = await clawApiRequest<Array<Record<string, unknown>>>(PROVIDER_MODEL_PATH[provider], {
    userId,
  });
  return rows
    .map(row => {
      const value = String(row['id'] ?? row['value'] ?? '').trim();
      const label = String(row['displayName'] ?? row['name'] ?? value).trim() || value;
      return value ? { value, label } : null;
    })
    .filter((row): row is ClawProviderModel => row !== null);
};
