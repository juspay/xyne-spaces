/* eslint-disable local-rules/require-tracking-on-click */
import { CSSProperties, ReactElement, useEffect, useMemo, useState } from 'react';
import { apiInstance } from '../../../services/clients/apiClient';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GitCommit,
  PlugZap,
  Trash2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { cn } from '../../../utils/classNames';
import { SearchChannel } from '../../ui/SearchChannel/SearchChannel';
import { ChannelScopeType } from '@xyne/shared';
import { useReleaseConfigForm } from './useReleaseConfigForm';
import {
  ReleaseTrackingMode,
  type ApplicationConfig,
  type Channel,
  type ExistingReleaseConfig,
  type ReleaseTrackingModeValue,
  type ReleaseConfigWizardProps,
  type VCSProvider,
} from './ReleaseConfigWizard.types';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

// ─── Shared style tokens ─────────────────────────────────────────────────────
const INPUT_CLASS =
  'w-full px-2 py-1.5 border border-input rounded-md bg-background text-foreground text-sm disabled:opacity-60';
const LABEL_CLASS = 'block text-xs font-medium mb-0.5';
const HELP_CLASS = 'text-[11px] text-muted-foreground mt-0.5';

// ─── VCS provider options (Step 1) ──────────────────────────────────────────
const VCS_PROVIDERS: Array<{
  value: VCSProvider;
  label: string;
  description: string;
  enabled: boolean;
}> = [
  {
    value: 'BITBUCKET_SERVER',
    label: 'Bitbucket Server',
    description: 'Self-hosted Bitbucket (Data Center)',
    enabled: true,
  },
  {
    value: 'GITHUB',
    label: 'GitHub',
    description: 'GitHub.com or GitHub Enterprise',
    enabled: true,
  },
  {
    value: 'BITBUCKET_CLOUD',
    label: 'Bitbucket Cloud',
    description: 'Atlassian Bitbucket Cloud',
    enabled: false,
  },
];

const RELEASE_TRACKING_MODES: Array<{
  value: ReleaseTrackingModeValue;
  label: string;
  description: string;
}> = [
  {
    value: ReleaseTrackingMode.COMMIT_RANGE,
    label: 'Commit range',
    description: 'Release tickets collect branch, deployed commit, and new commit.',
  },
  {
    value: ReleaseTrackingMode.VERSION,
    label: 'Version',
    description:
      'Release tickets collect a release version. Dev-ticket mapping lands in the next phase.',
  },
];

// ─── SelectionCard ────────────────────────────────────────────────────────────
/** Generic card used by Step 1 for single-selection lists. */
interface SelectionCardProps {
  isSelected: boolean;
  isDisabled?: boolean;
  onClick: () => void;
  label: string;
  description: string;
  badge?: string | undefined;
}

const SelectionCard = ({
  isSelected,
  isDisabled,
  onClick,
  label,
  description,
  badge,
}: SelectionCardProps): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    data-track-category='Release'
    data-track-name='WIZARD_STEP_CLICK'
    disabled={isDisabled}
    aria-disabled={isDisabled}
    className={cn(
      'p-3 rounded-lg border-2 text-left transition-all flex items-center gap-3',
      isDisabled && 'opacity-50 cursor-not-allowed pointer-events-none',
      !isDisabled && 'hover:border-primary/50',
      isSelected && !isDisabled ? 'border-primary bg-primary/5' : 'border-border bg-card',
    )}
  >
    <GitCommit className='w-5 h-5 text-primary shrink-0' />
    <div className='flex-1'>
      <h4 className='font-medium text-sm flex items-center gap-2'>
        {label}
        {badge && (
          <span className='rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5 font-normal'>
            {badge}
          </span>
        )}
      </h4>
      <p className='text-xs text-muted-foreground'>{description}</p>
    </div>
  </button>
);

// ─── Step 1: VCS Provider ────────────────────────────────────────────────────
interface Step1Props {
  selected: VCSProvider | null;
  onSelect: (provider: VCSProvider) => void;
}

const Step1VCSProvider = ({ selected, onSelect }: Step1Props): ReactElement => (
  <div className='space-y-2'>
    <h3 className='text-base font-semibold'>Select Version Control System</h3>
    <p className='text-xs text-muted-foreground'>Choose your code hosting provider.</p>
    <div className='grid grid-cols-1 gap-2 mt-3'>
      {VCS_PROVIDERS.map(provider => (
        <SelectionCard
          key={provider.value}
          isSelected={selected === provider.value}
          isDisabled={!provider.enabled}
          onClick={() => onSelect(provider.value)}
          label={provider.label}
          description={provider.description}
          badge={!provider.enabled ? 'Coming soon' : undefined}
        />
      ))}
    </div>
  </div>
);

// ─── Step 2: Applications + Channel ─────────────────────────────────────────

// Chip-style input for comma-separated paths. The on-disk shape stays a CSV
// string so save logic and ApplicationConfig don't need to change.
interface PathChipsInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
}

const PathChipsInput = ({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: PathChipsInputProps): ReactElement => {
  const [draft, setDraft] = useState('');
  const paths = value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const commitMany = (incoming: string[]): void => {
    const additions = incoming.map(s => s.trim()).filter(Boolean);
    if (additions.length === 0) return;
    // Dedupe against existing + within the batch itself.
    const seen = new Set(paths);
    const merged = [...paths];
    for (const a of additions) {
      if (!seen.has(a)) {
        seen.add(a);
        merged.push(a);
      }
    }
    onChange(merged.join(', '));
    setDraft('');
  };

  const remove = (path: string): void => {
    onChange(paths.filter(p => p !== path).join(', '));
  };

  return (
    // <label> forwards empty-area clicks to the input natively
    <label className='border border-input rounded-md bg-background p-1 flex flex-wrap items-center gap-1 min-h-[34px] cursor-text focus-within:ring-1 focus-within:ring-ring'>
      {paths.map(p => (
        <span
          key={p}
          className='inline-flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded text-xs font-mono max-w-full'
          title={p}
        >
          <span className='truncate'>{p}</span>
          <button
            type='button'
            onClick={() => remove(p)}
            className='text-muted-foreground hover:text-destructive shrink-0'
            aria-label={`Remove ${p}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type='text'
        value={draft}
        aria-label={ariaLabel}
        placeholder={paths.length === 0 ? placeholder : ''}
        onChange={e => {
          const v = e.target.value;
          // Pasting or typing a comma commits everything up to the last comma
          // as chips and keeps the trailing text as the new draft.
          if (v.includes(',')) {
            const parts = v.split(',');
            const tail = parts.pop() ?? '';
            commitMany(parts);
            setDraft(tail);
          } else {
            setDraft(v);
          }
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitMany([draft]);
          } else if (e.key === 'Backspace' && draft === '' && paths.length > 0) {
            // Standard chip-input behavior — backspace on empty pops the last chip.
            remove(paths[paths.length - 1]!);
          }
        }}
        onBlur={() => {
          if (draft.trim()) commitMany([draft]);
        }}
        className='flex-1 min-w-[120px] bg-transparent outline-none text-sm px-1 py-0.5'
      />
    </label>
  );
};

// ─── Owner Team Picker ──────────────────────────────────────────────────────
// Wraps EntitySelector with user_group data. Stores the group NAME in
// ownerTeam (string) to match the on-disk shape.
const OwnerTeamPicker = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): ReactElement => {
  const groups = useUserGroups();

  const options: SelectorOption[] = useMemo(() => {
    const base: SelectorOption[] = groups
      .filter(g => !!g.name)
      .map(g => ({
        value: g.name,
        label: g.name,
        icon: <Users size={14} className='text-muted-foreground' />,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // If the current value doesn't match any user group, surface it as an
    // "unmatched" option so legacy values (e.g. "@frontend-team") stay visible
    // until the user picks a real group.
    const trimmed = value.trim();
    if (trimmed && !base.some(o => o.value === trimmed)) {
      base.unshift({
        value: trimmed,
        label: trimmed,
        icon: <AlertCircle size={14} className='text-amber-600' />,
        subtitle: 'Not a user group — pick a real one to standardize ownership',
      });
    }
    return base;
  }, [groups, value]);

  return (
    <EntitySelector
      options={options}
      selectedValue={value.trim() || null}
      onSelect={next => onChange(next ?? '')}
      placeholder='Select owner team'
      searchPlaceholder='Search user groups…'
      showUnassignOption
      unassignLabel='No owner team'
      width='100%'
    />
  );
};

interface ApplicationRowProps {
  app: ApplicationConfig;
  index: number;
  isLocked: boolean;
  canRemove: boolean;
  onRemove: (id: string) => void;
  onUpdate: (id: string, field: keyof ApplicationConfig, value: string) => void;
}

const ApplicationRow = ({
  app,
  index,
  isLocked,
  canRemove,
  onRemove,
  onUpdate,
}: ApplicationRowProps): ReactElement => (
  <div className='px-3 py-2 bg-muted rounded-md space-y-2'>
    <div className='flex items-center justify-between'>
      <h4 className='font-medium text-sm'>Application {index + 1}</h4>
      {canRemove && (
        <button
          type='button'
          onClick={() => onRemove(app.id)}
          data-track-category='Release'
          data-track-name='REMOVE_WIZARD_APP'
          className='text-muted-foreground hover:text-destructive transition-colors p-1 rounded hover:bg-destructive/10'
          aria-label={isLocked ? 'Delete on save' : 'Remove'}
          title={isLocked ? 'This application will be deleted on Save' : 'Remove'}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>

    <div className='grid grid-cols-1 md:grid-cols-2 gap-x-2 gap-y-2'>
      <div>
        <label className={LABEL_CLASS} htmlFor={`application-name-${app.id}`}>
          Application Name *
        </label>
        <input
          id={`application-name-${app.id}`}
          type='text'
          value={app.name}
          disabled={isLocked}
          onChange={e => onUpdate(app.id, 'name', e.target.value)}
          placeholder='e.g., backend'
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <label className={LABEL_CLASS} htmlFor={`application-regex-${app.id}`}>
          Application Regex *
        </label>
        <input
          id={`application-regex-${app.id}`}
          type='text'
          value={app.regex}
          onChange={e => onUpdate(app.id, 'regex', e.target.value)}
          placeholder='e.g., ^backend/'
          className={INPUT_CLASS}
        />
        <p className={HELP_CLASS}>Matches commit file paths to identify this app</p>
      </div>

      <div>
        <div className={LABEL_CLASS}>Owner Team</div>
        <OwnerTeamPicker value={app.ownerTeam} onChange={v => onUpdate(app.id, 'ownerTeam', v)} />
      </div>

      <div className='md:col-span-2'>
        <div className={LABEL_CLASS}>Environment File Paths</div>
        <PathChipsInput
          value={app.envPaths}
          onChange={v => onUpdate(app.id, 'envPaths', v)}
          placeholder='config/env.yml, .env.prod'
          ariaLabel={`Environment file paths for application ${index + 1}`}
        />
        <p className={HELP_CLASS}>Press Enter or type a comma to add a path</p>
      </div>

      <div className='md:col-span-2'>
        <div className={LABEL_CLASS}>Migration File Paths</div>
        <PathChipsInput
          value={app.migrationPaths}
          onChange={v => onUpdate(app.id, 'migrationPaths', v)}
          placeholder='migrations/, db/migrate/'
          ariaLabel={`Migration file paths for application ${index + 1}`}
        />
        <p className={HELP_CLASS}>Press Enter or type a comma to add a path</p>
      </div>
    </div>
  </div>
);

interface Step3Props {
  applications: ApplicationConfig[];
  existingAppNames: Set<string>;
  selectedChannel: Channel | null;
  channels: Channel[] | undefined;
  onChannelSelect: (channel: Channel | null) => void;
  onAddApplication: () => void;
  onRemoveApplication: (id: string) => void;
  onUpdateApplication: (id: string, field: keyof ApplicationConfig, value: string) => void;
  releaseTrackingMode: ReleaseTrackingModeValue;
  onReleaseTrackingModeChange: (mode: ReleaseTrackingModeValue) => void;
  sharedRepoUrl: string;
  onSharedRepoUrlChange: (v: string) => void;
  showGroupControls: boolean;
  allowApplicationListChanges: boolean;
  onTestConnection: () => Promise<void>;
  isTestingConnection: boolean;
  /** null = not tested yet; otherwise the last test result. */
  connectionTest: { ok: boolean; message: string } | null;
}

const Step3Applications = ({
  applications,
  existingAppNames,
  selectedChannel,
  channels,
  onChannelSelect,
  onAddApplication,
  onRemoveApplication,
  onUpdateApplication,
  releaseTrackingMode,
  onReleaseTrackingModeChange,
  sharedRepoUrl,
  onSharedRepoUrlChange,
  showGroupControls,
  allowApplicationListChanges,
  onTestConnection,
  isTestingConnection,
  connectionTest,
}: Step3Props): ReactElement => {
  return (
    <div className='space-y-3'>
      <div>
        <h3 className='text-base font-semibold'>Configure Applications</h3>
        <p className='text-xs text-muted-foreground'>
          Add applications, their file-path regexes, and app-specific env / migration paths.
        </p>
      </div>

      {showGroupControls && (
        <>
          <div className='px-3 py-2 bg-muted rounded-md space-y-2'>
            <h4 className='font-medium text-sm'>Shared Repository</h4>
            <div>
              <label className={LABEL_CLASS} htmlFor='release-repository-url'>
                Repository URL *
              </label>
              <div className='flex gap-2'>
                <input
                  id='release-repository-url'
                  type='text'
                  value={sharedRepoUrl}
                  onChange={e => onSharedRepoUrlChange(e.target.value)}
                  placeholder='https://bitbucket.example.com/scm/PROJECT/repo.git'
                  className={INPUT_CLASS}
                />
                <Button
                  variant='secondary'
                  size='sm'
                  onClick={() => void onTestConnection()}
                  disabled={isTestingConnection || !sharedRepoUrl.trim()}
                  title='Verify the repo URL and token before configuring applications'
                  trackId='test_release_repo_connection'
                >
                  <PlugZap size={14} />
                  {isTestingConnection ? 'Testing…' : 'Test'}
                </Button>
              </div>
              {connectionTest ? (
                <p
                  className={cn(
                    'text-[11px] mt-1 flex items-center gap-1',
                    connectionTest.ok ? 'text-green-600 dark:text-green-500' : 'text-destructive',
                  )}
                >
                  {connectionTest.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {connectionTest.message}
                </p>
              ) : (
                <p className={HELP_CLASS}>
                  Verifies the repo URL + token before you configure applications.
                </p>
              )}
            </div>
          </div>

          <div className='px-3 py-2 bg-muted rounded-md space-y-2'>
            <h4 className='font-medium text-sm'>Release Tracking Mode</h4>
            <p className={HELP_CLASS}>
              Controls which dynamic fields appear when creating release tickets.
            </p>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
              {RELEASE_TRACKING_MODES.map(mode => (
                <SelectionCard
                  key={mode.value}
                  isSelected={releaseTrackingMode === mode.value}
                  onClick={() => onReleaseTrackingModeChange(mode.value)}
                  label={mode.label}
                  description={mode.description}
                />
              ))}
            </div>
          </div>

          <div className='px-3 py-2 bg-primary/5 rounded-md border border-primary/20 space-y-1.5'>
            <h4 className='font-medium text-xs flex items-center gap-2'>
              Release Channel *
              <span className='text-[11px] font-normal text-muted-foreground'>
                (Required for release notifications)
              </span>
            </h4>
            <SearchChannel
              channels={(channels ?? []).map(c => ({
                id: c.id,
                name: c.name,
                scopeType: (c.type as ChannelScopeType) ?? ChannelScopeType.DEFAULT,
              }))}
              mode='channel'
              selectedChannels={
                selectedChannel ? [{ id: selectedChannel.id, name: selectedChannel.name }] : []
              }
              onChannelsChange={items => {
                const next = items[items.length - 1];
                onChannelSelect(next ? { id: next.id, name: next.name } : null);
              }}
              placeholder='Search and select a channel...'
            />
          </div>
        </>
      )}

      {/* Application rows */}
      <div className='space-y-2 max-h-[360px] overflow-y-auto pr-2'>
        {applications.map((app, index) => (
          <ApplicationRow
            key={app.id}
            app={app}
            index={index}
            isLocked={existingAppNames.has(app.name)}
            canRemove={allowApplicationListChanges && applications.length > 1}
            onRemove={onRemoveApplication}
            onUpdate={onUpdateApplication}
          />
        ))}
      </div>

      {allowApplicationListChanges && (
        <Button
          variant='secondary'
          onClick={onAddApplication}
          data-track-category='Release'
          data-track-name='ADD_APPLICATION'
          className='w-full'
          size='sm'
        >
          + Add Another Application
        </Button>
      )}
    </div>
  );
};

// ─── WizardProgressBar ───────────────────────────────────────────────────────
const STEP_LABELS: Record<number, string> = {
  1: '1. VCS Provider',
  2: '2. Applications',
};

interface WizardProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

const WizardProgressBar = ({ currentStep, totalSteps }: WizardProgressBarProps): ReactElement => (
  <div className='mb-4'>
    <div className='w-full h-1.5 bg-muted rounded-full overflow-hidden'>
      <div
        className='h-full bg-primary transition-all w-[var(--progress-width)]'
        style={{ '--progress-width': `${(currentStep / totalSteps) * 100}%` } as CSSProperties}
      />
    </div>
    <div className='mt-2 flex justify-between text-xs'>
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map(step => (
        <span
          key={step}
          className={cn(
            currentStep >= step ? 'text-foreground font-medium' : 'text-muted-foreground',
          )}
        >
          {STEP_LABELS[step]}
        </span>
      ))}
    </div>
  </div>
);

// ─── ReleaseConfigWizard (root) ───────────────────────────────────────────────
function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function buildExistingConfig(
  mainBoard: {
    readonly id: string;
    readonly name: string;
    readonly vcsProvider?: string | null;
    readonly releaseTrackingMode?: string | null;
  },
  applications: readonly {
    readonly id: string;
    readonly boardId: string;
    readonly name: string;
    readonly repoUrl: string;
    readonly regex: string;
    readonly ownerTeam: string;
    readonly channelId?: string | null;
    readonly envPaths: unknown;
    readonly migrationPaths: unknown;
  }[],
  boardNamesById: Readonly<Record<string, string>>,
): ExistingReleaseConfig | null {
  if (!mainBoard.vcsProvider || !mainBoard.releaseTrackingMode) return null;

  return {
    mainBoardId: mainBoard.id,
    mainBoardName: mainBoard.name,
    vcsProvider: mainBoard.vcsProvider as ExistingReleaseConfig['vcsProvider'],
    releaseTrackingMode:
      mainBoard.releaseTrackingMode as ExistingReleaseConfig['releaseTrackingMode'],
    channelId: applications[0]?.channelId ?? null,
    applications: applications.map(application => ({
      id: application.id,
      boardId: application.boardId,
      boardName: boardNamesById[application.boardId] ?? '',
      name: application.name,
      repoUrl: application.repoUrl,
      regex: application.regex,
      ownerTeam: application.ownerTeam,
      envPaths: jsonStringArray(application.envPaths).join(', '),
      migrationPaths: jsonStringArray(application.migrationPaths).join(', '),
    })),
  };
}

const ReleaseConfigWizardForm = ({
  projectId,
  mode,
  isOpen,
  existingConfig,
  onClose,
  onSave,
}: ReleaseConfigWizardProps & {
  existingConfig?: ExistingReleaseConfig;
}): ReactElement => {
  const applicationBoardId = mode.kind === 'edit-application' ? mode.applicationBoardId : null;
  const selectedApplication = existingConfig?.applications.find(
    application => application.boardId === applicationBoardId,
  );
  const isApplicationEdit = mode.kind === 'edit-application';

  const form = useReleaseConfigForm({
    projectId,
    existingConfig,
    onSave: mainBoard => {
      if (isApplicationEdit && selectedApplication) {
        onSave({ id: selectedApplication.boardId, name: selectedApplication.name });
        return;
      }
      onSave(mainBoard);
    },
  });

  const visibleApplications =
    isApplicationEdit && selectedApplication
      ? form.applications.filter(application => application.boardId === selectedApplication.boardId)
      : form.applications;

  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTest, setConnectionTest] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const handleTestConnection = async (): Promise<void> => {
    if (!form.sharedRepoUrl.trim() || !form.vcsProvider) return;
    setIsTestingConnection(true);
    setConnectionTest(null);
    try {
      const response = await apiInstance.post<{ ok: boolean; message: string }>(
        '/commits/analyze/test-connection',
        { repoUrl: form.sharedRepoUrl.trim(), vcsProvider: form.vcsProvider },
      );
      setConnectionTest(response.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test failed';
      setConnectionTest({ ok: false, message: msg });
    } finally {
      setIsTestingConnection(false);
    }
  };

  useEffect(() => {
    setConnectionTest(null);
  }, [form.sharedRepoUrl, form.vcsProvider]);

  // The form keeps the complete group in memory even when application edit
  // displays one row. The backend uses the submitted list to detect removals.
  const existingAppNames = useMemo(
    () => new Set((existingConfig?.applications ?? []).map(application => application.name)),
    [existingConfig],
  );

  const canProceed =
    form.currentStep === 1
      ? !!form.vcsProvider
      : !!form.sharedRepoUrl.trim() && form.applications.some(app => app.name.trim());

  const canSave =
    form.currentStep === 2 &&
    !!form.sharedRepoUrl.trim() &&
    form.applications.some(app => app.name.trim()) &&
    // The save falls back to the group's stored channel when the picker is
    // hidden (application edit) or the channel failed to prefill.
    (!!form.selectedChannel || !!existingConfig?.channelId);

  const showCancelOnLeft = form.currentStep === 1 || form.isEditing;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onClose}
      title={
        mode.kind === 'create'
          ? 'Create Release Board'
          : isApplicationEdit
            ? 'Edit Application Release Config'
            : 'Edit Release Board Config'
      }
      className='max-w-5xl'
    >
      <div className='p-4 w-full'>
        {!form.isEditing && <WizardProgressBar currentStep={form.currentStep} totalSteps={2} />}

        {form.currentStep === 1 && !form.isEditing && (
          <Step1VCSProvider selected={form.vcsProvider} onSelect={form.setVcsProvider} />
        )}
        {form.currentStep === 2 && (
          <Step3Applications
            applications={visibleApplications}
            existingAppNames={existingAppNames}
            selectedChannel={form.selectedChannel}
            channels={form.channels}
            onChannelSelect={form.setSelectedChannel}
            onAddApplication={form.addApplication}
            onRemoveApplication={form.removeApplication}
            onUpdateApplication={form.updateApplication}
            releaseTrackingMode={form.releaseTrackingMode}
            onReleaseTrackingModeChange={form.setReleaseTrackingMode}
            sharedRepoUrl={form.sharedRepoUrl}
            onSharedRepoUrlChange={form.setSharedRepoUrl}
            showGroupControls={!isApplicationEdit}
            allowApplicationListChanges={!isApplicationEdit}
            onTestConnection={handleTestConnection}
            isTestingConnection={isTestingConnection}
            connectionTest={connectionTest}
          />
        )}

        <div className='flex justify-between mt-4 pt-3 border-t border-border'>
          <Button
            variant='secondary'
            onClick={showCancelOnLeft ? onClose : form.handleBack}
            data-track-category='Release'
            data-track-name='WIZARD_BACK_OR_CANCEL'
            disabled={form.isSaving}
          >
            {showCancelOnLeft ? (
              'Cancel'
            ) : (
              <>
                <ChevronLeft size={16} /> Back
              </>
            )}
          </Button>

          {form.currentStep < 2 ? (
            <Button
              variant='default'
              onClick={form.handleNext}
              data-track-category='Release'
              data-track-name='WIZARD_NEXT'
              disabled={!canProceed}
            >
              Next <ChevronRight size={16} />
            </Button>
          ) : (
            <Button
              variant='default'
              onClick={() => void form.handleSave()}
              data-track-category='Release'
              data-track-name='SAVE_RELEASE_CONFIG'
              trackId='save_release_config'
              disabled={!canSave || form.isSaving}
            >
              {form.isSaving
                ? 'Saving...'
                : isApplicationEdit
                  ? 'Save Application'
                  : form.isEditing
                    ? 'Next'
                    : 'Save Configuration'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export const ReleaseConfigWizard = ({
  projectId,
  boardNamesById,
  applications,
  mode,
  isOpen,
  onClose,
  onSave,
}: ReleaseConfigWizardProps): ReactElement => {
  const applicationBoardId = mode.kind === 'edit-application' ? mode.applicationBoardId : '';
  // boardId is @unique, so the edited application is the one row in the parent's
  // project app list whose boardId matches — no separate applicationByBoardId query.
  const selectedApplication = useMemo(
    () =>
      mode.kind === 'edit-application'
        ? (applications?.find(app => app.boardId === applicationBoardId) ?? null)
        : null,
    [applications, mode.kind, applicationBoardId],
  );
  const mainBoardId =
    mode.kind === 'edit-main'
      ? mode.mainBoardId
      : mode.kind === 'edit-application'
        ? (selectedApplication?.mainReleaseBoardId ?? '')
        : '';
  const [mainBoard, mainBoardStatus] = useCachedQuery(
    queries.boardFullDetailById({ boardId: mainBoardId }),
    { enabled: mode.kind !== 'create' && !!mainBoardId },
  );
  // A release group always lives within one project (every app is inserted with the
  // project's id and the same mainReleaseBoardId), so the group is a subset of the
  // parent's project app list — filter it instead of a separate query.
  const groupApplications = useMemo(
    () => (applications ?? []).filter(app => app.mainReleaseBoardId === mainBoardId),
    [applications, mainBoardId],
  );

  if (mode.kind === 'create') {
    return (
      <ReleaseConfigWizardForm
        projectId={projectId}
        boardNamesById={boardNamesById}
        mode={mode}
        isOpen={isOpen}
        onClose={onClose}
        onSave={onSave}
      />
    );
  }

  // Loading only while genuinely pending. The project app list must be synced (it
  // backs both selectedApplication and groupApplications); the main board loads
  // only when a mainBoardId exists. A resolved application with no owning
  // mainReleaseBoardId must fall through to the error dialog below — treating
  // '!mainBoardId' as loading kept this dialog up forever.
  const isLoading =
    applications === undefined || (!!mainBoardId && mainBoardStatus.type !== 'complete');
  const existingConfig = mainBoard
    ? buildExistingConfig(mainBoard, groupApplications, boardNamesById)
    : null;

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose} title='Loading release configuration'>
        <div className='p-6 text-sm text-muted-foreground'>Loading...</div>
      </Dialog>
    );
  }

  if (!existingConfig || (mode.kind === 'edit-application' && !selectedApplication)) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose} title='Release configuration unavailable'>
        <div className='p-6 text-sm text-destructive'>
          This release board does not have a valid owning release configuration.
        </div>
      </Dialog>
    );
  }

  return (
    <ReleaseConfigWizardForm
      projectId={projectId}
      boardNamesById={boardNamesById}
      mode={mode}
      isOpen={isOpen}
      existingConfig={existingConfig}
      onClose={onClose}
      onSave={onSave}
    />
  );
};
