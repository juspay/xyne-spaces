import { useMemo, useState, type ReactElement } from 'react';
import { AlertCircle, ChevronRight, Sparkles, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button';
import { EntitySelector } from '../../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../../components/ui/EntitySelector/EntitySelector.types';
import { Field } from '../../../components/ui/Field/Field';
import { Input } from '../../../components/ui/Input';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { apiInstance } from '../../../services/clients/apiClient';
import { getApiErrorMessage } from '../../../utils/apiError';
import { cn } from '../../../utils/classNames';
import type { ReleaseServiceDraft, SdlcReleaseServicesProps } from './SdlcReleases.types';
import {
  SERVICE_TONES,
  TRACK_CATEGORY,
  isServiceComplete,
  newService,
  plural,
  regexState,
} from './SdlcReleases.utils';

interface SuggestedService {
  name: string;
  regex: string;
  envPaths: string[];
  migrationPaths: string[];
}

const GRID_CLASS = 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_16px] gap-3';

export function SdlcReleaseServices({
  repoName,
  repoUrl,
  projectId,
  services,
  onChange,
}: SdlcReleaseServicesProps): ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const addService = (): void => {
    const service = newService();
    onChange([...services, service]);
    setOpenId(service.id);
  };

  const suggest = async (): Promise<void> => {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const response = await apiInstance.post<{ services?: SuggestedService[]; message?: string }>(
        '/commits/analyze/suggest-services',
        { repoUrl, projectId },
      );
      const have = new Set(services.map(service => service.name.trim().toLowerCase()));
      const added = (response.data.services ?? [])
        .filter(service => !have.has(service.name.trim().toLowerCase()))
        .map(service =>
          newService({
            name: service.name,
            regex: service.regex,
            envPaths: service.envPaths,
            migrationPaths: service.migrationPaths,
            showPaths: service.envPaths.length + service.migrationPaths.length > 0,
          }),
        );
      if (added.length === 0) {
        toast.info(
          response.data.message ?? 'No new services could be suggested for this repository.',
        );
        return;
      }
      onChange([
        ...services.filter(service => service.name.trim() || service.regex.trim()),
        ...added,
      ]);
      setOpenId(null);
      toast.success(`Added ${plural(added.length, 'service')}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to suggest services'));
    } finally {
      setSuggesting(false);
    }
  };

  const detectButton = (variant: 'default' | 'ghost'): ReactElement => (
    <Button
      variant={variant}
      size='sm'
      onClick={() => void suggest()}
      disabled={suggesting}
      data-track-category={TRACK_CATEGORY}
      data-track-name='DetectServicesWithAi'
    >
      <Sparkles />
      {suggesting ? 'Scanning…' : 'Detect with AI'}
    </Button>
  );

  if (services.length === 0) {
    return (
      <div className='flex flex-col gap-2.5'>
        <span className='text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground'>
          Services
        </span>
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-5 py-7 text-center'>
          <span className='flex size-10 items-center justify-center rounded-[10px] border border-border bg-background text-primary'>
            <Sparkles size={18} />
          </span>
          <div className='flex flex-col gap-1'>
            <span className='text-[14.5px] font-semibold text-foreground'>Map your services</span>
            <span className='max-w-[380px] text-[13px] leading-snug text-muted-foreground'>
              Services split each release by what changed where. Let AI scan{' '}
              <b className='font-semibold text-foreground/80'>{repoName}</b>, or add them yourself.
            </span>
          </div>
          <div className='flex flex-wrap justify-center gap-2'>
            {detectButton('default')}
            <Button
              variant='outline'
              size='sm'
              onClick={addService}
              data-track-category={TRACK_CATEGORY}
              data-track-name='ServiceAddedManually'
            >
              Add manually
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex items-center gap-1.5'>
        <span className='flex-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground'>
          Services · {services.length}
        </span>
        {detectButton('ghost')}
        <Button
          variant='outline'
          size='sm'
          onClick={addService}
          data-track-category={TRACK_CATEGORY}
          data-track-name='ServiceAdded'
        >
          + Add service
        </Button>
      </div>
      <div className='flex flex-col divide-y divide-border/70 overflow-hidden rounded-xl border border-border'>
        <div
          className={cn(
            GRID_CLASS,
            'bg-muted/40 px-4 py-2 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground',
          )}
        >
          <span>Service</span>
          <span>Path match</span>
          <span>Owner</span>
          <span />
        </div>
        {services.map((service, index) => (
          <ServiceRow
            key={service.id}
            service={service}
            tone={SERVICE_TONES[index % SERVICE_TONES.length] ?? ''}
            open={openId === service.id}
            onToggle={() => setOpenId(current => (current === service.id ? null : service.id))}
            onChange={patch =>
              onChange(
                services.map(item => (item.id === service.id ? { ...item, ...patch } : item)),
              )
            }
            onRemove={() => {
              onChange(services.filter(item => item.id !== service.id));
              setOpenId(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ServiceRow({
  service,
  tone,
  open,
  onToggle,
  onChange,
  onRemove,
}: {
  service: ReleaseServiceDraft;
  tone: string;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ReleaseServiceDraft>) => void;
  onRemove: () => void;
}): ReactElement {
  const name = service.name.trim();
  const complete = isServiceComplete(service);
  const regex = regexState(service.regex);
  const paths = [
    service.envPaths.length > 0 && plural(service.envPaths.length, 'env file'),
    service.migrationPaths.length > 0 && plural(service.migrationPaths.length, 'migration path'),
  ].filter(Boolean);
  const subtitle = !complete
    ? 'Needs name & regex'
    : paths.length > 0
      ? paths.join(' · ')
      : 'No env or migration paths';

  return (
    <div className={cn(open && 'bg-muted/20')}>
      <button
        type='button'
        aria-expanded={open}
        onClick={onToggle}
        className={cn(GRID_CLASS, 'w-full items-center px-4 py-2.5 text-left hover:bg-muted/40')}
        data-track-category={TRACK_CATEGORY}
        data-track-name='ServiceToggled'
      >
        <span className='flex min-w-0 items-center gap-2.5'>
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-[7px] text-xs font-bold uppercase',
              name ? tone : 'bg-muted text-muted-foreground',
            )}
          >
            {(name || '?').charAt(0)}
          </span>
          <span className='flex min-w-0 flex-col gap-px'>
            <span
              className={cn(
                'truncate text-sm font-semibold',
                name ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {name || 'Untitled service'}
            </span>
            <span
              className={cn(
                'truncate text-[11.5px]',
                complete ? 'text-muted-foreground' : 'text-status-pending',
              )}
            >
              {subtitle}
            </span>
          </span>
        </span>
        <span className='max-w-full justify-self-start truncate rounded-[5px] bg-muted px-1.5 py-0.5 font-code text-[11.5px] text-foreground/70'>
          {service.regex || '—'}
        </span>
        <span
          className={cn(
            'truncate text-[13px]',
            service.ownerTeam ? 'text-foreground/80' : 'text-muted-foreground/60',
          )}
        >
          {service.ownerTeam || '—'}
        </span>
        <ChevronRight
          size={14}
          className={cn('text-muted-foreground transition-transform', open && 'rotate-90')}
        />
      </button>
      {open && (
        <div className='flex flex-col gap-3.5 pb-4 pl-[54px] pr-4 pt-0.5'>
          <div className='grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3'>
            <Field label='Name' htmlFor={`service-name-${service.id}`} className='gap-1.5'>
              <Input
                id={`service-name-${service.id}`}
                value={service.name}
                onChange={event => onChange({ name: event.target.value })}
                placeholder='backend'
                data-track-category={TRACK_CATEGORY}
                data-track-name='ServiceNameEdited'
              />
            </Field>
            <Field label='Owner team' className='gap-1.5'>
              <TeamPicker
                value={service.ownerTeam}
                onChange={ownerTeam => onChange({ ownerTeam })}
              />
            </Field>
          </div>
          <Field label='Path regex' htmlFor={`service-regex-${service.id}`} className='gap-1.5'>
            <Input
              id={`service-regex-${service.id}`}
              value={service.regex}
              onChange={event => onChange({ regex: event.target.value })}
              placeholder='^backend/'
              aria-invalid={regex === 'invalid'}
              className='font-code'
              data-track-category={TRACK_CATEGORY}
              data-track-name='ServiceRegexEdited'
            />
            <span
              className={cn(
                'flex items-center gap-1.5 text-[12.5px]',
                regex === 'invalid' && 'text-status-failure',
                regex === 'valid' && 'text-status-success',
                regex === 'empty' && 'text-muted-foreground',
              )}
            >
              <span className='size-1.5 rounded-full bg-current opacity-70' />
              {regex === 'invalid'
                ? 'Not a valid regular expression'
                : 'Matched against file paths in every commit.'}
            </span>
          </Field>
          {service.showPaths && (
            <div className='grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3'>
              <PathTagsInput
                id={`service-env-paths-${service.id}`}
                label='Env file paths'
                values={service.envPaths}
                placeholder='config/env.yml'
                trackName='EnvPath'
                onChange={envPaths => onChange({ envPaths })}
              />
              <PathTagsInput
                id={`service-migration-paths-${service.id}`}
                label='Migration paths'
                values={service.migrationPaths}
                placeholder='db/migrate/'
                trackName='MigrationPath'
                onChange={migrationPaths => onChange({ migrationPaths })}
              />
            </div>
          )}
          <div className='flex items-center gap-2'>
            {!service.showPaths && (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => onChange({ showPaths: true })}
                className='-ml-2 font-normal text-foreground/70'
                data-track-category={TRACK_CATEGORY}
                data-track-name='ServicePathsShown'
              >
                + Env &amp; migration paths
              </Button>
            )}
            <span className='flex-1' />
            <Button
              variant='ghost'
              size='sm'
              onClick={onRemove}
              className='font-normal text-muted-foreground hover:bg-[color-mix(in_srgb,var(--status-failure)_10%,transparent)] hover:text-status-failure'
              data-track-category={TRACK_CATEGORY}
              data-track-name='ServiceRemoved'
            >
              Remove
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={onToggle}
              data-track-category={TRACK_CATEGORY}
              data-track-name='ServiceDone'
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PathTagsInput({
  id,
  label,
  values,
  placeholder,
  trackName,
  onChange,
}: {
  id: string;
  label: string;
  values: string[];
  placeholder: string;
  trackName: string;
  onChange: (values: string[]) => void;
}): ReactElement {
  const [draft, setDraft] = useState('');

  const commit = (raw: string): void => {
    const added = raw
      .split(',')
      .map(value => value.trim())
      .filter(value => value && !values.includes(value));
    if (added.length > 0) onChange([...values, ...added]);
    setDraft('');
  };

  return (
    <Field label={label} htmlFor={id} className='gap-1.5'>
      <div className='flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-1.5 py-1 shadow-xs focus-within:border-ring focus-within:ring-[2px] focus-within:ring-ring/10'>
        {values.map(value => (
          <span
            key={value}
            className='flex h-6 items-center gap-0.5 rounded-[5px] bg-muted pl-2 pr-0.5 font-code text-xs text-foreground/85'
          >
            {value}
            <button
              type='button'
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter(item => item !== value))}
              className='flex size-[18px] items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground'
              data-track-category={TRACK_CATEGORY}
              data-track-name={`${trackName}Removed`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={event => {
            const value = event.target.value;
            if (value.includes(',')) commit(value);
            else setDraft(value);
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(draft);
            } else if (event.key === 'Backspace' && !draft && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          placeholder={placeholder}
          className='h-[26px] min-w-[110px] flex-1 bg-transparent px-1 font-code text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground'
          data-track-category={TRACK_CATEGORY}
          data-track-name={`${trackName}Added`}
        />
      </div>
    </Field>
  );
}

function TeamPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (team: string) => void;
}): ReactElement {
  const groups = useUserGroups();
  const options = useMemo((): SelectorOption[] => {
    const teams: SelectorOption[] = [...new Set(groups.map(group => group.name).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({
        value: name,
        label: name,
        icon: <Users size={14} className='text-muted-foreground' />,
      }));
    const current = value.trim();
    if (current && !teams.some(team => team.value === current)) {
      teams.unshift({
        value: current,
        label: current,
        icon: <AlertCircle size={14} className='text-status-pending' />,
        subtitle: 'Not a user group — pick a real one to standardize ownership',
      });
    }
    return teams;
  }, [groups, value]);

  return (
    <EntitySelector
      options={options}
      selectedValue={value.trim() || null}
      onSelect={next => onChange(next ?? '')}
      placeholder='Select owner team'
      searchPlaceholder='Search user groups…'
      showUnassignOption={!!value.trim()}
      unassignLabel='No owner team'
      allowDeselect={false}
      width='100%'
      matchTriggerWidth
      analytics={{
        category: TRACK_CATEGORY,
        searchName: 'OwnerTeamSearched',
        optionName: 'OwnerTeamPicked',
        clearName: 'OwnerTeamCleared',
      }}
    />
  );
}
