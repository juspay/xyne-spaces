import { ReactElement, useEffect, useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Code2,
  Copy,
  Github,
  KeyRound,
  Loader2,
  Plane,
  Plug,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import {
  DETAIL_NESTED_HINT_CLASS,
  DETAIL_NESTED_TITLE_CLASS,
  DETAIL_SELECT_TRIGGER_CLASS_FOR,
  DetailEmpty,
  DetailGroup,
  DetailRow,
  DetailSection,
  TWIN_SETTINGS_TITLE_CLASS,
  TWIN_SURFACE_FILL_CLASS,
} from '@/routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { useAuth } from '@/hooks/useAuth';
import { clawSettingsKey, useClawSettings } from '@/hooks/useClawSettings';
import {
  deleteProviderCredential,
  deleteSubagentRouting,
  exchangeCodexOauth,
  initiateCopilotGitHubLogin,
  listClaudeModelsForUser,
  listCodexModelsForUser,
  listCopilotModelsForUser,
  listProviderCredentials,
  pollCopilotGitHubLogin,
  startCodexOauth,
  upsertProviderCredential,
  upsertSubagentRouting,
} from '@/services/claw/clawSettingsService';
import type {
  AuthType,
  ClaudeModelInfo,
  CodexOauthStart,
  GitHubDeviceCode,
  ProviderCredential,
  ProviderId,
  ProviderModelOption,
  ReasoningEffort,
} from '@/services/claw/clawSettingsTypes';

const PROVIDER_META: Record<ProviderId, { name: string; description: string; icon: typeof Plane }> =
  {
    copilot: {
      name: 'GitHub Copilot',
      description: 'Code suggestions and autocomplete',
      icon: Plane,
    },
    claude: {
      name: 'Anthropic Claude',
      description: 'Reasoning and coding assistance',
      icon: Sparkles,
    },
    codex: {
      name: 'OpenAI (Codex)',
      description: 'Code generation and editing',
      icon: Code2,
    },
  };

const PROVIDERS: ProviderId[] = ['copilot', 'claude', 'codex'];
const EMPTY_CREDENTIALS: ProviderCredential[] = [];
const EMPTY_ROUTING: Array<{ subagentName: string; provider: string }> = [];
const EMPTY_SUBAGENTS: string[] = [];

const SUBAGENT_NAMES: Record<string, string> = {
  spaces: 'Spaces Agent',
  bitbucket: 'Bitbucket Agent',
  grafana: 'Grafana Agent',
  deepwiki: 'DeepWiki Agent',
  context7: 'Context7 Agent',
  pgm: 'PGM Agent',
};

const DEFAULT_REASONING: ReasoningEffort = 'medium';
const AGENT_ASSIGNMENT_VISIBLE_COUNT = 7;

const agentDisplayName = (name: string): string =>
  SUBAGENT_NAMES[name] ?? `${name.charAt(0).toUpperCase()}${name.slice(1)} Agent`;

const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const providerDisplayName = (provider: string): string =>
  PROVIDER_META[provider as ProviderId]?.name ?? provider;

const modelLabel = (model: ClaudeModelInfo | ProviderModelOption): string =>
  'displayName' in model ? model.displayName : model.name;

const ProviderCard = ({
  id,
  credential,
  isDefault,
  onOpenDialog,
}: {
  id: ProviderId;
  credential: ProviderCredential | undefined;
  isDefault: boolean;
  onOpenDialog: () => void;
}): ReactElement => {
  const meta = PROVIDER_META[id];
  const Icon = meta.icon;
  const isConnected = credential?.hasApiKey ?? false;

  return (
    <div
      data-testid={`claw-settings-provider-${id}`}
      className={cn('flex min-h-36 flex-col gap-3 rounded-2xl p-4', TWIN_SURFACE_FILL_CLASS)}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              isConnected
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-background text-muted-foreground',
            )}
          >
            <Icon className='size-5' />
          </div>
          <div className='min-w-0'>
            <div className='flex min-w-0 items-center gap-2'>
              <h3 className={cn('truncate', DETAIL_NESTED_TITLE_CLASS.twin)}>{meta.name}</h3>
              {isDefault && <Badge variant='primary'>Default</Badge>}
            </div>
            <p className={cn('truncate', DETAIL_NESTED_HINT_CLASS.twin)}>{meta.description}</p>
          </div>
        </div>
        {isConnected && (
          <Badge variant='success' className='gap-1'>
            <span className='size-1.5 rounded-full bg-white' />
            Connected
          </Badge>
        )}
      </div>

      {isConnected && credential?.model && (
        <p className={DETAIL_NESTED_HINT_CLASS.twin}>
          Model: <span className='text-foreground'>{credential.model}</span>
        </p>
      )}

      <div className='mt-auto flex justify-end'>
        <Button size='sm' variant={isConnected ? 'secondary' : 'default'} onClick={onOpenDialog}>
          {isConnected ? 'Configure' : 'Connect'}
        </Button>
      </div>
    </div>
  );
};

const AIProvidersSection = ({
  credentials,
  defaultProvider,
  loading,
  userId,
  onMutate,
}: {
  credentials: ProviderCredential[];
  defaultProvider: string | null;
  loading: boolean;
  userId: string;
  onMutate: () => Promise<void>;
}): ReactElement => {
  const [activeDialog, setActiveDialog] = useState<ProviderId | null>(null);
  const credentialMap = useMemo(
    () => new Map(credentials.map(credential => [credential.provider, credential])),
    [credentials],
  );

  return (
    <DetailSection
      heading='title'
      typeScale='twin'
      headingClassName={TWIN_SETTINGS_TITLE_CLASS}
      label='AI Providers'
      className='gap-4'
    >
      <DetailSection
        heading='subcategory'
        typeScale='twin'
        label='Connect AI services your agents can use.'
      >
        {loading ? (
          <div className='grid grid-cols-1 gap-3 lg:grid-cols-3'>
            {PROVIDERS.map(provider => (
              <Skeleton key={provider} className='h-36 rounded-2xl' />
            ))}
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-3 lg:grid-cols-3'>
            {PROVIDERS.map(provider => (
              <ProviderCard
                key={provider}
                id={provider}
                credential={credentialMap.get(provider)}
                isDefault={provider === defaultProvider}
                onOpenDialog={() => setActiveDialog(provider)}
              />
            ))}
          </div>
        )}

        {activeDialog && (
          <ProviderConfigDialog
            provider={activeDialog}
            userId={userId}
            onClose={() => setActiveDialog(null)}
            onMutate={onMutate}
          />
        )}
      </DetailSection>
    </DetailSection>
  );
};

const ProviderConfigDialog = ({
  provider,
  userId,
  onClose,
  onMutate,
}: {
  provider: ProviderId;
  userId: string;
  onClose: () => void;
  onMutate: () => Promise<void>;
}): ReactElement => {
  const meta = PROVIDER_META[provider];

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={meta.name}
      description={meta.description}
      className='max-w-xl'
    >
      <div className='flex max-h-[85vh] flex-col overflow-y-auto p-6'>
        <div className='mb-5'>
          <h2 className='text-base font-semibold text-foreground'>{meta.name}</h2>
          <p className='text-sm text-muted-foreground'>{meta.description}</p>
        </div>
        {provider === 'copilot' ? (
          <CopilotConfigForm userId={userId} onMutate={onMutate} onClose={onClose} />
        ) : (
          <GenericProviderConfigForm
            provider={provider}
            userId={userId}
            onMutate={onMutate}
            onClose={onClose}
          />
        )}
      </div>
    </Dialog>
  );
};

const CopilotConfigForm = ({
  userId,
  onMutate,
  onClose,
}: {
  userId: string;
  onMutate: () => Promise<void>;
  onClose: () => void;
}): ReactElement => {
  const [device, setDevice] = useState<GitHubDeviceCode | null>(null);
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ProviderModelOption[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [currentModel, setCurrentModel] = useState('');

  useEffect(() => {
    let cancelled = false;
    listProviderCredentialsForDialog(userId, 'copilot')
      .then(credential => {
        if (cancelled) return;
        setHasKey(credential?.hasApiKey ?? false);
        setCurrentModel(credential?.model ?? '');
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!hasKey) return undefined;
    let cancelled = false;
    setModelsError(null);
    listCopilotModelsForUser(userId)
      .then(rows => {
        if (!cancelled) setModels(rows);
      })
      .catch(err => {
        if (!cancelled) setModelsError(errMsg(err, 'Failed to load models'));
      });
    return (): void => {
      cancelled = true;
    };
  }, [hasKey, userId]);

  useEffect(() => {
    if (!polling || !device) return undefined;
    let cancelled = false;

    const run = async (): Promise<void> => {
      while (!cancelled) {
        await new Promise(resolve => setTimeout(resolve, (device.interval + 1) * 1000));
        if (cancelled) break;
        try {
          const result = await pollCopilotGitHubLogin(userId);
          if (result.status === 'approved') {
            setPolling(false);
            setDevice(null);
            await onMutate();
            toast.success('GitHub Copilot connected');
            onClose();
            break;
          }
          if (result.status === 'slow_down') {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } catch (err) {
          if (!cancelled) {
            setError(errMsg(err, 'Polling failed'));
            setPolling(false);
          }
          break;
        }
      }
    };

    void run();
    return (): void => {
      cancelled = true;
    };
  }, [polling, device, userId, onMutate, onClose]);

  const startLogin = async (): Promise<void> => {
    setStarting(true);
    setError(null);
    try {
      const nextDevice = await initiateCopilotGitHubLogin(userId);
      setDevice(nextDevice);
      setPolling(true);
      window.open(nextDevice.verificationUri, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(errMsg(err, 'Failed to start GitHub login'));
    } finally {
      setStarting(false);
    }
  };

  const handleModelChange = async (model: string): Promise<void> => {
    setSaving(true);
    try {
      await upsertProviderCredential(userId, 'copilot', { model });
      setCurrentModel(model);
      await onMutate();
      toast.success('Copilot model saved');
    } catch (err) {
      toast.error(errMsg(err, 'Failed to save model'));
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setSaving(true);
    try {
      await deleteProviderCredential(userId, 'copilot');
      await onMutate();
      toast.success('GitHub Copilot disconnected');
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Disconnect failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex flex-col gap-4'>
      {!hasKey && !device && (
        <div className='flex flex-col gap-3'>
          <p className='text-sm text-muted-foreground'>
            Connect your GitHub account to use Copilot-powered code suggestions across all agents.
          </p>
          <Button onClick={() => void startLogin()} disabled={starting}>
            {starting ? <Loader2 className='size-4 animate-spin' /> : <Plug className='size-4' />}
            {starting ? 'Starting...' : 'Log in with GitHub'}
          </Button>
        </div>
      )}

      {hasKey && (
        <div className='flex flex-col gap-4'>
          <div className='flex items-center gap-2 text-sm text-emerald-600'>
            <CheckCircle2 className='size-4' />
            <span>Connected via GitHub</span>
          </div>

          {models && models.length > 0 && (
            <LabeledSelect
              label='Model'
              value={currentModel}
              options={models.map(model => ({ value: model.id, label: model.name }))}
              disabled={saving}
              onValueChange={handleModelChange}
            />
          )}
          {modelsError && <p className='text-xs text-amber-600'>{modelsError}</p>}

          <div className='flex gap-2'>
            <Button
              variant='secondary'
              onClick={() => void startLogin()}
              disabled={starting || saving}
            >
              <Github className='size-4' />
              Reconnect
            </Button>
            <Button variant='destructive' onClick={() => void handleDisconnect()} disabled={saving}>
              <Trash2 className='size-4' />
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {device && (
        <div className='flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4'>
          <p className='text-sm text-muted-foreground'>Enter this code on GitHub to authorize:</p>
          <div className='flex items-center gap-2'>
            <code className='rounded-md border border-border bg-background px-3 py-2 font-mono text-lg tracking-widest text-foreground'>
              {device.userCode}
            </code>
            <Button
              size='iconSm'
              variant='ghost'
              aria-label='Copy GitHub authorization code'
              onClick={() => void navigator.clipboard.writeText(device.userCode)}
            >
              <Copy className='size-4' />
            </Button>
          </div>
          <a
            href={device.verificationUri}
            target='_blank'
            rel='noreferrer'
            className='text-sm font-medium text-[color:var(--mention-color)] underline underline-offset-2'
          >
            {device.verificationUri}
          </a>
          {polling && (
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Loader2 className='size-3.5 animate-spin' />
              Waiting for authorization...
            </div>
          )}
        </div>
      )}

      {error && <p className='text-sm text-destructive'>{error}</p>}
    </div>
  );
};

const GenericProviderConfigForm = ({
  provider,
  userId,
  onMutate,
  onClose,
}: {
  provider: Exclude<ProviderId, 'copilot'>;
  userId: string;
  onMutate: () => Promise<void>;
  onClose: () => void;
}): ReactElement => {
  const isClaude = provider === 'claude';
  const isCodex = provider === 'codex';
  const [existing, setExisting] = useState<ProviderCredential | undefined>();
  const [apiKey, setApiKey] = useState('');
  const [authType, setAuthType] = useState<AuthType>('api_key');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING);
  const [models, setModels] = useState<Array<ClaudeModelInfo | ProviderModelOption> | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codexFlow, setCodexFlow] = useState<CodexOauthStart | null>(null);
  const [codexCode, setCodexCode] = useState('');
  const [codexBusy, setCodexBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listProviderCredentialsForDialog(userId, provider)
      .then(credential => {
        if (cancelled) return;
        setExisting(credential);
        setModel(credential?.model ?? (isClaude ? 'claude-sonnet-4-5' : 'gpt-4.1'));
        setBaseUrl(
          credential?.baseUrl ??
            (isClaude ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
        );
        setAuthType(credential?.authType === 'oauth_token' ? 'oauth_token' : 'api_key');
        if (
          credential?.reasoningEffort === 'low' ||
          credential?.reasoningEffort === 'medium' ||
          credential?.reasoningEffort === 'high'
        ) {
          setReasoningEffort(credential.reasoningEffort);
        }
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [provider, userId, isClaude]);

  const hasKey = existing?.hasApiKey ?? false;
  const isOauth = authType === 'oauth_token';

  useEffect(() => {
    if (!hasKey) return undefined;
    let cancelled = false;
    setModelsError(null);
    const fetcher = isClaude ? listClaudeModelsForUser : listCodexModelsForUser;
    fetcher(userId)
      .then(rows => {
        if (!cancelled) setModels(rows);
      })
      .catch(err => {
        if (!cancelled) {
          setModels(null);
          setModelsError(errMsg(err, 'Failed to load models'));
        }
      });
    return (): void => {
      cancelled = true;
    };
  }, [hasKey, userId, isClaude]);

  const handleSave = async (): Promise<void> => {
    if (!apiKey && !hasKey) {
      setError(isOauth && isClaude ? 'OAuth token is required' : 'API key is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertProviderCredential(userId, provider, {
        model,
        baseUrl,
        authType,
        reasoningEffort,
        ...(apiKey ? { apiKey } : {}),
      });
      await onMutate();
      toast.success(`${providerDisplayName(provider)} settings saved`);
      onClose();
    } catch (err) {
      const message = errMsg(err, 'Save failed');
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await deleteProviderCredential(userId, provider);
      await onMutate();
      toast.success(`${providerDisplayName(provider)} removed`);
      onClose();
    } catch (err) {
      const message = errMsg(err, 'Remove failed');
      setError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const startCodexOAuth = async (): Promise<void> => {
    setCodexBusy(true);
    setError(null);
    try {
      const flow = await startCodexOauth(userId);
      setCodexFlow(flow);
      window.open(flow.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(errMsg(err, 'Failed to start sign-in'));
    } finally {
      setCodexBusy(false);
    }
  };

  const completeCodexOAuth = async (): Promise<void> => {
    if (!codexFlow) return;
    setCodexBusy(true);
    setError(null);
    try {
      await exchangeCodexOauth(userId, { code: codexCode.trim(), state: codexFlow.state });
      await onMutate();
      toast.success('OpenAI connected');
      onClose();
    } catch (err) {
      setError(errMsg(err, 'Sign-in failed'));
    } finally {
      setCodexBusy(false);
    }
  };

  return (
    <div className='flex flex-col gap-4'>
      {hasKey && (
        <div className='flex items-center gap-2 text-sm text-emerald-600'>
          <CheckCircle2 className='size-4' />
          <span>Connected</span>
        </div>
      )}

      <div>
        <span className='mb-1.5 block text-xs font-medium text-muted-foreground'>Auth method</span>
        <div className='grid grid-cols-2 gap-2'>
          <AuthMethodOption
            label='API Key'
            sublabel={isClaude ? 'Usage-based, Console key' : 'Usage-based, Platform key'}
            selected={authType === 'api_key'}
            onSelect={() => setAuthType('api_key')}
          />
          <AuthMethodOption
            label={isClaude ? 'OAuth Token' : 'ChatGPT OAuth Token'}
            sublabel={isClaude ? 'Pro/Max subscription' : 'ChatGPT Plus/Pro subscription'}
            selected={authType === 'oauth_token'}
            onSelect={() => setAuthType('oauth_token')}
          />
        </div>

        {isOauth && isClaude && (
          <p className='mt-2 rounded-lg border border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] px-3 py-2 text-xs text-[var(--claw-ai-fg)]'>
            Run <code className='rounded bg-background px-1'>claude setup-token</code> on any
            machine with Claude Code installed. Paste the resulting token below.
          </p>
        )}

        {isOauth && isCodex && (
          <div className='mt-2 flex flex-col gap-2 rounded-lg border border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] px-3 py-2.5 text-xs text-[var(--claw-ai-fg)]'>
            {!codexFlow ? (
              <Button size='sm' onClick={() => void startCodexOAuth()} disabled={codexBusy}>
                {codexBusy ? (
                  <Loader2 className='size-4 animate-spin' />
                ) : (
                  <KeyRound className='size-4' />
                )}
                {codexBusy ? 'Opening...' : 'Sign in with ChatGPT'}
              </Button>
            ) : (
              <>
                <p>
                  Paste the code from the OpenAI page below.{' '}
                  <a
                    href={codexFlow.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='underline underline-offset-2'
                  >
                    Re-open tab
                  </a>
                </p>
                <Input
                  value={codexCode}
                  onChange={event => setCodexCode(event.target.value)}
                  placeholder='Paste code or callback URL'
                />
                <div className='flex gap-2'>
                  <Button
                    size='sm'
                    onClick={() => void completeCodexOAuth()}
                    disabled={codexBusy || !codexCode.trim()}
                  >
                    {codexBusy ? 'Verifying...' : 'Complete sign-in'}
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => {
                      setCodexFlow(null);
                      setCodexCode('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {(!isOauth || isClaude) && (
        <LabeledInput
          type='password'
          label={isOauth && isClaude ? 'OAuth Token' : 'API Key'}
          value={apiKey}
          onChange={setApiKey}
          placeholder={hasKey ? '••••••••' : 'sk-...'}
          hint={hasKey ? 'Leave blank to keep current' : undefined}
        />
      )}

      <div>
        <span className='mb-1.5 block text-xs font-medium text-muted-foreground'>Model</span>
        {models && models.length > 0 ? (
          <Select value={model} onValueChange={value => setModel(value)}>
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Select a model' />
            </SelectTrigger>
            <SelectContent>
              {models.map(option => (
                <SelectItem key={option.id} value={option.id}>
                  {modelLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input value={model} onChange={event => setModel(event.target.value)} />
        )}
        {modelsError && (
          <p className='mt-1 text-xs text-amber-600'>Could not fetch models: {modelsError}</p>
        )}
      </div>

      <LabeledInput label='Base URL' value={baseUrl} onChange={setBaseUrl} />

      <LabeledSelect
        label='Reasoning Effort'
        value={reasoningEffort}
        options={[
          { value: 'low', label: 'Low - fastest, minimal think time' },
          { value: 'medium', label: 'Medium - balanced (default)' },
          { value: 'high', label: 'High - deepest reasoning, slowest' },
        ]}
        onValueChange={value => {
          if (value === 'low' || value === 'medium' || value === 'high') {
            setReasoningEffort(value);
          }
        }}
      />
      <p className='-mt-3 text-xs text-muted-foreground'>
        Only applies to reasoning-capable models. Lower means faster per-turn responses.
      </p>

      {error && <p className='text-sm text-destructive'>{error}</p>}

      <div className='flex items-center justify-end gap-2 pt-2'>
        {hasKey && (
          <Button variant='ghost' onClick={() => void handleDelete()} disabled={deleting || saving}>
            {deleting ? 'Removing...' : 'Remove'}
          </Button>
        )}
        <Button onClick={() => void handleSave()} loading={saving} disabled={!apiKey && !hasKey}>
          {hasKey ? 'Save changes' : 'Connect'}
        </Button>
      </div>
    </div>
  );
};

const AuthMethodOption = ({
  label,
  sublabel,
  selected,
  onSelect,
}: {
  label: string;
  sublabel: string;
  selected: boolean;
  onSelect: () => void;
}): ReactElement => (
  <button
    type='button'
    onClick={onSelect}
    data-track-category='claw-settings'
    data-track-name={`SelectAuthMethod-${label}`}
    className={cn(
      'flex min-h-16 flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
      selected
        ? 'border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] text-[var(--claw-ai-fg)]'
        : 'border-border bg-background text-foreground hover:bg-muted',
    )}
  >
    <span className='text-sm font-medium'>{label}</span>
    <span className='text-xs text-muted-foreground'>{sublabel}</span>
  </button>
);

const AgentAssignmentSection = ({
  subagents,
  routingMap,
  defaultProvider,
  availableProviders,
  loading,
  saving,
  userId,
  onMutate,
  onSaving,
}: {
  subagents: string[];
  routingMap: Map<string, string>;
  defaultProvider: string | null;
  availableProviders: Array<{ value: string; label: string }>;
  loading: boolean;
  saving: string | null;
  userId: string;
  onMutate: () => Promise<void>;
  onSaving: (key: string | null) => void;
}): ReactElement => {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const searchId = useId();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return subagents;
    return subagents.filter(name => {
      const display = agentDisplayName(name);
      return display.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
    });
  }, [query, subagents]);

  const hiddenCount = Math.max(0, filtered.length - AGENT_ASSIGNMENT_VISIBLE_COUNT);
  const visibleNames =
    expanded || hiddenCount === 0 ? filtered : filtered.slice(0, AGENT_ASSIGNMENT_VISIBLE_COUNT);
  const defaultProviderName = defaultProvider ? providerDisplayName(defaultProvider) : null;

  const assignProvider = (name: string, provider: string): void => {
    void (async (): Promise<void> => {
      onSaving(`sa:${name}`);
      try {
        if (provider === 'default') {
          await deleteSubagentRouting(userId, name);
        } else {
          await upsertSubagentRouting(userId, name, provider);
        }
        await onMutate();
        toast.success('Agent assignment saved');
      } catch (err) {
        toast.error(errMsg(err, 'Save failed'));
      } finally {
        onSaving(null);
      }
    })();
  };

  return (
    <DetailSection
      heading='title'
      typeScale='twin'
      headingClassName={TWIN_SETTINGS_TITLE_CLASS}
      label='Agent Model Assignment'
      className='gap-4'
    >
      <DetailSection
        heading='subcategory'
        typeScale='twin'
        label='Choose which AI model powers specific agents.'
      >
        {loading ? (
          <DetailGroup typeScale='twin' className='gap-0'>
            {[1, 2, 3].map(index => (
              <div key={index} className='flex w-full items-center gap-8 py-3'>
                <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                  <Skeleton className='h-4 w-32' />
                  <Skeleton className='h-4 w-48' />
                </div>
                <Skeleton className='h-9 w-40 shrink-0' />
              </div>
            ))}
          </DetailGroup>
        ) : (
          <DetailGroup typeScale='twin' className='gap-0'>
            <label
              htmlFor={searchId}
              className='relative flex items-center gap-2 border-b-[0.8px] border-solid border-foreground/10 pb-3'
            >
              <span className='sr-only'>Search agents</span>
              <Search className='pointer-events-none size-4 shrink-0 text-muted-foreground' />
              <Input
                id={searchId}
                type='search'
                value={query}
                onChange={event => {
                  setQuery(event.target.value);
                  setExpanded(false);
                }}
                placeholder='Search agents'
                className='h-9 border-0 bg-transparent px-0 shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0'
                data-testid='claw-settings-agent-assignment-search'
                data-track-category='claw-settings'
                data-track-name='SearchAgentAssignment'
              />
            </label>

            {visibleNames.length === 0 ? (
              <DetailEmpty typeScale='twin' className='py-6 text-center'>
                No agents match
              </DetailEmpty>
            ) : (
              visibleNames.map(name => (
                <AgentAssignmentRow
                  key={name}
                  name={name}
                  displayName={agentDisplayName(name)}
                  currentProvider={routingMap.get(name) ?? 'default'}
                  defaultProviderName={defaultProviderName}
                  availableProviders={availableProviders}
                  disabled={saving === `sa:${name}`}
                  onChange={provider => assignProvider(name, provider)}
                />
              ))
            )}

            {hiddenCount > 0 && (
              <button
                type='button'
                aria-expanded={expanded}
                onClick={() => setExpanded(value => !value)}
                className={cn(
                  'flex w-full items-center justify-center border-t-[0.8px] border-solid border-foreground/10 py-3',
                  DETAIL_NESTED_TITLE_CLASS.twin,
                  'text-foreground/60 transition-colors hover:text-foreground',
                )}
                data-testid='claw-settings-agent-assignment-toggle'
                data-track-category='claw-settings'
                data-track-name={expanded ? 'CollapseAgentAssignment' : 'ExpandAgentAssignment'}
              >
                {expanded ? 'Show less' : `Show ${hiddenCount} more`}
              </button>
            )}
          </DetailGroup>
        )}
      </DetailSection>
    </DetailSection>
  );
};

const agentAssignmentHint = (
  isInherited: boolean,
  defaultProviderName: string | null,
  selectedProvider: string | null,
): string | undefined => {
  if (isInherited) {
    return defaultProviderName
      ? `Inherited from Main Agent (${defaultProviderName})`
      : 'No default provider connected';
  }
  return selectedProvider ? `Uses ${selectedProvider}` : undefined;
};

const AgentAssignmentRow = ({
  name,
  displayName,
  currentProvider,
  defaultProviderName,
  availableProviders,
  disabled,
  onChange,
}: {
  name: string;
  displayName: string;
  currentProvider: string;
  defaultProviderName: string | null;
  availableProviders: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (provider: string) => void;
}): ReactElement => {
  const availableValues = useMemo(
    () => new Set(availableProviders.map(provider => provider.value)),
    [availableProviders],
  );
  const selectValue = availableValues.has(currentProvider) ? currentProvider : 'default';
  const isInherited = selectValue === 'default';
  const selectedProvider = isInherited ? null : providerDisplayName(selectValue);
  const hint = agentAssignmentHint(isInherited, defaultProviderName, selectedProvider);

  return (
    <div data-testid={`claw-settings-agent-row-${name}`} className='py-3'>
      <DetailRow title={displayName} typeScale='twin' {...(hint === undefined ? {} : { hint })}>
        <Select value={selectValue} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger
            aria-label={`Provider for ${displayName}`}
            className={DETAIL_SELECT_TRIGGER_CLASS_FOR.twin}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align='end'>
            {availableProviders.map(provider => (
              <SelectItem key={provider.value} value={provider.value}>
                {provider.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DetailRow>
    </div>
  );
};

const LabeledInput = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string | undefined;
}): ReactElement => {
  const id = useId();
  return (
    <div>
      <label className='mb-1.5 block text-xs font-medium text-muted-foreground' htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {hint && <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>}
    </div>
  );
};

const LabeledSelect = ({
  label,
  value,
  options,
  disabled,
  onValueChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean | undefined;
  onValueChange: (value: string) => void | Promise<void>;
}): ReactElement => (
  <div>
    <span className='mb-1.5 block text-xs font-medium text-muted-foreground'>{label}</span>
    <Select
      value={value}
      onValueChange={value => void onValueChange(value)}
      disabled={disabled ?? false}
    >
      <SelectTrigger className='w-full'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

async function listProviderCredentialsForDialog(
  userId: string,
  provider: string,
): Promise<ProviderCredential | undefined> {
  const credentials = await listProviderCredentials(userId);
  return credentials.find(credential => credential.provider === provider);
}

export const ClawProvidersSettingsPanels = (): ReactElement => {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useClawSettings();
  const [saving, setSaving] = useState<string | null>(null);

  const credentials = data?.credentials ?? EMPTY_CREDENTIALS;
  const routing = data?.routing ?? EMPTY_ROUTING;
  const subagents = data?.subagents ?? EMPTY_SUBAGENTS;

  const routingMap = useMemo(
    () => new Map(routing.map(route => [route.subagentName, route.provider])),
    [routing],
  );
  const connectedProviders = useMemo(
    () =>
      credentials.filter(credential => credential.hasApiKey).map(credential => credential.provider),
    [credentials],
  );
  const defaultProvider = connectedProviders[0] ?? null;
  const availableProviders = useMemo(
    () => [
      { value: 'default', label: 'Uses Main Agent Model' },
      ...connectedProviders.map(provider => ({
        value: provider,
        label: providerDisplayName(provider),
      })),
    ],
    [connectedProviders],
  );

  const invalidateSettings = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: clawSettingsKey(userId) });
  };

  return (
    <>
      {isError && (
        <div className='rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
          {error?.message ?? 'Failed to load settings'}
        </div>
      )}

      <AIProvidersSection
        credentials={credentials}
        defaultProvider={defaultProvider}
        loading={isLoading}
        userId={userId}
        onMutate={invalidateSettings}
      />
      <AgentAssignmentSection
        subagents={subagents}
        routingMap={routingMap}
        defaultProvider={defaultProvider}
        availableProviders={availableProviders}
        loading={isLoading}
        saving={saving}
        userId={userId}
        onMutate={invalidateSettings}
        onSaving={setSaving}
      />
    </>
  );
};
