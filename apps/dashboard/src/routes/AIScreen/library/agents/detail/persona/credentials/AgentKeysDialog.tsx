import { useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MultipleCrossCancelDefault, PencilEditLine, PlusDefault } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button/index';
import { Skeleton } from '@/components/ui/Skeleton';
import { Pill } from '../../../../shared/primitives/Pill';
import { V2Dialog } from '../../../../shared/primitives/V2Dialog';
import type { AgentProviderCredentialStatus } from './agentCredentialsService';
import { CredentialFormFields } from './CredentialFormFields';
import {
  CREDENTIAL_PROVIDERS,
  CREDENTIAL_PROVIDER_LABELS,
  EMPTY_CREDENTIAL_FORM,
  formFromCredential,
  supportsOauth,
  supportsReasoning,
  type CredentialForm,
  type CredentialProvider,
} from './credentialForm';
import {
  agentCredentialsKey,
  useAgentCredentialMutations,
  useAgentCredentials,
} from './useAgentCredentials';

const ICON_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

const SECTION_LABEL = 'text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground';

interface AgentKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  canManage: boolean;
}

const label = (provider: string): string => CREDENTIAL_PROVIDER_LABELS[provider] ?? provider;

function summarise(entry: AgentProviderCredentialStatus): string {
  if (entry.sharedCredentialName) return `Shared — ${entry.sharedCredentialName}`;
  const parts = [entry.model, entry.baseUrl, entry.reasoningEffort].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : (entry.authType ?? 'Configured');
}

export function AgentKeysDialog({
  open,
  onOpenChange,
  slug,
  canManage,
}: AgentKeysDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const { data: credentials, isLoading } = useAgentCredentials(slug, open);
  const { save, remove, saving, removing } = useAgentCredentialMutations(slug);

  const [form, setForm] = useState<CredentialForm | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);

  const configured = (credentials ?? []).filter(entry => entry.configured);
  const configuredKeys = new Set(configured.map(entry => entry.provider));
  const available = CREDENTIAL_PROVIDERS.filter(provider => !configuredKeys.has(provider));

  const reset = (): void => {
    setForm(null);
    setEditingProvider(null);
  };

  const editing = editingProvider !== null;
  // The OAuth exchange writes the credential itself, so Save only carries the
  // model/base-URL fields — requiring a pasted key there is what made the
  // OAuth option unusable.
  const oauthPath =
    form !== null && form.authType === 'oauth_token' && supportsOauth(form.provider);
  const canSubmit = form !== null && (editing || oauthPath || form.apiKey.trim().length > 0);

  const submit = async (): Promise<void> => {
    if (!form || !canSubmit) return;
    await save({
      provider: form.provider,
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      ...(form.model.trim() ? { model: form.model.trim() } : {}),
      ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
      authType: form.authType,
      ...(supportsReasoning(form.provider)
        ? { reasoningEffort: form.reasoningEffort === '' ? null : form.reasoningEffort }
        : {}),
    });
    reset();
  };

  return (
    <V2Dialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title='Agent keys'
      description='Provider keys this agent runs with.'
      testId='agent-keys-dialog'
      footer={
        form === null ? (
          <Button
            variant='ghost'
            onClick={() => onOpenChange(false)}
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: done agent keys'
          >
            Done
          </Button>
        ) : (
          <>
            <Button
              variant='ghost'
              onClick={reset}
              disabled={saving}
              className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: cancel agent key'
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              loading={saving}
              disabled={!canSubmit}
              className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: save agent key'
            >
              Save
            </Button>
          </>
        )
      }
    >
      <p className='text-sm font-normal leading-5 text-muted-foreground'>
        Without a key here, everyone falls through to their own provider, or to Spaces.
      </p>

      <section className='flex w-full flex-col gap-3'>
        <span className={SECTION_LABEL}>Configured</span>

        {isLoading ? (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-11 w-full rounded-[10px]' />
            <Skeleton className='h-11 w-full rounded-[10px]' />
          </div>
        ) : configured.length === 0 ? (
          <p className='text-sm font-normal leading-5 text-muted-foreground'>No agent keys yet.</p>
        ) : (
          <div className='flex w-full flex-col gap-2'>
            {configured.map(entry => (
              <div
                key={entry.provider}
                className='flex min-h-11 w-full items-center gap-2 rounded-[10px] border-[0.8px] border-border bg-muted px-3 py-2'
              >
                <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <span className='truncate text-sm font-medium leading-5 text-foreground'>
                    {label(entry.provider)}
                  </span>
                  <span className='truncate text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
                    {summarise(entry)}
                  </span>
                </div>
                <Pill tone='success'>Configured</Pill>
                {canManage && (
                  <>
                    <button
                      type='button'
                      onClick={() => {
                        setEditingProvider(entry.provider);
                        setForm(formFromCredential(entry));
                      }}
                      aria-label={`Edit ${label(entry.provider)} credential`}
                      data-track-category='Claw Agents'
                      data-track-name='Agent detail v2: edit agent key'
                      className={ICON_BUTTON}
                    >
                      <PencilEditLine className='size-4' aria-hidden />
                    </button>
                    <button
                      type='button'
                      onClick={() => void remove(entry.provider)}
                      disabled={removing}
                      aria-label={`Remove ${label(entry.provider)} credential`}
                      data-track-category='Claw Agents'
                      data-track-name='Agent detail v2: remove agent key'
                      className={ICON_BUTTON}
                    >
                      {removing ? (
                        <Loader2 className='size-4 animate-spin' aria-hidden />
                      ) : (
                        <MultipleCrossCancelDefault className='size-4' aria-hidden />
                      )}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {canManage && form === null && available.length > 0 && (
        <section className='flex w-full flex-col gap-3'>
          <span className={SECTION_LABEL}>Add a key</span>
          <div className='flex flex-wrap items-start gap-2'>
            {available.map((provider: CredentialProvider) => (
              <button
                key={provider}
                type='button'
                onClick={() => {
                  setEditingProvider(null);
                  setForm({ ...EMPTY_CREDENTIAL_FORM, provider });
                }}
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: add agent key'
                className='flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-dashed border-border bg-card px-2 transition-colors hover:bg-muted/50'
              >
                <span className='max-w-[200px] truncate text-sm font-medium leading-5 text-foreground/80'>
                  {label(provider)}
                </span>
                <PlusDefault className='size-3 shrink-0 text-muted-foreground' aria-hidden />
              </button>
            ))}
          </div>
        </section>
      )}

      {form !== null && (
        <section className='flex w-full flex-col gap-3'>
          <span className={SECTION_LABEL}>
            {editing ? `Edit ${label(form.provider)}` : `New ${label(form.provider)} key`}
          </span>
          <CredentialFormFields
            form={form}
            onChange={setForm}
            editing={editing}
            slug={slug}
            onOauthConnected={() => {
              void queryClient.invalidateQueries({ queryKey: agentCredentialsKey(slug) });
              // The exchange already stored the bundle. Stay open in edit mode so
              // a model/base URL can follow — the backend allows that update
              // without an apiKey precisely because OAuth saved the credential.
              setEditingProvider(form.provider);
              setForm({ ...form, apiKey: '' });
            }}
          />
        </section>
      )}
    </V2Dialog>
  );
}
