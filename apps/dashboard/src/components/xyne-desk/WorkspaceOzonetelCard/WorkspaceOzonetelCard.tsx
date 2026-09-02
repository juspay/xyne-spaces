import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Phone, Plus, Settings2, Trash2, X } from 'lucide-react';
import { ChannelType } from '@xyne/shared';
import { toast } from 'sonner';
import {
  getOzonetelCampaigns,
  getOzonetelConfig,
  saveOzonetelConfig,
  subscribeOzonetelLiveEvents,
  type OzonetelAgentMap,
  type OzonetelTicketRules,
} from '../../../services/clients/telephonyApi';
import { Dialog } from '../../ui/Dialog';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { getApiErrorMessage } from '../../../utils/apiError';
import { cn } from '../../../utils/classNames';
import { useAllChannels } from '../../../hooks/useChannels';
import { Button } from '../../ui/Button/Button';

const inputClass =
  'w-full rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent';

function getSaveErrorMessage(
  err: unknown,
  fallback = 'Please check the configuration and try again.',
): string {
  const apiError = (err as { response?: { data?: { error?: unknown } } } | null)?.response?.data
    ?.error;
  return typeof apiError === 'string' && apiError.trim().length > 0
    ? apiError
    : getApiErrorMessage(err, fallback);
}

function validateAgentMapping(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Agent mapping must be a JSON object keyed by Xyne user email or user ID.';
  }

  for (const [xyneUserKey, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return `Agent mapping for "${xyneUserKey}" must be an object.`;
    }
    const agentId = (entry as { agentId?: unknown }).agentId;
    if (typeof agentId !== 'string' || agentId.trim().length === 0) {
      return `Agent mapping for "${xyneUserKey}" requires a non-empty agentId.`;
    }
    const skill = (entry as { skill?: unknown }).skill;
    if (skill !== undefined && typeof skill !== 'string') {
      return `Skill for "${xyneUserKey}" must be a string if provided.`;
    }
  }

  return null;
}

export const WorkspaceOzonetelCard = (): ReactElement => {
  const queryClient = useQueryClient();
  const allChannels = useAllChannels();
  const callDeskChannels = allChannels
    .filter(channel => channel.type === ChannelType.CALL)
    .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['workspace-ozonetel-config'],
    queryFn: () => getOzonetelConfig(),
  });
  const { data: campaignsData, isLoading: isLoadingCampaigns } = useQuery({
    queryKey: ['workspace-ozonetel-campaigns'],
    queryFn: () => getOzonetelCampaigns(),
    enabled: isOpen && Boolean(data?.configured),
  });

  const [apiKey, setApiKey] = useState('');
  const [apiUser, setApiUser] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://in1-ccaas-api.ozonetel.com');
  const [toolbarUrl, setToolbarUrl] = useState('');
  const [agentMappingText, setAgentMappingText] = useState('{}');
  const [ticketSubjectTemplate, setTicketSubjectTemplate] = useState(
    '{callType} call from {callerId} ({monitorUcid})',
  );
  const [ticketRules, setTicketRules] = useState<OzonetelTicketRules>({});
  const [defaultChannelId, setDefaultChannelId] = useState('');
  const [campaignRoutes, setCampaignRoutes] = useState<
    Array<{ campaignName: string; channelId: string }>
  >([]);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'post-call' | null>(null);

  useEffect(() => {
    if (!data) return;
    setApiUser(data.apiUser ?? '');
    if (data.baseUrl) setBaseUrl(data.baseUrl);
    setToolbarUrl(data.toolbarUrl ?? '');
    setAgentMappingText(JSON.stringify(data.agentMapping ?? {}, null, 2));
    setTicketSubjectTemplate(
      data.ticketRules?.ticketSubjectTemplate ?? '{callType} call from {callerId} ({monitorUcid})',
    );
    setTicketRules(data.ticketRules ?? {});
    setDefaultChannelId(data.ticketRules?.defaultChannelId ?? '');
    setCampaignRoutes(
      Object.entries(data.ticketRules?.campaignRouting ?? {}).map(([campaignName, channelId]) => ({
        campaignName,
        channelId,
      })),
    );
  }, [data]);

  const mutation = useMutation({
    mutationFn: saveOzonetelConfig,
    onSuccess: () => {
      setApiKey('');
      setSaveError(null);
      setRoutingError(null);
      void queryClient.invalidateQueries({ queryKey: ['workspace-ozonetel-config'] });
      void queryClient.invalidateQueries({ queryKey: ['ozonetel-config'] });
    },
    onError: error => {
      setSaveError(getSaveErrorMessage(error));
    },
  });
  const subscribeMutation = useMutation({
    mutationFn: subscribeOzonetelLiveEvents,
    onSuccess: result => {
      toast.success('Live call events subscribed', {
        description:
          result.subscribeMessage ??
          result.message ??
          'Ozonetel live call events were subscribed successfully.',
      });
    },
    onError: error => {
      toast.error('Failed to subscribe live call events', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    },
  });

  const onSave = (): void => {
    let agentMapping: OzonetelAgentMap;
    setSaveError(null);
    setRoutingError(null);
    try {
      const parsed = JSON.parse(agentMappingText || '{}') as unknown;
      const validationError = validateAgentMapping(parsed);
      if (validationError) {
        setMappingError(validationError);
        return;
      }
      agentMapping = parsed as OzonetelAgentMap;
      setMappingError(null);
    } catch {
      setMappingError('Agent mapping must be valid JSON');
      return;
    }

    const normalizedRoutes = campaignRoutes
      .map(route => ({
        campaignName: route.campaignName.trim(),
        channelId: route.channelId.trim(),
      }))
      .filter(route => route.campaignName.length > 0 || route.channelId.length > 0);
    if (normalizedRoutes.some(route => !route.campaignName || !route.channelId)) {
      setRoutingError('Each campaign route needs both a campaign name and a call desk.');
      return;
    }
    const duplicateCampaign = normalizedRoutes.find(
      (route, index) =>
        normalizedRoutes.findIndex(
          candidate => candidate.campaignName.toLowerCase() === route.campaignName.toLowerCase(),
        ) !== index,
    );
    if (duplicateCampaign) {
      setRoutingError(`Campaign "${duplicateCampaign.campaignName}" is configured more than once.`);
      return;
    }
    const campaignRouting = Object.fromEntries(
      normalizedRoutes.map(route => [route.campaignName, route.channelId]),
    );

    mutation.mutate({
      apiKey,
      apiUser,
      baseUrl,
      ...(toolbarUrl ? { toolbarUrl } : {}),
      agentMapping,
      ticketRules: {
        ...ticketRules,
        defaultChannelId,
        campaignRouting,
        ...(ticketSubjectTemplate ? { ticketSubjectTemplate } : {}),
      },
    });
  };

  const copyValue = async (value: string | undefined, field: 'post-call'): Promise<void> => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => {
      setCopiedField(current => (current === field ? null : current));
    }, 2000);
  };

  if (isLoading) {
    return (
      <div className='bg-card p-3 rounded-xl border border-border text-sm text-muted-foreground'>
        Loading Ozonetel…
      </div>
    );
  }

  const hasApiKey = data?.configured ? true : apiKey.trim() !== '';
  const canSave = hasApiKey && apiUser.trim() !== '' && baseUrl.trim() !== '';
  const routingCount = Object.keys(data?.ticketRules?.campaignRouting ?? {}).length;
  const bindingLabel =
    data?.ticketRules?.defaultChannelId || routingCount > 0
      ? 'Routing configured'
      : 'No desk routing yet';
  const availableCampaigns = campaignsData?.campaigns ?? [];
  const campaignOptions: SelectorOption[] = Array.from(
    new Set(availableCampaigns.filter(Boolean)),
  ).map(campaignName => ({
    value: campaignName,
    label: campaignName,
    icon: null,
  }));
  const callDeskOptions: SelectorOption[] = callDeskChannels.map(channel => ({
    value: channel.id,
    label: channel.name || 'Unnamed call desk',
    icon: null,
  }));
  const connectionSummary = data?.configured ? 'Connected' : 'Needs setup';
  const defaultDeskName =
    callDeskChannels.find(channel => channel.id === defaultChannelId)?.name || 'No default desk';

  return (
    <>
      <div className='rounded-xl border border-border bg-card p-3'>
        <div className='flex flex-col gap-y-2'>
          <p className='text-sm font-medium text-foreground'>Ozonetel</p>

          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Phone size={14} className='flex-shrink-0' />
            <span className='truncate text-xs' title={`${connectionSummary} • ${bindingLabel}`}>
              {connectionSummary} • {bindingLabel}
            </span>
          </div>

          <p className='text-xs text-muted-foreground'>
            Workspace telephony source for call desks and campaign routing.
          </p>

          <div className='flex items-center gap-2 pt-1 flex-wrap'>
            <button
              type='button'
              onClick={() => setIsOpen(true)}
              className='inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted'
              data-track-category='workspace-ozonetel'
              data-track-name='OpenConfigModal'
            >
              <Settings2 size={14} />
              {data?.configured ? 'Manage setup' : 'Configure'}
            </button>
          </div>
        </div>
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title='Configure Ozonetel'
        className='max-w-6xl w-[96vw] rounded-[24px]'
      >
        <div className='flex max-h-[88vh] flex-col overflow-hidden rounded-[24px] bg-background text-foreground'>
          <div className='border-b border-border bg-[linear-gradient(180deg,rgba(244,248,252,0.96),rgba(255,255,255,0.98))] px-6 py-5'>
            <div className='flex items-start justify-between gap-4'>
              <div className='space-y-4'>
                <div>
                  <h2 className='text-xl font-semibold text-foreground'>Configure Ozonetel</h2>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    Manage the shared telephony connector once, then route campaigns across your
                    call desks.
                  </p>
                </div>
                <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                  <SummaryCard
                    label='Status'
                    value={data?.configured ? 'Configured' : 'Not configured'}
                  />
                  <SummaryCard label='Default Desk' value={defaultDeskName} />
                  <SummaryCard label='Campaign Rules' value={String(routingCount)} />
                </div>
              </div>
              <button
                type='button'
                onClick={() => setIsOpen(false)}
                className='rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                aria-label='Close'
                data-track-category='workspace-ozonetel'
                data-track-name='CloseConfigModal'
              >
                <X className='size-5' />
              </button>
            </div>
          </div>

          <div className='flex-1 overflow-y-auto px-6 py-6'>
            <div className='grid gap-5'>
              <SectionCard
                title='Connection'
                description='Core connector settings for the shared Ozonetel workspace integration.'
              >
                <div className='grid gap-4'>
                  <Field
                    label='API Key'
                    {...(data?.configured ? { help: 'Leave blank to keep the current key.' } : {})}
                  >
                    <input
                      type='password'
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      data-track-category='workspace-ozonetel'
                      data-track-name='EditApiKey'
                      placeholder={data?.configured ? '•••••••• (unchanged)' : 'Ozonetel API key'}
                      className={inputClass}
                    />
                  </Field>

                  <Field label='API Username'>
                    <input
                      value={apiUser}
                      onChange={e => setApiUser(e.target.value)}
                      data-track-category='workspace-ozonetel'
                      data-track-name='EditApiUser'
                      className={inputClass}
                    />
                  </Field>

                  <Field label='Base URL' help='Region-specific CCaaS API host.'>
                    <input
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      data-track-category='workspace-ozonetel'
                      data-track-name='EditBaseUrl'
                      className={inputClass}
                    />
                  </Field>

                  <Field
                    label='CloudAgent Toolbar URL'
                    help='Embedded agent toolbar iframe URL (optional).'
                  >
                    <input
                      value={toolbarUrl}
                      onChange={e => setToolbarUrl(e.target.value)}
                      data-track-category='workspace-ozonetel'
                      data-track-name='EditToolbarUrl'
                      placeholder='https://agent.ccaas.ozonetel.com/toolbar_widget/index.html'
                      className={inputClass}
                    />
                  </Field>

                  <Field
                    label='Webhook URL'
                    help='Xyne auto-generates the common ingest URL used for Ozonetel call events.'
                  >
                    <CopyField
                      value={data?.postCallWebhookURL}
                      onCopy={() => void copyValue(data?.postCallWebhookURL, 'post-call')}
                      copied={copiedField === 'post-call'}
                      placeholder='Save the workspace source to generate this URL.'
                    />
                  </Field>

                  <div>
                    <ActionButton
                      onClick={() => subscribeMutation.mutate()}
                      disabled={!data?.configured || subscribeMutation.isPending}
                      label={subscribeMutation.isPending ? 'Subscribing…' : 'Reconnect live events'}
                      trackName='SubscribeLiveEvents'
                      trackId='subscribe_ozonetel_live_events'
                    />
                  </div>

                  <Field
                    label='Agent Mapping (JSON)'
                    help='Map Xyne user emails or user IDs to Ozonetel agent IDs. Email keys are recommended.'
                  >
                    <textarea
                      value={agentMappingText}
                      onChange={e => setAgentMappingText(e.target.value)}
                      data-track-category='workspace-ozonetel'
                      data-track-name='EditAgentMapping'
                      rows={5}
                      className={`${inputClass} min-h-[132px] font-mono`}
                    />
                    {mappingError ? (
                      <div className='mt-1 text-xs text-red-500'>{mappingError}</div>
                    ) : null}
                  </Field>
                </div>
              </SectionCard>

              <SectionCard
                title='Routing'
                description='Control the fallback desk and route specific Ozonetel campaigns to the right call desk.'
              >
                <div className='grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]'>
                  <div className='space-y-4'>
                    <Field
                      label='Default Call Desk'
                      help='Fallback desk used when a campaign does not have its own route.'
                    >
                      <Select
                        value={defaultChannelId || '__none__'}
                        onValueChange={value =>
                          setDefaultChannelId(value === '__none__' ? '' : value)
                        }
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Select a default call desk' />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='__none__'>No default desk</SelectItem>
                          {callDeskChannels.map(channel => (
                            <SelectItem key={channel.id} value={channel.id}>
                              <span
                                className='block truncate'
                                title={channel.name || 'Unnamed call desk'}
                              >
                                {channel.name || 'Unnamed call desk'}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field
                      label='Ticket Subject Template'
                      help='Supported placeholders: {callType}, {agentId}, {monitorUcid}, {ucid}, {callerId}.'
                    >
                      <input
                        value={ticketSubjectTemplate}
                        onChange={e => setTicketSubjectTemplate(e.target.value)}
                        data-track-category='workspace-ozonetel'
                        data-track-name='EditSubjectTemplate'
                        className={inputClass}
                      />
                    </Field>

                    <Field
                      label='Create Ticket On'
                      help='Choose whether the telephony ticket is created on the first callback or only after the agent answers.'
                    >
                      <select
                        value={ticketRules.createTicketOnEvent ?? 'new_call'}
                        onChange={e =>
                          setTicketRules(prev => ({
                            ...prev,
                            createTicketOnEvent: e.target.value as 'new_call' | 'agent_answered',
                          }))
                        }
                        data-track-category='workspace-ozonetel'
                        data-track-name='SelectCreateTicketOn'
                        className={inputClass}
                      >
                        <option value='new_call'>New Call</option>
                        <option value='agent_answered'>Agent Answered</option>
                      </select>
                    </Field>

                    <div className='grid gap-3 rounded-[16px] border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] p-4'>
                      <div className='text-sm font-medium text-foreground'>
                        Allow ticket creation for
                      </div>
                      <ToggleRow
                        label='Inbound Calls'
                        checked={!!ticketRules.createTicketOnInbound}
                        onCheckedChange={checked =>
                          setTicketRules(prev => ({ ...prev, createTicketOnInbound: checked }))
                        }
                        trackName='ToggleInboundTicketCreation'
                      />
                      <ToggleRow
                        label='Manual Calls'
                        checked={!!ticketRules.createTicketOnManual}
                        onCheckedChange={checked =>
                          setTicketRules(prev => ({ ...prev, createTicketOnManual: checked }))
                        }
                        trackName='ToggleManualTicketCreation'
                      />
                      <ToggleRow
                        label='Preview Calls'
                        checked={!!ticketRules.createTicketOnPreview}
                        onCheckedChange={checked =>
                          setTicketRules(prev => ({ ...prev, createTicketOnPreview: checked }))
                        }
                        trackName='TogglePreviewTicketCreation'
                      />
                      <ToggleRow
                        label='Progressive Calls'
                        checked={!!ticketRules.createTicketOnProgressive}
                        onCheckedChange={checked =>
                          setTicketRules(prev => ({ ...prev, createTicketOnProgressive: checked }))
                        }
                        trackName='ToggleProgressiveTicketCreation'
                      />
                      <ToggleRow
                        label='Predictive Calls'
                        checked={!!ticketRules.createTicketOnPredictive}
                        onCheckedChange={checked =>
                          setTicketRules(prev => ({ ...prev, createTicketOnPredictive: checked }))
                        }
                        trackName='TogglePredictiveTicketCreation'
                      />
                    </div>
                  </div>

                  <div className='space-y-4'>
                    <div className='rounded-[16px] border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] p-4'>
                      <div className='flex items-start justify-between gap-3'>
                        <div>
                          <div className='text-sm font-medium text-foreground'>
                            Campaign Routing
                          </div>
                          <div className='mt-1 text-sm text-muted-foreground'>
                            Map each Ozonetel campaign to the call desk that should receive it.
                          </div>
                        </div>
                        <span className='rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground'>
                          {routingCount} active
                        </span>
                      </div>

                      {data?.configured && (
                        <div className='mt-4 rounded-[12px] border border-border bg-card px-3 py-2 text-xs text-muted-foreground'>
                          {isLoadingCampaigns
                            ? 'Loading campaigns from Ozonetel…'
                            : availableCampaigns.length > 0
                              ? `Loaded ${availableCampaigns.length} campaign${availableCampaigns.length === 1 ? '' : 's'} from Ozonetel.`
                              : 'No campaigns were returned by Ozonetel yet.'}
                        </div>
                      )}

                      <div className='mt-4 flex flex-col gap-3'>
                        {campaignRoutes.length === 0 ? (
                          <div className='rounded-[12px] border border-dashed border-border px-4 py-5 text-sm text-muted-foreground'>
                            No campaign-specific routes yet.
                          </div>
                        ) : (
                          campaignRoutes.map((route, index) => (
                            <div
                              key={`${index}-${route.campaignName}-${route.channelId}`}
                              className='grid items-center gap-2 rounded-[14px] border border-border bg-card/90 p-3 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]'
                            >
                              <EntitySelector
                                options={Array.from(
                                  new Map(
                                    [
                                      ...campaignOptions,
                                      ...(route.campaignName
                                        ? [
                                            {
                                              value: route.campaignName,
                                              label: route.campaignName,
                                              icon: null,
                                            } satisfies SelectorOption,
                                          ]
                                        : []),
                                    ].map(option => [option.value, option]),
                                  ).values(),
                                )}
                                selectedValue={route.campaignName || null}
                                onSelect={value =>
                                  setCampaignRoutes(current =>
                                    current.map((entry, entryIndex) =>
                                      entryIndex === index
                                        ? { ...entry, campaignName: value ?? '' }
                                        : entry,
                                    ),
                                  )
                                }
                                placeholder='Select Ozonetel campaign'
                                searchPlaceholder='Search campaigns'
                                width='100%'
                                inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                              />
                              <EntitySelector
                                options={callDeskOptions}
                                selectedValue={route.channelId || null}
                                onSelect={value =>
                                  setCampaignRoutes(current =>
                                    current.map((entry, entryIndex) =>
                                      entryIndex === index
                                        ? { ...entry, channelId: value ?? '' }
                                        : entry,
                                    ),
                                  )
                                }
                                placeholder='Select call desk'
                                searchPlaceholder='Search call desks'
                                width='100%'
                                inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                              />
                              <button
                                type='button'
                                onClick={() =>
                                  setCampaignRoutes(current =>
                                    current.filter((_, entryIndex) => entryIndex !== index),
                                  )
                                }
                                className='inline-flex shrink-0 items-center justify-center rounded-[10px] border border-border px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted'
                                data-track-category='workspace-ozonetel'
                                data-track-name='RemoveCampaignRoute'
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))
                        )}

                        <button
                          type='button'
                          onClick={() =>
                            setCampaignRoutes(current => [
                              ...current,
                              { campaignName: '', channelId: '' },
                            ])
                          }
                          className='inline-flex w-fit items-center gap-2 rounded-[12px] border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted'
                          data-track-category='workspace-ozonetel'
                          data-track-name='AddCampaignRoute'
                        >
                          <Plus size={14} />
                          Add campaign route
                        </button>

                        {routingError ? (
                          <div className='text-xs text-red-500'>{routingError}</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                {saveError ? <div className='text-sm text-red-500'>{saveError}</div> : null}
              </SectionCard>
            </div>
          </div>

          <div className='flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,249,252,0.94))] px-6 py-4'>
            <p className='text-sm text-muted-foreground'>
              Changes here affect the shared Ozonetel connector for this workspace.
            </p>
            <div className='flex flex-wrap items-center gap-3'>
              {mutation.isSuccess ? <span className='text-sm text-green-600'>Saved</span> : null}
              <Button
                type='button'
                variant='ghost'
                onClick={onSave}
                disabled={!canSave || mutation.isPending}
                className='rounded-[12px] border border-desk-accent bg-desk-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
                data-track-category='workspace-ozonetel'
                data-track-name='SaveConfig'
                trackId='save_ozonetel_config'
              >
                {mutation.isPending ? 'Saving…' : 'Save Ozonetel config'}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
};

function Field({
  label,
  help,
  className,
  children,
}: {
  label: string;
  help?: string | undefined;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label className='text-sm font-medium tracking-[-0.01em] text-foreground'>{label}</label>
      {help ? <div className='text-desk-helper'>{help}</div> : null}
      <div>{children}</div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      className={cn(
        'rounded-[20px] border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,250,252,0.92))] p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]',
        className,
      )}
    >
      <div className='mb-4 space-y-1'>
        <h3 className='text-base font-semibold tracking-[-0.01em] text-foreground'>{title}</h3>
        <p className='max-w-[720px] text-sm leading-6 text-muted-foreground'>{description}</p>
      </div>
      {children}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className='rounded-[16px] border border-border bg-background/90 px-3 py-3 shadow-sm'>
      <div className='text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground'>
        {label}
      </div>
      <div
        className='mt-1 truncate text-sm font-medium tracking-[-0.01em] text-foreground'
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  label,
  trackName,
  trackId,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  trackName: string;
  trackId?: string;
}): ReactElement {
  return (
    <Button
      type='button'
      variant='ghost'
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-[12px] border px-3 py-2 text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'border-border bg-background text-foreground hover:bg-muted',
      )}
      data-track-category='workspace-ozonetel'
      data-track-name={trackName}
      {...(trackId ? { trackId } : {})}
    >
      {label}
    </Button>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  trackName,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  trackName: string;
}): ReactElement {
  return (
    <label className='flex items-center justify-between gap-4 rounded-[12px] border border-border bg-background/80 px-3 py-2.5 shadow-sm'>
      <span className='text-sm text-foreground'>{label}</span>
      <input
        type='checkbox'
        checked={checked}
        onChange={e => onCheckedChange(e.target.checked)}
        data-track-category='workspace-ozonetel'
        data-track-name={trackName}
        className='h-4 w-4 rounded border-border text-desk-accent focus:ring-desk-accent'
      />
    </label>
  );
}

function CopyField({
  value,
  onCopy,
  copied,
  placeholder,
}: {
  value: string | undefined;
  onCopy: () => void;
  copied: boolean;
  placeholder: string;
}): ReactElement {
  return (
    <div className='max-w-[720px] rounded-[14px] border border-border bg-background px-3 py-2 shadow-sm'>
      <div className='flex items-start gap-3'>
        <code className='min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-foreground'>
          {value || placeholder}
        </code>
        <button
          type='button'
          onClick={onCopy}
          disabled={!value}
          data-track-category='workspace-ozonetel'
          data-track-name='CopyField'
          className='inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
        >
          {copied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
