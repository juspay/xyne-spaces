import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  deleteDeskCallSettings,
  getCallProviders,
  getCallRoutingKeys,
  getDeskCallSettings,
  getTelephonyErrorMessage,
  getTelephonyFieldErrors,
  listCallConnections,
  saveDeskCallSettings,
  TELEPHONY_QUERY_KEYS,
  type CreateTicketOnEvent,
  type DeskCallSettings,
  type DeskCallSettingsInput,
} from '../../../../services/clients/telephonyApi';
import { useConfirmDialog } from '../../../../hooks/useConfirmDialog';
import { EntityMultiSelector } from '../../../ui/EntitySelector/EntityMultiSelector';
import type { SelectorOption } from '../../../ui/EntitySelector/EntitySelector.types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/Select';
import { Switch } from '../../../ui/Switch';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

const inputClass =
  'w-full max-w-[400px] rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent';
const secondaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50';

interface Draft {
  connectionId: string;
  isDefault: boolean;
  routingKeys: string[];
  createTicketOnEvent: CreateTicketOnEvent;
  /** Null means every call type the provider has. */
  callTypes: string[] | null;
  subjectTemplate: string;
  phoneFieldNames: string[];
}

function toDraft(settings: DeskCallSettings | null | undefined): Draft {
  return {
    connectionId: settings?.connectionId ?? '',
    isDefault: settings?.isDefault ?? false,
    routingKeys: settings?.routingKeys ?? [],
    createTicketOnEvent: settings?.ticketRules.createTicketOnEvent ?? 'new_call',
    callTypes: settings ? settings.ticketRules.callTypes : null,
    subjectTemplate: settings?.ticketRules.subjectTemplate ?? '',
    phoneFieldNames: settings?.phoneFieldNames ?? [],
  };
}

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-[8px]'>
      <div>
        <div className='text-sm font-medium text-foreground'>{title}</div>
        {help ? <div className='text-desk-helper w-full max-w-[480px]'>{help}</div> : null}
      </div>
      {children}
    </div>
  );
}

function FieldError({ message }: { message?: string | undefined }): React.ReactElement | null {
  return message ? <div className='text-xs text-red-500'>{message}</div> : null;
}

export const TelephonyTab: React.FC<{ form: DeskSettingsForm }> = ({ form }) => {
  const { channelId, canManage, isCall } = form;
  const queryClient = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const enabled = canManage && !!channelId;

  const { data: providers = [] } = useQuery({
    queryKey: TELEPHONY_QUERY_KEYS.providers,
    queryFn: getCallProviders,
    enabled,
  });
  const { data: connections = [], isLoading: loadingConnections } = useQuery({
    queryKey: TELEPHONY_QUERY_KEYS.connections,
    queryFn: listCallConnections,
    enabled,
  });
  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: TELEPHONY_QUERY_KEYS.deskSettings(channelId ?? ''),
    queryFn: () => getDeskCallSettings(channelId ?? ''),
    enabled,
  });

  const saved = useMemo(() => toDraft(settings), [settings]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  useEffect(() => {
    setDraft(saved);
    setFieldErrors({});
  }, [saved]);

  const connection = connections.find(candidate => candidate.id === draft.connectionId);
  const provider = providers.find(candidate => candidate.id === connection?.provider);
  const routingKeyLabel = provider?.routingKeyLabel ?? 'Campaign';
  const { data: routingKeys = [], isLoading: loadingRoutingKeys } = useQuery({
    queryKey: TELEPHONY_QUERY_KEYS.routingKeys(draft.connectionId),
    queryFn: () => getCallRoutingKeys(draft.connectionId),
    enabled: enabled && isCall && !!draft.connectionId && !!provider?.supportsRoutingKeys,
    retry: false,
  });

  const allCallTypeIds = (provider?.callTypes ?? []).map(callType => callType.id);
  const selectedCallTypes = draft.callTypes ?? allCallTypeIds;
  const routingOptions: SelectorOption[] = [...new Set([...routingKeys, ...draft.routingKeys])].map(
    key => ({ value: key, label: key, icon: null }),
  );
  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const refresh = (next: DeskCallSettings | null): void => {
    queryClient.setQueryData(TELEPHONY_QUERY_KEYS.deskSettings(channelId ?? ''), next);
    void queryClient.invalidateQueries({ queryKey: TELEPHONY_QUERY_KEYS.connections });
    void queryClient.invalidateQueries({ queryKey: ['call-softphone'] });
  };

  const saveMutation = useMutation({
    mutationFn: (input: DeskCallSettingsInput) => saveDeskCallSettings(channelId ?? '', input),
    onSuccess: next => {
      refresh(next);
      toast.success('Telephony settings saved');
    },
    onError: error => {
      setFieldErrors(getTelephonyFieldErrors(error));
      toast.error('Could not save telephony settings', {
        description: getTelephonyErrorMessage(error),
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => deleteDeskCallSettings(channelId ?? ''),
    onSuccess: () => {
      refresh(null);
      toast.success('Call connection removed from this desk');
    },
    onError: error => {
      toast.error('Could not remove the call connection', {
        description: getTelephonyErrorMessage(error),
      });
    },
  });

  if (!channelId) return null;
  if (!canManage) {
    return (
      <p className='text-desk-helper'>
        Only the desk owner or a channel admin can change this desk’s telephony settings.
      </p>
    );
  }
  if (loadingConnections || loadingSettings) {
    return <p className='text-desk-helper'>Loading telephony settings…</p>;
  }

  const onSave = (): void => {
    setFieldErrors({});
    saveMutation.mutate({
      connectionId: draft.connectionId,
      ...(isCall
        ? {
            isDefault: draft.isDefault,
            routingKeys: draft.routingKeys,
            ticketRules: {
              createTicketOnEvent: draft.createTicketOnEvent,
              callTypes: selectedCallTypes,
              ...(draft.subjectTemplate.trim()
                ? { subjectTemplate: draft.subjectTemplate.trim() }
                : {}),
            },
          }
        : { phoneFieldNames: draft.phoneFieldNames.map(name => name.trim()).filter(Boolean) }),
    });
  };

  const onRemove = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Remove the call connection from this desk?',
      description: isCall
        ? 'Calls stop creating tickets on this desk.'
        : 'Agents can no longer call from this desk’s tickets.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (confirmed) removeMutation.mutate();
  };

  const toggleCallType = (callTypeId: string, checked: boolean): void => {
    setDraft(current => {
      const base = current.callTypes ?? allCallTypeIds;
      return {
        ...current,
        callTypes: checked
          ? [...new Set([...base, callTypeId])]
          : base.filter(candidate => candidate !== callTypeId),
      };
    });
  };

  return (
    <div className='flex flex-col gap-[28px]'>
      <Section
        title='Call connection'
        help={
          isCall
            ? 'Calls from this connection reach this desk when their campaign is routed here, or when this is the connection’s default desk.'
            : 'Agents call customers from this desk’s tickets through this connection’s toolbar.'
        }
      >
        {connections.length === 0 ? (
          <p className='text-desk-helper'>
            No call connections yet. An admin adds them in Desk Integrations → Telephony.
          </p>
        ) : (
          <div className='w-full max-w-[400px]'>
            <Select
              value={draft.connectionId}
              onValueChange={value =>
                setDraft(current => ({
                  ...current,
                  connectionId: value,
                  // Campaigns and call types belong to the previous connection's account.
                  ...(value !== current.connectionId ? { routingKeys: [], callTypes: null } : {}),
                }))
              }
            >
              <SelectTrigger className='w-full'>
                <SelectValue placeholder='Select a call connection' />
              </SelectTrigger>
              <SelectContent>
                {connections.map(candidate => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name} · {candidate.providerName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <FieldError message={fieldErrors['connectionId']?.[0]} />
      </Section>

      {isCall && draft.connectionId ? (
        <>
          <Section
            title={`${routingKeyLabel}s`}
            help={`Calls from these ${routingKeyLabel.toLowerCase()}s create tickets on this desk.`}
          >
            <div className='w-full max-w-[400px]'>
              <EntityMultiSelector
                options={routingOptions}
                selectedValues={draft.routingKeys}
                onMultiSelect={values => setDraft(current => ({ ...current, routingKeys: values }))}
                allowCreate={true}
                onCreateOption={value =>
                  setDraft(current => ({
                    ...current,
                    routingKeys: [...new Set([...current.routingKeys, value.trim()])].filter(
                      Boolean,
                    ),
                  }))
                }
                isLoading={loadingRoutingKeys}
                placeholder={`Select ${routingKeyLabel.toLowerCase()}s`}
                searchPlaceholder={`Search ${routingKeyLabel.toLowerCase()}s`}
                showSearch={true}
                width='100%'
              />
            </div>
            <FieldError message={fieldErrors['routingKeys']?.[0]} />
          </Section>

          <Section
            title='Default desk for this connection'
            help={`Also take calls whose ${routingKeyLabel.toLowerCase()} no desk routes.`}
          >
            <Switch
              variant='desk'
              checked={draft.isDefault}
              onCheckedChange={checked => setDraft(current => ({ ...current, isDefault: checked }))}
              aria-label='Default desk for this connection'
            />
            <FieldError message={fieldErrors['isDefault']?.[0]} />
          </Section>

          <Section
            title='Create ticket on'
            help='Create the ticket on the first call event, or only once an agent answers.'
          >
            <div className='w-full max-w-[400px]'>
              <Select
                value={draft.createTicketOnEvent}
                onValueChange={value =>
                  setDraft(current => ({
                    ...current,
                    createTicketOnEvent: value as CreateTicketOnEvent,
                  }))
                }
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='new_call'>New call</SelectItem>
                  <SelectItem value='agent_answered'>Agent answered</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Section>

          <Section title='Call types' help='Only these call types create tickets on this desk.'>
            <div className='flex w-full max-w-[400px] flex-col gap-[6px]'>
              {(provider?.callTypes ?? []).map(callType => (
                <label
                  key={callType.id}
                  className='flex items-center justify-between gap-4 rounded-[10px] border border-border bg-background px-3 py-2'
                >
                  <span className='text-sm text-foreground'>{callType.label}</span>
                  <input
                    type='checkbox'
                    checked={selectedCallTypes.includes(callType.id)}
                    onChange={e => toggleCallType(callType.id, e.target.checked)}
                    className='h-4 w-4 rounded border-border text-desk-accent focus:ring-desk-accent'
                    data-track-category='DeskSettings'
                    data-track-name={`ToggleCallType_${callType.id}`}
                  />
                </label>
              ))}
            </div>
          </Section>

          <Section
            title='Ticket subject template'
            help='Placeholders: {callType}, {agentId}, {monitorUcid}, {ucid}, {callerId}.'
          >
            <input
              value={draft.subjectTemplate}
              onChange={e => setDraft(current => ({ ...current, subjectTemplate: e.target.value }))}
              placeholder='{callType} call from {callerId} ({monitorUcid})'
              maxLength={300}
              className={inputClass}
              data-track-category='DeskSettings'
              data-track-name='EditCallSubjectTemplate'
            />
          </Section>
        </>
      ) : null}

      {!isCall && draft.connectionId ? (
        <Section
          title='Phone fields'
          help='Ticket fields holding numbers agents call, e.g. customer and driver. A toolbar call to one of these numbers is logged on the open ticket.'
        >
          <div className='flex w-full max-w-[400px] flex-col gap-2'>
            {draft.phoneFieldNames.map((fieldName, index) => (
              <div key={index} className='flex items-center gap-2'>
                <input
                  value={fieldName}
                  onChange={e =>
                    setDraft(current => ({
                      ...current,
                      phoneFieldNames: current.phoneFieldNames.map((entry, entryIndex) =>
                        entryIndex === index ? e.target.value : entry,
                      ),
                    }))
                  }
                  placeholder='Customer Phone'
                  className={inputClass}
                  data-track-category='DeskSettings'
                  data-track-name='EditPhoneFieldName'
                />
                <button
                  type='button'
                  onClick={() =>
                    setDraft(current => ({
                      ...current,
                      phoneFieldNames: current.phoneFieldNames.filter(
                        (_, entryIndex) => entryIndex !== index,
                      ),
                    }))
                  }
                  aria-label='Remove phone field'
                  className={secondaryButtonClass}
                  data-track-category='DeskSettings'
                  data-track-name='RemovePhoneFieldName'
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type='button'
              onClick={() =>
                setDraft(current => ({
                  ...current,
                  phoneFieldNames: [...current.phoneFieldNames, ''],
                }))
              }
              className={`${secondaryButtonClass} w-fit`}
              data-track-category='DeskSettings'
              data-track-name='AddPhoneFieldName'
            >
              <Plus size={14} />
              Add phone field
            </button>
          </div>
        </Section>
      ) : null}

      <div className='flex items-center gap-[8px]'>
        <button
          type='button'
          onClick={onSave}
          disabled={!isDirty || !draft.connectionId || saveMutation.isPending}
          className='rounded-[10px] border border-desk-accent bg-desk-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50'
          data-track-category='DeskSettings'
          data-track-name='SaveTelephony'
        >
          {saveMutation.isPending ? 'Saving…' : 'Save telephony settings'}
        </button>
        {isDirty ? (
          <button
            type='button'
            onClick={() => {
              setDraft(saved);
              setFieldErrors({});
            }}
            className={secondaryButtonClass}
            data-track-category='DeskSettings'
            data-track-name='CancelTelephony'
          >
            Cancel
          </button>
        ) : null}
        {settings ? (
          <button
            type='button'
            onClick={() => void onRemove()}
            disabled={removeMutation.isPending}
            className={`${secondaryButtonClass} ml-auto text-red-600`}
            data-track-category='DeskSettings'
            data-track-name='RemoveTelephony'
          >
            Remove from desk
          </button>
        ) : null}
      </div>
      <ConfirmDialog />
    </div>
  );
};
