import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  createCallConnection,
  getCallConnection,
  getTelephonyFieldErrors,
  subscribeCallConnection,
  TELEPHONY_QUERY_KEYS,
  updateCallConnection,
  type CallAgentMap,
  type CallConnectionInput,
  type CallConnectionMutationResult,
  type CallProviderInfo,
} from '../../../services/clients/telephonyApi';
import { getApiErrorMessage } from '../../../utils/apiError';
import { Dialog } from '../../ui/Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';

const inputClass =
  'w-full rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-xs focus:outline-hidden focus-visible:ring-1 focus-visible:ring-desk-accent';

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

function defaultValues(provider: CallProviderInfo | undefined): Record<string, string> {
  return Object.fromEntries(
    (provider?.fields ?? []).map(field => [field.key, field.defaultValue ?? '']),
  );
}

function reportSaved(result: CallConnectionMutationResult): void {
  if (!result.subscribe) {
    toast.success('Connection saved');
  } else if (result.subscribe.ok) {
    toast.success('Connection saved', { description: 'Live call events are subscribed.' });
  } else {
    toast.warning('Connection saved, but live call events were not subscribed', {
      description: `${result.subscribe.message} Use "Reconnect live events" to try again.`,
    });
  }
}

interface CallConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null adds a connection. */
  connectionId: string | null;
  providers: CallProviderInfo[];
  /** Names of the desks using this connection. */
  deskNames: string[];
}

export const CallConnectionDialog = ({
  open,
  onOpenChange,
  connectionId,
  providers,
  deskNames,
}: CallConnectionDialogProps): ReactElement => {
  const queryClient = useQueryClient();
  const isEdit = connectionId !== null;
  const { data: existing, isLoading } = useQuery({
    queryKey: TELEPHONY_QUERY_KEYS.connection(connectionId ?? ''),
    queryFn: () => getCallConnection(connectionId ?? ''),
    enabled: open && isEdit,
  });

  const [providerId, setProviderId] = useState('');
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [agentMappingText, setAgentMappingText] = useState('{}');
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const provider = providers.find(candidate => candidate.id === (existing?.provider ?? providerId));

  // Reset the form each time the dialog opens, from the saved connection or the first provider.
  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setSaveError(null);
    setMappingError(null);
    if (isEdit) {
      if (!existing) return;
      setName(existing.name);
      setValues({ ...existing.credentials });
      setAgentMappingText(JSON.stringify(existing.agentMapping ?? {}, null, 2));
      return;
    }
    const initial = providers[0];
    setProviderId(initial?.id ?? '');
    setName(initial?.displayName ?? '');
    setValues(defaultValues(initial));
    setAgentMappingText('{}');
  }, [open, isEdit, existing, providers]);

  const mutation = useMutation({
    mutationFn: (input: CallConnectionInput) =>
      isEdit && connectionId
        ? updateCallConnection(connectionId, input)
        : createCallConnection({ ...input, provider: providerId }),
    onSuccess: result => {
      queryClient.setQueryData(
        TELEPHONY_QUERY_KEYS.connection(result.connection.id),
        result.connection,
      );
      void queryClient.invalidateQueries({ queryKey: TELEPHONY_QUERY_KEYS.connections });
      void queryClient.invalidateQueries({ queryKey: TELEPHONY_QUERY_KEYS.softphoneAll });
      reportSaved(result);
      onOpenChange(false);
    },
    onError: error => {
      setFieldErrors(getTelephonyFieldErrors(error));
      setSaveError(getApiErrorMessage(error, 'Please check the settings and try again.'));
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: () => subscribeCallConnection(connectionId ?? ''),
    onSuccess: result => {
      toast.success('Live call events subscribed', { description: result.message });
    },
    onError: error => {
      toast.error('Failed to subscribe live call events', {
        description: getApiErrorMessage(error),
      });
    },
  });

  const onProviderChange = (nextId: string): void => {
    const next = providers.find(candidate => candidate.id === nextId);
    if (name === provider?.displayName || !name.trim()) setName(next?.displayName ?? '');
    setProviderId(nextId);
    setValues(defaultValues(next));
    setFieldErrors({});
  };

  const onSave = (): void => {
    setSaveError(null);
    let agentMapping: CallAgentMap;
    try {
      const parsed = JSON.parse(agentMappingText || '{}') as unknown;
      const validationError = validateAgentMapping(parsed);
      if (validationError) {
        setMappingError(validationError);
        return;
      }
      agentMapping = parsed as CallAgentMap;
      setMappingError(null);
    } catch {
      setMappingError('Agent mapping must be valid JSON');
      return;
    }
    mutation.mutate({ name: name.trim(), credentials: values, agentMapping });
  };

  const copyWebhookUrl = async (): Promise<void> => {
    if (!existing?.webhookUrl) return;
    await navigator.clipboard.writeText(existing.webhookUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  // On edit a blank secret keeps the saved one, so only new connections must fill it.
  const missingRequired = (provider?.fields ?? []).some(
    field =>
      field.required && !(values[field.key] ?? '').trim() && !(isEdit && field.type === 'secret'),
  );
  const canSave = !!provider && name.trim().length > 0 && !missingRequired && !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Manage call connection' : 'Add call connection'}
      className='max-w-3xl w-[96vw] rounded-[24px]'
    >
      <div className='flex max-h-[88vh] flex-col overflow-hidden rounded-[24px] bg-background text-foreground'>
        <div className='flex items-start justify-between gap-4 border-b border-border px-6 py-5'>
          <div>
            <h2 className='text-xl font-semibold text-foreground'>
              {isEdit ? `Manage ${existing?.name ?? 'call connection'}` : 'Add call connection'}
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              One provider account. Each call desk picks its connection in Desk Settings →
              Telephony.
            </p>
          </div>
          <button
            type='button'
            onClick={() => onOpenChange(false)}
            className='rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            aria-label='Close'
            data-track-category='workspace-telephony'
            data-track-name='CloseConnectionDialog'
          >
            <X className='size-5' />
          </button>
        </div>

        <div className='flex-1 overflow-y-auto px-6 py-6'>
          {isEdit && isLoading ? (
            <div className='text-sm text-muted-foreground'>Loading connection…</div>
          ) : (
            <div className='grid gap-5'>
              <SectionCard title='Connection'>
                <div className='grid gap-4'>
                  {!isEdit && providers.length > 1 ? (
                    <Field label='Provider'>
                      <Select value={providerId} onValueChange={onProviderChange}>
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Select a provider' />
                        </SelectTrigger>
                        <SelectContent>
                          {providers.map(candidate => (
                            <SelectItem key={candidate.id} value={candidate.id}>
                              {candidate.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : null}

                  <Field
                    label='Name'
                    help='Shown when a desk picks its connection, e.g. "Ozonetel Bangalore".'
                    error={fieldErrors['name']?.[0]}
                  >
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      maxLength={80}
                      data-track-category='workspace-telephony'
                      data-track-name='EditConnectionName'
                      className={inputClass}
                    />
                  </Field>

                  {(provider?.fields ?? []).map(field => {
                    const keepsSaved = isEdit && field.type === 'secret';
                    return (
                      <Field
                        key={field.key}
                        label={field.label}
                        help={keepsSaved ? 'Leave blank to keep the current value.' : field.help}
                        error={fieldErrors[field.key]?.[0]}
                      >
                        <input
                          type={field.type === 'secret' ? 'password' : 'text'}
                          value={values[field.key] ?? ''}
                          onChange={e =>
                            setValues(current => ({ ...current, [field.key]: e.target.value }))
                          }
                          placeholder={keepsSaved ? '•••••••• (unchanged)' : field.placeholder}
                          autoComplete={field.type === 'secret' ? 'new-password' : 'off'}
                          data-track-category='workspace-telephony'
                          data-track-name={`EditField_${field.key}`}
                          className={inputClass}
                        />
                      </Field>
                    );
                  })}

                  {isEdit ? (
                    <Field
                      label='Webhook URL'
                      help='Xyne registers this URL with the provider on save. Use it if you set the webhook up by hand.'
                    >
                      <div className='max-w-[720px] rounded-[14px] border border-border bg-background px-3 py-2 shadow-xs'>
                        <div className='flex items-start gap-3'>
                          <code className='min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-foreground'>
                            {existing?.webhookUrl ?? 'Unavailable'}
                          </code>
                          <button
                            type='button'
                            onClick={() => void copyWebhookUrl()}
                            disabled={!existing?.webhookUrl}
                            data-track-category='workspace-telephony'
                            data-track-name='CopyWebhookUrl'
                            className='inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                          >
                            {copied ? (
                              <Check className='size-3.5' />
                            ) : (
                              <Copy className='size-3.5' />
                            )}
                            {copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    </Field>
                  ) : null}

                  {isEdit && provider?.supportsSubscribe ? (
                    <div>
                      <button
                        type='button'
                        onClick={() => subscribeMutation.mutate()}
                        disabled={subscribeMutation.isPending}
                        className='rounded-[12px] border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                        data-track-category='workspace-telephony'
                        data-track-name='SubscribeLiveEvents'
                      >
                        {subscribeMutation.isPending ? 'Subscribing…' : 'Reconnect live events'}
                      </button>
                    </div>
                  ) : null}

                  <Field
                    label='Agent Mapping (JSON)'
                    help='Map Xyne user emails or user IDs to the provider agent IDs. Email keys are recommended.'
                    error={mappingError ?? fieldErrors['agentMapping']?.[0]}
                  >
                    <textarea
                      value={agentMappingText}
                      onChange={e => setAgentMappingText(e.target.value)}
                      data-track-category='workspace-telephony'
                      data-track-name='EditAgentMapping'
                      rows={5}
                      className={`${inputClass} min-h-[132px] font-mono`}
                    />
                  </Field>
                </div>
              </SectionCard>

              {isEdit ? (
                <SectionCard title='Desks using this connection'>
                  {deskNames.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      No desk uses this connection yet. Pick it in a desk’s Settings → Telephony.
                    </p>
                  ) : (
                    <ul className='flex flex-wrap gap-2'>
                      {deskNames.map((deskName, index) => (
                        <li
                          key={`${deskName}-${index}`}
                          className='rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground'
                        >
                          {deskName}
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
              ) : null}
            </div>
          )}
        </div>

        <div className='flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4'>
          <p className='min-w-0 flex-1 text-sm text-red-500'>{saveError}</p>
          <button
            type='button'
            onClick={onSave}
            disabled={!canSave}
            className='rounded-[12px] border border-desk-accent bg-desk-accent px-4 py-2 text-sm font-medium text-white shadow-xs transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
            data-track-category='workspace-telephony'
            data-track-name='SaveConnection'
          >
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save connection' : 'Add connection'}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

function Field({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string | undefined;
  error?: string | null | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='flex flex-col gap-1.5'>
      <label className='text-sm font-medium tracking-[-0.01em] text-foreground'>{label}</label>
      {help ? <div className='text-desk-helper'>{help}</div> : null}
      <div>{children}</div>
      {error ? <div className='text-xs text-red-500'>{error}</div> : null}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className='rounded-[20px] border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,250,252,0.92))] p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]'>
      <h3 className='mb-4 text-base font-semibold tracking-[-0.01em] text-foreground'>{title}</h3>
      {children}
    </section>
  );
}
