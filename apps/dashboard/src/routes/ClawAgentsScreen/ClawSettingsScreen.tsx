import { ReactElement, useEffect, useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  Github,
  KeyRound,
  Loader2,
  Plane,
  Plug,
  Settings,
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
import { useAuth } from '@/hooks/useAuth';
import { clawSettingsKey, useClawSettings } from '@/hooks/useClawSettings';
import {
  deleteProviderCredential,
  deleteSubagentRouting,
  exchangeClaudeOauth,
  exchangeCodexOauth,
  initiateCopilotGitHubLogin,
  listClaudeModelsForUser,
  listCodexModelsForUser,
  listCopilotModelsForUser,
  listProviderCredentials,
  pollCopilotGitHubLogin,
  startClaudeOauth,
  startCodexOauth,
  type ClaudeOauthFlow,
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
import LocalHarnessSection from './LocalHarnessSection';

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
    openrouter: {
      name: 'OpenRouter',
      description: 'One key, many models across providers',
      icon: Plug,
    },
    litellm: {
      name: 'LiteLLM (own key)',
      description: 'Use models allowed by your Grid/LiteLLM key',
      icon: KeyRound,
    },
  };

const PROVIDERS: ProviderId[] = ['copilot', 'claude', 'codex', 'openrouter', 'litellm'];

/* eslint-disable @typescript-eslint/naming-convention */
const DEFAULT_MODEL_BY_PROVIDER: Partial<Record<ProviderId, string>> = {
  claude: 'claude-sonnet-4-5',
  codex: 'gpt-4.1',
};

const DEFAULT_BASE_URL_BY_PROVIDER: Partial<Record<ProviderId, string>> = {
  claude: 'https://api.anthropic.com',
  codex: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};
/* eslint-enable @typescript-eslint/naming-convention */
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

/** Stands in for "no model chosen" — Radix Select rejects an empty value. */
const DEFAULT_MODEL_VALUE = '__default__';

const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const providerDisplayName = (provider: string): string =>
  PROVIDER_META[provider as ProviderId]?.name ?? provider;

const modelLabel = (model: ClaudeModelInfo | ProviderModelOption): string =>
  'displayName' in model ? model.displayName : model.name;

const SectionHeader = ({
  icon,
  title,
  description,
}: {
  icon: typeof Sparkles;
  title: string;
  description: string;
}): ReactElement => {
  const IconComponent = icon;

  return (
    <div className='mb-4'>
      <div className='flex items-center gap-2'>
        <IconComponent className='size-4 text-muted-foreground' />
        <h2 className='text-sm font-semibold text-foreground'>{title}</h2>
      </div>
      <p className='mt-0.5 text-sm text-muted-foreground'>{description}</p>
    </div>
  );
};

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
      className={cn(
        'flex min-h-36 flex-col gap-3 rounded-2xl border p-4 transition-colors',
        isConnected ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-border bg-muted/40',
      )}
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
              <h3 className='truncate text-sm font-semibold text-foreground'>{meta.name}</h3>
              {isDefault && <Badge variant='primary'>Default</Badge>}
            </div>
            <p className='truncate text-xs text-muted-foreground'>{meta.description}</p>
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
        <p className='text-xs text-muted-foreground'>
          Model: <span className='font-medium text-foreground'>{credential.model}</span>
        </p>
      )}

      <div className='mt-auto flex justify-end'>
        <Button
          size='sm'
          variant={isConnected ? 'secondary' : 'default'}
          onClick={onOpenDialog}
          data-track-category='claw-settings'
          data-track-name='OPEN_SETTINGS_DIALOG'
        >
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
    <section>
      <SectionHeader
        icon={Sparkles}
        title='AI Providers'
        description='Connect AI services your agents can use.'
      />

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
    </section>
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
          <Button
            onClick={() => void startLogin()}
            data-track-category='claw-settings'
            data-track-name='START_GITHUB_LOGIN'
            disabled={starting}
          >
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
              data-track-category='claw-settings'
              data-track-name='RESTART_GITHUB_LOGIN'
              disabled={starting || saving}
            >
              <Github className='size-4' />
              Reconnect
            </Button>
            <Button
              variant='destructive'
              onClick={() => void handleDisconnect()}
              data-track-category='claw-settings'
              data-track-name='DISCONNECT_GITHUB'
              disabled={saving}
            >
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
              data-track-category='claw-settings'
              data-track-name='COPY_GITHUB_DEVICE_CODE'
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
  const isLitellm = provider === 'litellm';
  // Only these two have an OAuth flow and a fetchable model catalogue; the rest
  // are plain API-key providers. LiteLLM additionally has no reasoning knob —
  // the same rules credentialForm.ts encodes for the agent-level form.
  const hasOauthOption = isClaude || isCodex;
  const hasModelCatalog = isClaude || isCodex;
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
  const [claudeFlow, setClaudeFlow] = useState<ClaudeOauthFlow | null>(null);
  const [claudeCode, setClaudeCode] = useState('');
  const [claudeBusy, setClaudeBusy] = useState(false);
  // Bumped after a sign-in lands, so the models effect re-runs against the
  // credential that now exists. `hasKey` comes from the parent's snapshot and
  // does not update until it refetches, which is too late for this dialog.
  const [credentialNonce, setCredentialNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listProviderCredentialsForDialog(userId, provider)
      .then(credential => {
        if (cancelled) return;
        setExisting(credential);
        setModel(credential?.model ?? DEFAULT_MODEL_BY_PROVIDER[provider] ?? '');
        setBaseUrl(credential?.baseUrl ?? DEFAULT_BASE_URL_BY_PROVIDER[provider] ?? '');
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
  }, [provider, userId]);

  const hasKey = existing?.hasApiKey ?? false;
  const isOauth = authType === 'oauth_token';

  useEffect(() => {
    if (!hasModelCatalog) return undefined;
    if (!hasKey && credentialNonce === 0) return undefined;
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
  }, [hasKey, userId, isClaude, hasModelCatalog, credentialNonce]);

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
        ...(isLitellm ? {} : { authType, reasoningEffort }),
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

  const startClaudeOAuth = async (): Promise<void> => {
    setClaudeBusy(true);
    setError(null);
    try {
      const flow = await startClaudeOauth(userId);
      setClaudeFlow(flow);
      window.open(flow.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(errMsg(err, 'Failed to start sign-in'));
    } finally {
      setClaudeBusy(false);
    }
  };

  const completeClaudeOAuth = async (): Promise<void> => {
    if (!claudeFlow) return;
    setClaudeBusy(true);
    setError(null);
    try {
      await exchangeClaudeOauth(userId, { code: claudeCode.trim(), state: claudeFlow.state });
      setClaudeFlow(null);
      setClaudeCode('');
      await onMutate();
      // Stay open: the credential exists now, so the model list becomes
      // fetchable and the user still has to pick one before saving.
      setCredentialNonce(nonce => nonce + 1);
      toast.success('Anthropic Claude connected — pick a model');
    } catch (err) {
      setError(errMsg(err, 'Sign-in failed'));
    } finally {
      setClaudeBusy(false);
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

      {hasOauthOption && (
        <div>
          <span className='mb-1.5 block text-xs font-medium text-muted-foreground'>
            Auth method
          </span>
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
            <div className='mt-2 flex flex-col gap-2 rounded-lg border border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] px-3 py-2.5 text-xs text-[var(--claw-ai-fg)]'>
              {!claudeFlow ? (
                <>
                  <p>
                    Sign in with your Claude account. This captures a refreshable token, so it
                    won&apos;t silently expire like a pasted one.
                  </p>
                  <Button size='sm' onClick={() => void startClaudeOAuth()} disabled={claudeBusy}>
                    {claudeBusy ? (
                      <Loader2 className='size-4 animate-spin' />
                    ) : (
                      <KeyRound className='size-4' />
                    )}
                    {claudeBusy ? 'Opening...' : 'Sign in with Claude'}
                  </Button>
                  <p className='text-muted-foreground'>
                    Or run <code className='rounded bg-background px-1'>claude setup-token</code>{' '}
                    and paste the token below.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Paste the code Anthropic shows you below.{' '}
                    <a
                      href={claudeFlow.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='underline underline-offset-2'
                    >
                      Re-open tab
                    </a>
                  </p>
                  <Input
                    value={claudeCode}
                    onChange={event => setClaudeCode(event.target.value)}
                    placeholder='Paste code or callback URL'
                  />
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      onClick={() => void completeClaudeOAuth()}
                      disabled={claudeBusy || !claudeCode.trim()}
                    >
                      {claudeBusy ? 'Verifying...' : 'Complete sign-in'}
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => {
                        setClaudeFlow(null);
                        setClaudeCode('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {isOauth && isCodex && (
            <div className='mt-2 flex flex-col gap-2 rounded-lg border border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] px-3 py-2.5 text-xs text-[var(--claw-ai-fg)]'>
              {!codexFlow ? (
                <Button
                  size='sm'
                  onClick={() => void startCodexOAuth()}
                  data-track-category='claw-settings'
                  data-track-name='START_CODEX_OAUTH'
                  disabled={codexBusy}
                >
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
                      data-track-category='claw-settings'
                      data-track-name='COMPLETE_CODEX_OAUTH'
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
                      data-track-category='claw-settings'
                      data-track-name='CANCEL_CODEX_OAUTH'
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

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
          // Radix Select cannot hold an empty string, so "no model chosen" is
          // carried by a sentinel and mapped back to '' on the way out — the
          // API treats a blank model as "use the platform default".
          <Select
            value={model || DEFAULT_MODEL_VALUE}
            onValueChange={value => setModel(value === DEFAULT_MODEL_VALUE ? '' : value)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Use default' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_MODEL_VALUE}>Use default</SelectItem>
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

      <LabeledInput
        label='Base URL'
        value={baseUrl}
        onChange={setBaseUrl}
        {...(isLitellm ? { hint: 'Leave blank to use the platform LiteLLM proxy' } : {})}
      />

      {!isLitellm && (
        <>
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
        </>
      )}

      {error && <p className='text-sm text-destructive'>{error}</p>}

      <div className='flex items-center justify-end gap-2 pt-2'>
        {hasKey && (
          <Button
            variant='ghost'
            onClick={() => void handleDelete()}
            data-track-category='claw-settings'
            data-track-name='DELETE_MODEL_PROVIDER'
            disabled={deleting || saving}
          >
            {deleting ? 'Removing...' : 'Remove'}
          </Button>
        )}
        <Button
          onClick={() => void handleSave()}
          data-track-category='claw-settings'
          data-track-name='SAVE_MODEL_PROVIDER'
          loading={saving}
          disabled={!apiKey && !hasKey}
        >
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
}): ReactElement => (
  <section>
    <SectionHeader
      icon={Bot}
      title='Agent Model Assignment'
      description='Choose which AI model powers specific agents.'
    />

    {loading ? (
      <div className='divide-y divide-border rounded-2xl border border-border bg-muted/30'>
        {[1, 2, 3].map(index => (
          <div key={index} className='flex items-center justify-between gap-4 px-4 py-3.5'>
            <div className='flex items-center gap-3'>
              <Skeleton className='size-8 rounded-md' />
              <div className='space-y-1.5'>
                <Skeleton className='h-4 w-32' />
                <Skeleton className='h-3 w-48' />
              </div>
            </div>
            <Skeleton className='h-9 w-48' />
          </div>
        ))}
      </div>
    ) : (
      <div className='divide-y divide-border rounded-2xl border border-border bg-muted/30'>
        {subagents.map(name => (
          <AgentAssignmentRow
            key={name}
            name={name}
            displayName={
              SUBAGENT_NAMES[name] ?? `${name.charAt(0).toUpperCase()}${name.slice(1)} Agent`
            }
            currentProvider={routingMap.get(name) ?? 'default'}
            defaultProviderName={defaultProvider ? providerDisplayName(defaultProvider) : null}
            availableProviders={availableProviders}
            disabled={saving === `sa:${name}`}
            onChange={provider => {
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
            }}
          />
        ))}
      </div>
    )}
  </section>
);

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

  return (
    <div
      data-testid={`claw-settings-agent-row-${name}`}
      className={cn(
        'flex items-center justify-between gap-4 px-4 py-3.5 transition-colors',
        isInherited ? 'bg-transparent' : 'bg-[var(--claw-ai-surface)]/60',
      )}
    >
      <div className='flex min-w-0 flex-1 items-center gap-3'>
        <div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground'>
          <Bot className='size-4' />
        </div>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium text-foreground'>{displayName}</p>
          {isInherited && defaultProviderName && (
            <p className='text-xs text-muted-foreground'>
              Inherited from Main Agent{' '}
              <span className='font-medium text-foreground'>({defaultProviderName})</span>
            </p>
          )}
          {isInherited && !defaultProviderName && (
            <p className='text-xs text-muted-foreground'>No default provider connected</p>
          )}
          {!isInherited && selectedProvider && (
            <p className='text-xs text-[var(--claw-ai-fg)]'>Uses {selectedProvider}</p>
          )}
        </div>
      </div>

      <div className='w-56 shrink-0'>
        <Select value={selectValue} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger size='sm' className='w-full bg-background'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableProviders.map(provider => (
              <SelectItem key={provider.value} value={provider.value}>
                {provider.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

const AdvancedSettingsSection = (): ReactElement => {
  const [expanded, setExpanded] = useState(false);

  return (
    <section>
      <SectionHeader
        icon={Settings}
        title='Advanced Settings'
        description='Execution limits, fallback providers, sandbox settings, and more.'
      />

      <button
        type='button'
        onClick={() => setExpanded(value => !value)}
        data-track-category='claw-settings'
        data-track-name='ToggleAdvancedSettings'
        className='flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted'
      >
        <div>
          <p className='text-sm font-medium text-foreground'>Advanced options</p>
          <p className='text-xs text-muted-foreground'>
            Execution limits, approval rules, fallback providers, sandbox settings, token priority
          </p>
        </div>
        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>

      {expanded && (
        <div className='mt-3 rounded-2xl border border-border bg-muted/30 p-6'>
          <p className='text-sm text-muted-foreground'>
            Advanced settings will be available in a future release.
          </p>
          <div className='mt-4 grid grid-cols-2 gap-3 opacity-60 lg:grid-cols-3'>
            {[
              'Execution Limits',
              'Approval Rules',
              'Fallback Providers',
              'Sandbox Settings',
              'Token Priority',
            ].map(label => (
              <div
                key={label}
                className='flex min-h-12 items-center justify-center rounded-lg border border-dashed border-border bg-background px-4 py-3 text-center'
              >
                <p className='text-xs font-medium text-muted-foreground'>{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
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
}): ReactElement => (
  <LabeledInputInner
    label={label}
    value={value}
    onChange={onChange}
    type={type}
    placeholder={placeholder}
    hint={hint}
  />
);

const LabeledInputInner = ({
  label,
  value,
  onChange,
  type,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type: string;
  placeholder?: string | undefined;
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
        <SelectValue placeholder='Use default' />
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

const ClawSettingsScreen = (): ReactElement => {
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
    <div className='mx-auto w-full max-w-5xl px-6 pt-4 pb-16'>
      <div className='mb-6 flex flex-col gap-1'>
        <h1 className='text-lg font-semibold text-foreground'>Settings</h1>
        <p className='text-sm text-muted-foreground'>
          Connect this machine, configure AI providers, and assign agent models.
        </p>
      </div>

      {isError && (
        <div className='mb-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
          {error?.message ?? 'Failed to load settings'}
        </div>
      )}

      <div className='space-y-8'>
        <LocalHarnessSection />
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
        <AdvancedSettingsSection />
      </div>
    </div>
  );
};

export default ClawSettingsScreen;
