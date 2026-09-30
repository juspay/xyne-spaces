import { useState, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SandboxProfileConfig, SandboxSetupStep, SdlcEnvironmentRow } from '@xyne/shared';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Tabs } from '@/components/ui/Tabs';
import { TagChipInput } from '@/components/ui/TagChipInput/TagChipInput';
import Textarea from '@/components/ui/Textarea';
import { apiInstance } from '@/services/clients/apiClient';
import { getApiErrorMessage } from '@/utils/apiError';
import { cn } from '@/utils/classNames';
import {
  useResetSandboxProfile,
  useSandboxProfiles,
  useSandboxTemplates,
  useSaveSandboxProfile,
} from './useSandboxProfiles';

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

type Step = SandboxSetupStep;
/** Form edits may clear an optional field; clean() drops the undefined before saving. */
type ConfigPatch = { [K in keyof SandboxProfileConfig]?: SandboxProfileConfig[K] | undefined };
type AuxRepo = NonNullable<SandboxProfileConfig['auxRepos']>[number];

const EMPTY_STEP: Record<Step['type'], Step> = {
  install: { type: 'install', packages: [] },
  services: { type: 'services', cmd: '' },
  devserver: { type: 'devserver', name: '', cmd: '', cwd: '' },
  run: { type: 'run', label: '', cmd: '' },
};

const STEP_LABEL: Record<Step['type'], string> = {
  install: 'Install packages',
  services: 'Start services',
  devserver: 'Dev server',
  run: 'Run command',
};

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _omitted, ...rest } = value;
  return rest;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Drops empty optional values so the stored JSON stays what the person actually set. */
function clean(config: SandboxProfileConfig): SandboxProfileConfig {
  const out = Object.fromEntries(
    Object.entries(config).filter(
      // description is required but may be empty, so an empty string stays for it.
      ([key, value]) =>
        value !== undefined && (value !== '' || key === 'description') && !Number.isNaN(value),
    ),
  ) as unknown as SandboxProfileConfig;
  if (out.ports && Object.keys(out.ports).length === 0) delete out.ports;
  if (out.auxRepos?.length === 0) delete out.auxRepos;
  return out;
}

/** First missing required field, as a path the server would also report. */
function firstProblem(key: string, isNew: boolean, config: SandboxProfileConfig): string | null {
  if (isNew && !KEY_PATTERN.test(key)) return "key: lowercase letters, digits, '.', '_' or '-'";
  for (const field of ['slug', 'name', 'defaultBranch', 'workDir', 'template'] as const) {
    if (!config[field]?.trim()) return `${field}: required`;
  }
  for (const [index, step] of config.steps.entries()) {
    const missing =
      step.type === 'install'
        ? null
        : step.type === 'services'
          ? !step.cmd && 'cmd'
          : step.type === 'devserver'
            ? (!step.name && 'name') || (!step.cmd && 'cmd') || (!step.cwd && 'cwd')
            : (!step.label && 'label') || (!step.cmd && 'cmd');
    if (missing) return `steps.${index}.${missing}: required`;
  }
  for (const [index, aux] of (config.auxRepos ?? []).entries()) {
    const missing = (['name', 'url', 'defaultBranch', 'workDir'] as const).find(
      field => !aux[field],
    );
    if (missing) return `auxRepos.${index}.${missing}: required`;
  }
  return null;
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className='rounded-xl border border-border p-5'>
      <h3 className='text-sm font-semibold'>{title}</h3>
      {hint && <p className='mt-0.5 text-xs text-muted-foreground'>{hint}</p>}
      <div className='mt-4 flex flex-col gap-4'>{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  error,
  wide,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: boolean;
  required?: boolean;
  /** Spans both columns of the grid it sits in. */
  wide?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <label className={cn('flex flex-col gap-1.5 text-sm', wide && 'md:col-span-2')}>
      <span className={cn('font-medium', error && 'text-destructive')}>
        {label}
        {required && (
          <span className='ml-0.5 text-destructive' aria-hidden>
            *
          </span>
        )}
      </span>
      {children}
      {hint && <span className='text-xs text-muted-foreground'>{hint}</span>}
    </label>
  );
}

function Text({
  value,
  onChange,
  placeholder,
  disabled,
  mono,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}): ReactElement {
  return (
    <Input
      value={value ?? ''}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(mono && 'font-mono text-[13px]')}
    />
  );
}

/** Shell commands run long (nix run …, multi-line scripts); grows with its content. */
function CommandBox({
  value,
  onChange,
  placeholder,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
}): ReactElement {
  return (
    <Textarea
      value={value ?? ''}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      rows={Math.min(12, Math.max(3, (value ?? '').split('\n').length + 1))}
      className='resize-y font-mono text-[13px] leading-5'
    />
  );
}

/** A number field; `scale` converts what is shown (e.g. minutes) to what is stored (ms). */
function NumberField({
  value,
  onChange,
  scale = 1,
  placeholder,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  scale?: number;
  placeholder?: string;
}): ReactElement {
  return (
    <Input
      type='number'
      min={0}
      value={value === undefined ? '' : value / scale}
      placeholder={placeholder}
      onChange={event =>
        onChange(
          event.target.value === '' ? undefined : Math.round(Number(event.target.value) * scale),
        )
      }
    />
  );
}

function StepEditor({
  step,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  step: Step;
  index: number;
  count: number;
  onChange: (step: Step) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}): ReactElement {
  return (
    <li className='rounded-lg border border-border bg-muted/20 p-4'>
      <div className='mb-3 flex items-center gap-2'>
        <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary'>
          {index + 1}
        </span>
        <Select
          value={step.type}
          onValueChange={type => onChange(EMPTY_STEP[type as Step['type']])}
        >
          <SelectTrigger size='sm' className='w-44'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STEP_LABEL) as Step['type'][]).map(type => (
              <SelectItem key={type} value={type}>
                {STEP_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className='flex-1' />
        <Button
          variant='ghost'
          size='sm'
          aria-label='Move up'
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          <ArrowUp className='size-4' />
        </Button>
        <Button
          variant='ghost'
          size='sm'
          aria-label='Move down'
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
        >
          <ArrowDown className='size-4' />
        </Button>
        <Button variant='ghost' size='sm' aria-label='Remove step' onClick={onRemove}>
          <Trash2 className='size-4' />
        </Button>
      </div>
      <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
        {step.type === 'install' && (
          <>
            <Row wide label='Packages'>
              <TagChipInput
                value={step.packages}
                onChange={packages => onChange({ ...step, packages })}
                placeholder='Type a package, press Enter'
              />
            </Row>
            <Row wide label='Command' hint='Optional; replaces the default install command.'>
              <CommandBox value={step.cmd} onChange={cmd => onChange({ ...step, cmd })} />
            </Row>
          </>
        )}
        {step.type === 'services' && (
          <>
            <Row
              wide
              required
              label='Command'
              hint='Starts the background services (databases, queues).'
            >
              <CommandBox
                value={step.cmd}
                placeholder='cd /workspace/my-repo && nix run .#services -- --tui=false'
                onChange={cmd => onChange({ ...step, cmd })}
              />
            </Row>
            <Row
              wide
              label='Marker path'
              hint='If the template prebake already started this and dropped this file, the launch is skipped and only the health check runs.'
            >
              <Text
                mono
                value={step.markerPath}
                placeholder='/tmp/services-up'
                onChange={markerPath => onChange({ ...step, markerPath })}
              />
            </Row>
            <Row
              wide
              label='Health check command'
              hint='Optional. Repeated until it passes or times out.'
            >
              <CommandBox
                value={step.healthCheck?.cmd}
                placeholder='for p in 5432 6379; do nc -z 127.0.0.1 $p || { echo MISSING:$p; exit 0; }; done; echo all-up'
                onChange={cmd =>
                  onChange(
                    cmd
                      ? {
                          ...step,
                          healthCheck: {
                            successCondition: 'all-up',
                            intervalMs: 5_000,
                            timeoutMs: 5 * 60_000,
                            ...step.healthCheck,
                            cmd,
                          },
                        }
                      : omit(step, 'healthCheck'),
                  )
                }
              />
            </Row>
            {step.healthCheck && (
              <>
                <Row
                  wide
                  label='Passes when'
                  hint={
                    step.healthCheck.successCondition === 'all-up'
                      ? 'The command prints exactly all-up.'
                      : 'Every output line starts with Up or contains healthy (docker ps style).'
                  }
                >
                  <Select
                    value={step.healthCheck.successCondition}
                    onValueChange={successCondition =>
                      onChange({
                        ...step,
                        healthCheck: {
                          ...step.healthCheck!,
                          successCondition: successCondition as 'all-healthy' | 'all-up',
                        },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all-up'>Output is all-up</SelectItem>
                      <SelectItem value='all-healthy'>Every line is Up / healthy</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
                <Row label='Check every (seconds)'>
                  <NumberField
                    scale={1000}
                    value={step.healthCheck.intervalMs}
                    onChange={intervalMs =>
                      onChange({
                        ...step,
                        healthCheck: { ...step.healthCheck!, intervalMs: intervalMs ?? 5_000 },
                      })
                    }
                  />
                </Row>
                <Row label='Give up after (seconds)'>
                  <NumberField
                    scale={1000}
                    value={step.healthCheck.timeoutMs}
                    onChange={timeoutMs =>
                      onChange({
                        ...step,
                        healthCheck: { ...step.healthCheck!, timeoutMs: timeoutMs ?? 5 * 60_000 },
                      })
                    }
                  />
                </Row>
              </>
            )}
          </>
        )}
        {step.type === 'devserver' && (
          <>
            <Row required label='Name' hint='Shown to agents, e.g. backend.'>
              <Text value={step.name} onChange={name => onChange({ ...step, name })} />
            </Row>
            <Row required label='Working directory'>
              <Text
                mono
                value={step.cwd}
                placeholder='/workspace/my-repo/apps/backend'
                onChange={cwd => onChange({ ...step, cwd })}
              />
            </Row>
            <Row wide required label='Command' hint='Runs in the background for the whole session.'>
              <CommandBox
                value={step.cmd}
                placeholder='npm run dev'
                onChange={cmd => onChange({ ...step, cmd })}
              />
            </Row>
            <Row
              wide
              label='Marker path'
              hint='If the prebake already started it and dropped this file, the launch is skipped (avoids a port clash).'
            >
              <Text
                mono
                value={step.markerPath}
                placeholder='/tmp/backend-up'
                onChange={markerPath => onChange({ ...step, markerPath })}
              />
            </Row>
          </>
        )}
        {step.type === 'run' && (
          <>
            <Row required label='Label' hint='What the step does, shown in the boot log.'>
              <Text
                value={step.label}
                placeholder='sync DB schema (prisma db push)'
                onChange={label => onChange({ ...step, label })}
              />
            </Row>
            <Row label='Working directory'>
              <Text mono value={step.cwd} onChange={cwd => onChange({ ...step, cwd })} />
            </Row>
            <Row
              wide
              required
              label='Command'
              hint='Runs on every sandbox claim and must finish before the next step.'
            >
              <CommandBox value={step.cmd} onChange={cmd => onChange({ ...step, cmd })} />
            </Row>
            <Row label='Timeout (seconds)'>
              <NumberField
                scale={1000}
                value={step.timeoutMs}
                onChange={timeoutMs =>
                  onChange(
                    timeoutMs === undefined ? omit(step, 'timeoutMs') : { ...step, timeoutMs },
                  )
                }
              />
            </Row>
          </>
        )}
      </div>
    </li>
  );
}

function Form({
  isNew,
  initialKey,
  initial,
  repoLabel,
  onDone,
  save,
  onReset,
}: {
  isNew: boolean;
  initialKey: string;
  initial: SandboxProfileConfig;
  repoLabel: string;
  onDone: () => void;
  save: (key: string, config: SandboxProfileConfig) => Promise<void>;
  /** Set for a built-in whose saved copy differs from code: drops the copy. */
  onReset?: (() => Promise<void>) | undefined;
}): ReactElement {
  const [key, setKey] = useState(initialKey);
  const [config, setConfig] = useState(initial);
  const [tab, setTab] = useState('form');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: templates } = useSandboxTemplates();
  const lockedRepoUrl = initial.repoUrl;
  // The app theme lives on <html data-theme>; midnight is the dark one.
  const dark = document.documentElement.getAttribute('data-theme') === 'midnight';

  const patch = (next: ConfigPatch): void =>
    setConfig(current => ({ ...current, ...next }) as SandboxProfileConfig);
  const problem = firstProblem(key, isNew, config);
  const invalid = (field: string): boolean => showErrors && !!problem?.startsWith(`${field}:`);

  const switchTab = (next: string): void => {
    if (next === tab) return;
    if (next === 'json') {
      setJsonText(JSON.stringify(clean(config), null, 2));
      setJsonError(null);
    } else if (jsonError) {
      return; // Fix the JSON first; the form can't show a half-parsed config.
    }
    setTab(next);
  };

  const onJsonChange = (text: string): void => {
    setJsonText(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setJsonError('The config must be a JSON object');
      return;
    }
    const next = {
      steps: [],
      ...(parsed as Partial<SandboxProfileConfig>),
    } as SandboxProfileConfig;
    if (next.repoUrl !== lockedRepoUrl) {
      if (next.repoUrl)
        toast.info(`repoUrl stays ${lockedRepoUrl ?? 'empty'}: it comes from the repository.`);
      if (lockedRepoUrl) next.repoUrl = lockedRepoUrl;
      else delete next.repoUrl;
    }
    setJsonError(null);
    setConfig(next);
  };

  const submit = async (): Promise<void> => {
    setShowErrors(true);
    setServerError(null);
    if (jsonError) return;
    if (problem) {
      setServerError(problem);
      return;
    }
    setSaving(true);
    try {
      await save(key, clean(config));
      toast.success(isNew ? 'Sandbox profile created' : 'Sandbox profile saved');
      onDone();
    } catch (err) {
      setServerError(getApiErrorMessage(err, 'Could not save the sandbox profile'));
    } finally {
      setSaving(false);
    }
  };

  const steps = config.steps;
  const setSteps = (next: Step[]): void => patch({ steps: next });
  const ports = Object.entries(config.ports ?? {});
  const setPorts = (next: [string, number][]): void => patch({ ports: Object.fromEntries(next) });
  const auxRepos = config.auxRepos ?? [];
  const setAux = (next: AuxRepo[]): void => patch({ auxRepos: next });
  const templateOptions = [
    ...new Set([...(templates ?? []), ...(config.template ? [config.template] : [])]),
  ];

  return (
    <div className='flex h-full flex-col'>
      <div className='min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]'>
        <div className='max-w-ai-content mx-auto flex min-h-full flex-col gap-5 px-8 pb-8 pt-8'>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {isNew ? 'New sandbox profile' : `Edit ${initial.name || initialKey}`}
            </h1>
            <p className='mt-1.5 text-sm text-muted-foreground'>
              How agents boot a sandbox for <span className='font-mono'>{repoLabel}</span>.
            </p>
          </div>

          <Tabs
            items={[
              { id: 'form', label: 'Form' },
              { id: 'json', label: 'JSON' },
            ]}
            activeId={tab}
            onSelect={switchTab}
            trackCategory='Environments'
          />

          {tab === 'json' ? (
            <div className='flex min-h-[360px] flex-1 flex-col gap-2'>
              <div
                className={cn(
                  // The parent's height is flex-derived, so % heights don't resolve; pin the editor instead.
                  'relative min-h-0 flex-1 overflow-hidden rounded-md border',
                  jsonError ? 'border-destructive/60' : 'border-border',
                )}
              >
                <CodeMirror
                  value={jsonText}
                  height='100%'
                  className='absolute inset-0'
                  theme={dark ? 'dark' : 'light'}
                  extensions={[json()]}
                  onChange={onJsonChange}
                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                />
              </div>
              <p
                className={cn('text-xs', jsonError ? 'text-destructive' : 'text-muted-foreground')}
              >
                {jsonError ?? 'Paste a whole config here. repoUrl always stays the repository’s.'}
              </p>
            </div>
          ) : (
            <>
              <Section title='Basics'>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <Row
                    required
                    label='Key'
                    hint={
                      isNew ? 'Agents pin this; it cannot change later.' : 'Fixed after creation.'
                    }
                    error={invalid('key')}
                  >
                    <Text
                      mono
                      value={key}
                      disabled={!isNew}
                      onChange={value => setKey(slugify(value))}
                    />
                  </Row>
                  <Row required label='Slug' error={invalid('slug')}>
                    <Text mono value={config.slug} onChange={slug => patch({ slug })} />
                  </Row>
                  <Row required label='Name' error={invalid('name')}>
                    <Text value={config.name} onChange={name => patch({ name })} />
                  </Row>
                  <Row label='Repository' hint='Comes from the repository; not editable.'>
                    <Text mono value={config.repoUrl} disabled onChange={() => undefined} />
                  </Row>
                </div>
                <Row label='Description' hint='Shown to agents when they pick a profile.'>
                  <Textarea
                    value={config.description}
                    onChange={event => patch({ description: event.target.value })}
                    rows={3}
                  />
                </Row>
              </Section>

              <Section title='Sandbox'>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <Row
                    required
                    label='Template'
                    hint='A kata SandboxTemplate deployed in the cluster.'
                    error={invalid('template')}
                  >
                    <Select
                      {...(config.template ? { value: config.template } : {})}
                      onValueChange={template => patch({ template })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='Choose a template' />
                      </SelectTrigger>
                      <SelectContent>
                        {templateOptions.map(template => (
                          <SelectItem key={template} value={template}>
                            <span className='font-mono text-[13px]'>{template}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Row>
                  <Row required label='Work directory' error={invalid('workDir')}>
                    <Text mono value={config.workDir} onChange={workDir => patch({ workDir })} />
                  </Row>
                  <Row required label='Default branch' error={invalid('defaultBranch')}>
                    <Text
                      mono
                      value={config.defaultBranch}
                      onChange={defaultBranch => patch({ defaultBranch })}
                    />
                  </Row>
                  <Row label='Clone depth' hint='Empty clones the full history.'>
                    <NumberField
                      value={config.cloneDepth}
                      onChange={cloneDepth => patch({ cloneDepth })}
                    />
                  </Row>
                  <Row label='Clone timeout (seconds)'>
                    <NumberField
                      scale={1000}
                      value={config.cloneTimeoutMs}
                      onChange={cloneTimeoutMs => patch({ cloneTimeoutMs })}
                    />
                  </Row>
                  <Row
                    label='Ready timeout (seconds)'
                    hint='How long to wait for the sandbox to come up.'
                  >
                    <NumberField
                      scale={1000}
                      value={config.readyTimeoutMs}
                      onChange={readyTimeoutMs => patch({ readyTimeoutMs })}
                    />
                  </Row>
                </div>
                <div className='flex items-start gap-3 text-sm'>
                  <Switch
                    checked={!!config.readFirst}
                    onCheckedChange={readFirst => patch({ readFirst })}
                    aria-label='Read first'
                  />
                  <span>
                    <span className='font-medium'>Read first</span>
                    <span className='block text-xs text-muted-foreground'>
                      Runs start in the shared read-only sandbox; a writable one is claimed only on
                      write.
                    </span>
                  </span>
                </div>
                <div className='flex items-start gap-3 text-sm'>
                  <Switch
                    checked={!!config.skipBakedCloneWait}
                    onCheckedChange={skipBakedCloneWait => patch({ skipBakedCloneWait })}
                    aria-label='Clone at start'
                  />
                  <span>
                    <span className='font-medium'>Clone at start</span>
                    <span className='block text-xs text-muted-foreground'>
                      The repository is not baked into the template; clone it right away.
                    </span>
                  </span>
                </div>
              </Section>

              <Section title='Lifetime' hint='Minutes. Empty uses the platform default.'>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <Row label='Session'>
                    <NumberField
                      scale={60_000}
                      value={config.sessionTimeoutMs}
                      onChange={sessionTimeoutMs => patch({ sessionTimeoutMs })}
                    />
                  </Row>
                  <Row label='Idle'>
                    <NumberField
                      scale={60_000}
                      value={config.idleTimeoutMs}
                      onChange={idleTimeoutMs => patch({ idleTimeoutMs })}
                    />
                  </Row>
                  <Row label='Write session' hint='For writable sandboxes; falls back to Session.'>
                    <NumberField
                      scale={60_000}
                      value={config.writeSessionTimeoutMs}
                      onChange={writeSessionTimeoutMs => patch({ writeSessionTimeoutMs })}
                    />
                  </Row>
                  <Row label='Write idle' hint='Falls back to Idle.'>
                    <NumberField
                      scale={60_000}
                      value={config.writeIdleTimeoutMs}
                      onChange={writeIdleTimeoutMs => patch({ writeIdleTimeoutMs })}
                    />
                  </Row>
                </div>
              </Section>

              <Section title='Boot steps' hint='Run in order when the sandbox starts.'>
                {steps.length > 0 && (
                  <ol className='flex flex-col gap-3'>
                    {steps.map((step, index) => (
                      <StepEditor
                        key={index}
                        step={step}
                        index={index}
                        count={steps.length}
                        onChange={next => setSteps(steps.map((s, i) => (i === index ? next : s)))}
                        onRemove={() => setSteps(steps.filter((_, i) => i !== index))}
                        onMove={to => {
                          const next = [...steps];
                          [next[index], next[to]] = [next[to]!, next[index]!];
                          setSteps(next);
                        }}
                      />
                    ))}
                  </ol>
                )}
                <Button
                  variant='outline'
                  size='sm'
                  className='self-start'
                  onClick={() => setSteps([...steps, EMPTY_STEP.run])}
                >
                  <Plus className='size-4' />
                  Add step
                </Button>
              </Section>

              <Section title='Ports' hint='Named ports the sandbox exposes, e.g. web → 3000.'>
                {ports.map(([name, port], index) => (
                  <div key={index} className='flex items-center gap-2'>
                    <Input
                      value={name}
                      placeholder='name'
                      onChange={event =>
                        setPorts(
                          ports.map((p, i) => (i === index ? [event.target.value, p[1]] : p)),
                        )
                      }
                    />
                    <Input
                      type='number'
                      value={port}
                      placeholder='port'
                      onChange={event =>
                        setPorts(
                          ports.map((p, i) =>
                            i === index ? [p[0], Number(event.target.value)] : p,
                          ),
                        )
                      }
                    />
                    <Button
                      variant='ghost'
                      size='sm'
                      aria-label='Remove port'
                      onClick={() => setPorts(ports.filter((_, i) => i !== index))}
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  </div>
                ))}
                <Button
                  variant='outline'
                  size='sm'
                  className='self-start'
                  onClick={() => setPorts([...ports, [`port${ports.length + 1}`, 3000]])}
                >
                  <Plus className='size-4' />
                  Add port
                </Button>
              </Section>

              <Section
                title='Extra repositories'
                hint='Other repositories baked into the template; agents can switch their branch.'
              >
                {auxRepos.map((aux, index) => (
                  <div
                    key={index}
                    className='grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/20 p-4 md:grid-cols-2'
                  >
                    {(['name', 'url', 'defaultBranch', 'workDir'] as const).map(field => (
                      <Row
                        key={field}
                        required
                        label={
                          {
                            name: 'Name',
                            url: 'URL',
                            defaultBranch: 'Default branch',
                            workDir: 'Work directory',
                          }[field]
                        }
                        error={invalid(`auxRepos.${index}.${field}`)}
                      >
                        <Text
                          mono={field !== 'name'}
                          value={aux[field]}
                          onChange={value =>
                            setAux(
                              auxRepos.map((a, i) => (i === index ? { ...a, [field]: value } : a)),
                            )
                          }
                        />
                      </Row>
                    ))}
                    <Button
                      variant='ghost'
                      size='sm'
                      className='self-start'
                      onClick={() => setAux(auxRepos.filter((_, i) => i !== index))}
                    >
                      <Trash2 className='size-4' />
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  variant='outline'
                  size='sm'
                  className='self-start'
                  onClick={() =>
                    setAux([...auxRepos, { name: '', url: '', defaultBranch: 'main', workDir: '' }])
                  }
                >
                  <Plus className='size-4' />
                  Add repository
                </Button>
              </Section>
            </>
          )}
        </div>
      </div>

      <div className='shrink-0 border-t border-border bg-background'>
        <div className='max-w-ai-content mx-auto flex items-center gap-3 px-8 py-3'>
          <p role='alert' className='min-w-0 flex-1 truncate text-sm text-destructive'>
            {serverError}
          </p>
          {onReset && (
            <Button
              variant='ghost'
              disabled={saving}
              onClick={() => {
                setSaving(true);
                onReset()
                  .then(() => {
                    toast.success('Reset to the built-in version');
                    onDone();
                  })
                  .catch((err: unknown) =>
                    setServerError(getApiErrorMessage(err, 'Could not reset the profile')),
                  )
                  .finally(() => setSaving(false));
              }}
              data-track-category='Environments'
              data-track-name='Reset sandbox profile to built-in'
            >
              <RotateCcw className='size-4' />
              Reset to built-in
            </Button>
          )}
          <Button variant='outline' onClick={onDone} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !!jsonError}
            data-track-category='Environments'
            data-track-name={isNew ? 'Create sandbox profile' : 'Save sandbox profile'}
          >
            {saving ? 'Saving…' : isNew ? 'Create profile' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Route: /ai/environments/profile/new?repoId= and /ai/environments/profile/:key/edit. */
export function SandboxProfileFormPage(): ReactElement {
  const { workspaceId, key } = useParams<{ workspaceId?: string; key?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const repoId = searchParams.get('repoId');
  const returnTo = searchParams.get('returnTo');
  const save = useSaveSandboxProfile();
  const reset = useResetSandboxProfile();
  const { data: profileList, isPending: profilesPending } = useSandboxProfiles();
  const { data: repos, isPending: reposPending } = useQuery({
    queryKey: ['sdlc-environments', null],
    queryFn: async () =>
      (await apiInstance.get<{ environments: SdlcEnvironmentRow[] }>('/sdlc/environments')).data
        .environments,
    enabled: !key,
  });

  const done = (): void =>
    void navigate(
      returnTo?.startsWith('/')
        ? returnTo
        : `${workspaceId ? `/${workspaceId}` : ''}/ai/environments`,
    );

  const profile = key ? profileList?.profiles.find(candidate => candidate.key === key) : undefined;
  const repo = repoId ? repos?.find(candidate => candidate.repoId === repoId) : undefined;
  const missing = key ? !profilesPending && !profile?.canEdit : !reposPending && !repo;

  if (missing) {
    return (
      <div className='p-8 text-sm text-muted-foreground'>
        {key
          ? 'This sandbox profile does not exist, or you cannot edit it.'
          : 'Repository not found.'}
      </div>
    );
  }
  if (key && profile?.canEdit) {
    return (
      <Form
        isNew={false}
        initialKey={key}
        initial={profile.config}
        repoLabel={profile.config.repoUrl ?? 'no repository'}
        onDone={done}
        save={(_, config) => save.mutateAsync({ mode: 'update', key, config })}
        onReset={profile.overridden ? () => reset.mutateAsync(key) : undefined}
      />
    );
  }
  if (!key && repo) {
    const base = slugify(repo.name);
    return (
      <Form
        isNew
        initialKey={base}
        initial={{
          slug: `${base}-sandbox`,
          name: `${repo.name} sandbox`,
          description: '',
          repoUrl: repo.url,
          defaultBranch: 'main',
          workDir: `/workspace/${base}`,
          template: '',
          steps: [],
        }}
        repoLabel={repo.name}
        onDone={done}
        save={(profileKey, config) =>
          save.mutateAsync({ mode: 'create', repoId: repo.repoId, key: profileKey, config })
        }
      />
    );
  }
  return <div className='m-8 h-40 animate-pulse rounded-xl bg-muted/30' />;
}
