import { apiInstance } from './apiClient';

export interface OzonetelAgentMap {
  [xyneUserIdOrEmail: string]: { agentId: string; skill?: string };
}

export interface OzonetelTicketRules {
  defaultChannelId?: string;
  campaignRouting?: Record<string, string>;
  createTicketOnEvent?: 'new_call' | 'agent_answered';
  createTicketOnInbound?: boolean;
  createTicketOnManual?: boolean;
  createTicketOnPreview?: boolean;
  createTicketOnProgressive?: boolean;
  createTicketOnPredictive?: boolean;
  ticketSubjectTemplate?: string;
}

export interface OzonetelConfigView {
  configured: boolean;
  apiUser?: string;
  baseUrl?: string;
  toolbarUrl?: string | null;
  postCallWebhookURL?: string;
  agentMapping?: OzonetelAgentMap;
  ticketRules?: OzonetelTicketRules;
  channelRouting?: {
    usesChannel: boolean;
    isDefaultChannel: boolean;
    mappedCampaigns: string[];
  };
}

export interface SaveOzonetelConfigInput {
  channelId?: string;
  apiKey?: string;
  apiUser: string;
  baseUrl: string;
  toolbarUrl?: string;
  agentMapping: OzonetelAgentMap;
  ticketRules?: OzonetelTicketRules;
}

export interface OzonetelConfigMutationResult {
  ok: boolean;
  subscribeMessage?: string;
  message?: string;
}

export interface OzonetelCampaignsView {
  ok: boolean;
  campaigns: string[];
  raw: unknown;
}

export async function getOzonetelConfig(channelId?: string): Promise<OzonetelConfigView> {
  const res = await apiInstance.get<OzonetelConfigView>('/integrations/ozonetel/config', {
    params: channelId ? { channelId } : undefined,
  });
  return res.data;
}

export async function saveOzonetelConfig(
  input: SaveOzonetelConfigInput,
): Promise<OzonetelConfigMutationResult> {
  const res = await apiInstance.post<OzonetelConfigMutationResult>(
    '/integrations/ozonetel/config',
    input,
  );
  return res.data;
}

export async function subscribeOzonetelLiveEvents(): Promise<OzonetelConfigMutationResult> {
  const res = await apiInstance.post<OzonetelConfigMutationResult>(
    '/integrations/ozonetel/subscribe-live-events',
  );
  return res.data;
}

export async function getOzonetelCampaigns(): Promise<OzonetelCampaignsView> {
  const res = await apiInstance.get<OzonetelCampaignsView>('/integrations/ozonetel/campaigns');
  return res.data;
}
