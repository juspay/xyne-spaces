import type { ReactElement } from 'react';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { Field } from '../../ui/Field/Field';
import { Input } from '../../ui/Input';
import { cn } from '../../../utils/classNames';
import { RepoDot, repoColor } from '../../Release/repoVisual';

export type ReleaseRangeKey = 'branch' | 'deployedCommit' | 'newCommit';

export interface ReleaseRepoRow {
  id: string;
  name: string;
  isVersion: boolean;
  services: string[];
  selected: boolean;
  primary: boolean;
  disabledReason: string | null;
  range: Record<ReleaseRangeKey, string>;
}

interface ReleaseRepositoriesSectionProps {
  repos: ReleaseRepoRow[];
  version: string;
  versionError: string | undefined;
  onToggle: (id: string) => void;
  onMakePrimary: (id: string) => void;
  onClear: () => void;
  onRangeChange: (id: string, key: ReleaseRangeKey, value: string) => void;
  onVersionChange: (value: string) => void;
}

const TRACK_CATEGORY = 'CreateTicket';
const FIELD_INPUT_CLASS = 'h-[34px] font-code text-[12.5px]';

export function ReleaseRepositoriesSection({
  repos,
  version,
  versionError,
  onToggle,
  onMakePrimary,
  onClear,
  onRangeChange,
  onVersionChange,
}: ReleaseRepositoriesSectionProps): ReactElement {
  const selectedCount = repos.filter(repo => repo.selected).length;

  return (
    <div className='flex flex-col gap-2.5 pb-4'>
      <div className='flex items-baseline gap-2.5'>
        <span className='text-[13.5px] font-semibold text-foreground'>Repositories</span>
        <span className='flex-1 text-[12.5px] text-muted-foreground'>
          {selectedCount} of {repos.length} selected
        </span>
        {selectedCount > 0 && (
          <Button
            variant='ghost'
            size='sm'
            onClick={onClear}
            className='h-[26px] px-2 font-normal text-muted-foreground'
            data-track-category={TRACK_CATEGORY}
            data-track-name='ClearReleaseRepos'
          >
            Clear
          </Button>
        )}
      </div>
      <div className='divide-y divide-border overflow-hidden rounded-xl border border-border'>
        {repos.map(repo => {
          const disabled = !repo.selected && !!repo.disabledReason;
          return (
            <div key={repo.id} className={repo.selected ? 'bg-primary/5' : 'bg-background'}>
              <div className='flex items-center gap-3 px-3.5'>
                <Checkbox
                  checked={repo.selected}
                  onChange={() => onToggle(repo.id)}
                  disabled={disabled}
                  label=''
                  ariaLabel={`Include ${repo.name}`}
                  data-track-category={TRACK_CATEGORY}
                  data-track-name='ToggleReleaseRepo'
                />
                <button
                  type='button'
                  onClick={() => onToggle(repo.id)}
                  disabled={disabled}
                  className='flex min-h-[52px] min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50'
                  data-track-category={TRACK_CATEGORY}
                  data-track-name='ToggleReleaseRepo'
                >
                  <span className='flex items-center gap-2'>
                    <RepoDot color={repoColor(repo.id)} />
                    <span
                      className={cn(
                        'truncate text-sm font-semibold',
                        repo.selected ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {repo.name}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-[5px] px-[7px] py-px text-[11px]',
                        repo.isVersion
                          ? 'bg-[color-mix(in_srgb,var(--status-paused)_10%,transparent)] text-status-paused'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {repo.isVersion ? 'Version' : 'Commit range'}
                    </span>
                  </span>
                  <span className='truncate text-xs text-muted-foreground'>
                    {disabled
                      ? repo.disabledReason
                      : repo.services.join(' · ') || 'No services mapped'}
                  </span>
                </button>
                {repo.primary && selectedCount > 1 && (
                  <span className='shrink-0 rounded-[5px] bg-primary/15 px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.08em] text-primary'>
                    Primary
                  </span>
                )}
                {repo.selected && !repo.primary && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => onMakePrimary(repo.id)}
                    className='h-[26px] px-2 font-normal text-muted-foreground'
                    data-track-category={TRACK_CATEGORY}
                    data-track-name='MakeReleaseRepoPrimary'
                  >
                    Make primary
                  </Button>
                )}
              </div>
              {repo.selected && (
                <div className='pb-3.5 pl-11 pr-3.5'>
                  {repo.isVersion ? (
                    <Field
                      label='Version'
                      required
                      error={versionError}
                      htmlFor={`release-version-${repo.id}`}
                      className='max-w-[260px] gap-[5px]'
                    >
                      <Input
                        id={`release-version-${repo.id}`}
                        value={version}
                        onChange={event => onVersionChange(event.target.value)}
                        placeholder='e.g. 1.0.0'
                        aria-invalid={!!versionError}
                        className={FIELD_INPUT_CLASS}
                        data-track-category={TRACK_CATEGORY}
                        data-track-name='ReleaseVersion'
                      />
                    </Field>
                  ) : (
                    <div className='grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] items-end gap-2.5'>
                      <Field
                        label='Branch'
                        htmlFor={`release-branch-${repo.id}`}
                        className='gap-[5px]'
                      >
                        <Input
                          id={`release-branch-${repo.id}`}
                          value={repo.range.branch}
                          onChange={event => onRangeChange(repo.id, 'branch', event.target.value)}
                          placeholder='main'
                          className={FIELD_INPUT_CLASS}
                          data-track-category={TRACK_CATEGORY}
                          data-track-name='RepoBranch'
                        />
                      </Field>
                      <Field label='Commit range' className='gap-[5px]'>
                        <div className='flex items-center gap-1.5'>
                          <Input
                            value={repo.range.deployedCommit}
                            onChange={event =>
                              onRangeChange(repo.id, 'deployedCommit', event.target.value)
                            }
                            placeholder='deployed'
                            aria-label='Deployed commit'
                            className={FIELD_INPUT_CLASS}
                            data-track-category={TRACK_CATEGORY}
                            data-track-name='RepoDeployedCommit'
                          />
                          <span className='text-[13px] text-muted-foreground'>→</span>
                          <Input
                            value={repo.range.newCommit}
                            onChange={event =>
                              onRangeChange(repo.id, 'newCommit', event.target.value)
                            }
                            placeholder='new'
                            aria-label='New commit'
                            className={FIELD_INPUT_CLASS}
                            data-track-category={TRACK_CATEGORY}
                            data-track-name='RepoNewCommit'
                          />
                        </div>
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {repos.length === 0 && (
          <div className='p-5 text-center text-[13px] text-muted-foreground'>
            No repositories post to this channel
          </div>
        )}
      </div>
    </div>
  );
}
