import { apiInstance } from './apiClient';

const BASE = '/integrations/telephony';

/** Call providers the dashboard knows; keep in step with the backend's CALL_PROVIDER_IDS. */
export const CALL_PROVIDER_IDS = ['ozonetel'] as const;

export function isCallProviderId(value: unknown): boolean {
  return typeof value === 'string' && (CALL_PROVIDER_IDS as readonly string[]).includes(value);
}

export const TELEPHONY_QUERY_KEYS = {
  providers: ['call-providers'] as const,
  connections: ['call-connections'] as const,
  connection: (id: string) => ['call-connection', id] as const,
  routingKeys: (connectionId: string) => ['call-routing-keys', connectionId] as const,
  deskSettings: (channelId: string) => ['desk-call-settings', channelId] as const,
  /** Prefix of every softphone query, for invalidation. */
  softphoneAll: ['call-softphone'] as const,
  softphone: (channelId: string | null | undefined) =>
    ['call-softphone', channelId ?? null] as const,
};

export interface CallProviderField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'url';
  required: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string;
}

export interface CallProviderOption {
  id: string;
  label: string;
}

export interface CallProviderInfo {
  id: string;
  displayName: string;
  fields: CallProviderField[];
  callTypes: CallProviderOption[];
  routingKeyLabel?: string;
  supportsSubscribe: boolean;
  supportsRoutingKeys: boolean;
}

export interface CallAgentMap {
  [xyneUserIdOrEmail: string]: { agentId: string; skill?: string };
}

export interface CallConnectionDeskLink {
  channelId: string;
  isDefault: boolean;
  routingKeys: string[];
}

export interface CallConnectionSummary {
  id: string;
  provider: string;
  providerName: string;
  name: string;
  hasSoftphone: boolean;
  desks: CallConnectionDeskLink[];
}

export interface CallConnectionDetails {
  id: string;
  provider: string;
  name: string;
  /** Provider fields without secrets. */
  credentials: Record<string, string>;
  agentMapping: CallAgentMap;
  webhookUrl: string | null;
}

export interface CallConnectionInput {
  provider?: string;
  name: string;
  credentials: Record<string, string>;
  agentMapping: CallAgentMap;
}

export interface CallConnectionMutationResult {
  connection: CallConnectionDetails;
  /** Null when the provider has no live-event subscription. */
  subscribe: { ok: boolean; message: string } | null;
}

export type CreateTicketOnEvent = 'new_call' | 'agent_answered';

export interface DeskCallTicketRules {
  createTicketOnEvent: CreateTicketOnEvent;
  callTypes: string[];
  subjectTemplate?: string;
}

export interface DeskCallSettings {
  channelId: string;
  connectionId: string;
  isDefault: boolean;
  routingKeys: string[];
  ticketRules: DeskCallTicketRules;
  phoneFieldNames: string[];
}

export interface DeskCallSettingsInput {
  connectionId: string;
  isDefault?: boolean;
  routingKeys?: string[];
  /** callTypes left out: the server enables every call type the provider has. */
  ticketRules?: Partial<DeskCallTicketRules>;
  phoneFieldNames?: string[];
}

export interface SoftphoneConnection {
  id: string;
  name: string;
  provider: string;
  url: string;
}

export interface SoftphoneInfo {
  /** Connections with an embeddable softphone (toolbar). */
  connections: SoftphoneConnection[];
  /** The desk's own connection, when it has one. */
  deskConnectionId: string | null;
  phoneFieldNames: string[];
}

/** Per-field messages from a rejected save, keyed like the request body. */
export function getTelephonyFieldErrors(err: unknown): Record<string, string[]> {
  const fieldErrors = (err as { response?: { data?: { fieldErrors?: unknown } } } | null)?.response
    ?.data?.fieldErrors;
  return fieldErrors && typeof fieldErrors === 'object'
    ? (fieldErrors as Record<string, string[]>)
    : {};
}

export async function getCallProviders(): Promise<CallProviderInfo[]> {
  const res = await apiInstance.get<{ providers: CallProviderInfo[] }>(`${BASE}/providers`);
  return res.data.providers;
}

export async function listCallConnections(): Promise<CallConnectionSummary[]> {
  const res = await apiInstance.get<{ connections: CallConnectionSummary[] }>(
    `${BASE}/connections`,
  );
  return res.data.connections;
}

export async function getCallConnection(id: string): Promise<CallConnectionDetails> {
  const res = await apiInstance.get<{ connection: CallConnectionDetails }>(
    `${BASE}/connections/${id}`,
  );
  return res.data.connection;
}

export async function createCallConnection(
  input: CallConnectionInput,
): Promise<CallConnectionMutationResult> {
  const res = await apiInstance.post<CallConnectionMutationResult>(`${BASE}/connections`, input);
  return res.data;
}

export async function updateCallConnection(
  id: string,
  input: CallConnectionInput,
): Promise<CallConnectionMutationResult> {
  const res = await apiInstance.patch<CallConnectionMutationResult>(
    `${BASE}/connections/${id}`,
    input,
  );
  return res.data;
}

export async function deleteCallConnection(id: string): Promise<void> {
  await apiInstance.delete(`${BASE}/connections/${id}`);
}

export async function subscribeCallConnection(id: string): Promise<{ message: string }> {
  const res = await apiInstance.post<{ ok: boolean; message: string }>(
    `${BASE}/connections/${id}/subscribe`,
  );
  return res.data;
}

export async function getCallRoutingKeys(connectionId: string): Promise<string[]> {
  const res = await apiInstance.get<{ routingKeys: string[] }>(
    `${BASE}/connections/${connectionId}/routing-keys`,
  );
  return res.data.routingKeys;
}

export async function getDeskCallSettings(channelId: string): Promise<DeskCallSettings | null> {
  const res = await apiInstance.get<{ settings: DeskCallSettings | null }>(
    `${BASE}/desks/${channelId}/call-settings`,
  );
  return res.data.settings;
}

export async function saveDeskCallSettings(
  channelId: string,
  input: DeskCallSettingsInput,
): Promise<DeskCallSettings> {
  const res = await apiInstance.put<{ settings: DeskCallSettings }>(
    `${BASE}/desks/${channelId}/call-settings`,
    input,
  );
  return res.data.settings;
}

export async function deleteDeskCallSettings(channelId: string): Promise<void> {
  await apiInstance.delete(`${BASE}/desks/${channelId}/call-settings`);
}

export async function getSoftphone(channelId?: string | null): Promise<SoftphoneInfo> {
  const res = await apiInstance.get<SoftphoneInfo>(`${BASE}/softphone`, {
    params: channelId ? { channelId } : undefined,
  });
  return res.data;
}

export async function linkCall(input: {
  connectionId: string;
  ticketId: string;
  monitorUcid: string;
  ucid?: string;
}): Promise<void> {
  await apiInstance.post(`${BASE}/link-call`, input);
}
