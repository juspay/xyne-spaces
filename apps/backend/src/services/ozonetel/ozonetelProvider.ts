import { CallConfigError, type CallProvider } from '@/services/telephony/callProvider';
import { isAllowedOzonetelBaseUrl, ozonetelService } from './ozonetelService';

export type OzonetelCredentials = {
  apiKey: string;
  apiUser: string;
  baseUrl: string;
  toolbarUrl?: string;
};

function text(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

export const ozonetelProvider: CallProvider<OzonetelCredentials> = {
  id: 'ozonetel',
  displayName: 'Ozonetel',
  fields: [
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true, placeholder: 'Ozonetel API key' },
    { key: 'apiUser', label: 'API Username', type: 'text', required: true },
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'url',
      required: true,
      help: 'Region-specific CCaaS API host.',
      defaultValue: 'https://in1-ccaas-api.ozonetel.com',
    },
    {
      key: 'toolbarUrl',
      label: 'CloudAgent Toolbar URL',
      type: 'url',
      required: false,
      help: 'Embedded agent toolbar iframe URL (optional).',
      placeholder: 'https://agent.ccaas.ozonetel.com/toolbar_widget/index.html',
    },
  ],
  callTypes: [
    { id: 'inbound', label: 'Inbound Calls' },
    { id: 'manual', label: 'Manual Calls' },
    { id: 'preview', label: 'Preview Calls' },
    { id: 'progressive', label: 'Progressive Calls' },
    { id: 'predictive', label: 'Predictive Calls' },
  ],
  routingKeyLabel: 'Campaign',

  parseCredentials(input, existing) {
    const apiKey = text(input, 'apiKey') || existing?.apiKey || '';
    const apiUser = text(input, 'apiUser');
    const baseUrl = text(input, 'baseUrl').replace(/\/+$/, '');
    const toolbarUrl = text(input, 'toolbarUrl');

    const fieldErrors: Record<string, string[]> = {};
    if (!apiKey) fieldErrors.apiKey = ['API key is required'];
    if (!apiUser) fieldErrors.apiUser = ['API username is required'];
    if (!isAllowedOzonetelBaseUrl(baseUrl)) fieldErrors.baseUrl = ['Use an https://…ozonetel.com address'];
    if (toolbarUrl && !isHttpsUrl(toolbarUrl)) fieldErrors.toolbarUrl = ['Use an https:// address'];
    if (Object.keys(fieldErrors).length > 0) {
      throw new CallConfigError('Invalid Ozonetel settings', 400, fieldErrors);
    }
    return { apiKey, apiUser, baseUrl, ...(toolbarUrl ? { toolbarUrl } : {}) };
  },

  publicCredentials: credentials => ({
    apiUser: String(credentials.apiUser ?? ''),
    baseUrl: String(credentials.baseUrl ?? ''),
    toolbarUrl: String(credentials.toolbarUrl ?? ''),
  }),

  accountKey: credentials =>
    `${hostOf(String(credentials.baseUrl ?? ''))}|${String(credentials.apiUser ?? '').trim().toLowerCase()}`,

  softphoneUrl: credentials =>
    typeof credentials.toolbarUrl === 'string' && credentials.toolbarUrl.trim()
      ? credentials.toolbarUrl.trim()
      : null,

  async subscribeEvents(credentials, webhookUrl) {
    return (await ozonetelService.subscribeEvents(credentials, webhookUrl)).message;
  },

  async listRoutingKeys(credentials) {
    return (await ozonetelService.listAvailableCampaigns(credentials)).campaigns;
  },
};
