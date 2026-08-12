import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  FileText,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from '@/components/ClawAgents/digitalTwin/icons';
import { useBlocker, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import {
  useClawDigitalTwinMemoryFiles,
  useClawDigitalTwinPipelineEvents,
  useDeleteDigitalTwinMemoryFile,
  useSaveDigitalTwinMemoryFile,
  useSetDigitalTwinMemoryFileLoad,
  useSynthesizeDigitalTwin,
} from '@/hooks/useClawDigitalTwin';
import type { DigitalTwinMemoryFile } from '@/services/claw/digitalTwinTypes';
import { fmtRelative } from '@/components/ClawAgents/digitalTwin/format';

const FILE_DETAILS = new Map<string, { title: string; description: string }>([
  [
    'soul.md',
    { title: 'Voice & values', description: 'How you sound and the principles you stand by.' },
  ],
  [
    'people.md',
    { title: 'People', description: 'Who you work with and how those relationships fit together.' },
  ],
  [
    'projects.md',
    { title: 'Projects', description: 'Active work, responsibilities, and current context.' },
  ],
  [
    'playbook.md',
    { title: 'Working style', description: 'How you decide, collaborate, and get work done.' },
  ],
  [
    'expertise.md',
    { title: 'Expertise', description: 'Subjects you can speak about with authority.' },
  ],
]);

const fileDetail = (name: string): { title: string; description: string } =>
  FILE_DETAILS.get(name) ?? {
    title: name.replace(/\.md$/i, ''),
    description: 'A stable part of how your Twin represents you.',
  };

const DigitalTwinPersonaTab = (): ReactElement => {
  const navigate = useNavigate();
  const filesQuery = useClawDigitalTwinMemoryFiles();
  const saveMutation = useSaveDigitalTwinMemoryFile();
  const loadMutation = useSetDigitalTwinMemoryFileLoad();
  const deleteMutation = useDeleteDigitalTwinMemoryFile();
  const synthesize = useSynthesizeDigitalTwin();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DigitalTwinMemoryFile | null>(null);
  const [rebuildPolling, setRebuildPolling] = useState(false);
  const [rebuildStartedAt, setRebuildStartedAt] = useState<number | null>(null);
  const draftFileName = useRef<string | null>(null);
  const rebuildEvents = useClawDigitalTwinPipelineEvents(
    { limit: 10, runType: 'synthesize' },
    rebuildPolling,
  );

  const files = useMemo(() => filesQuery.data?.files ?? [], [filesQuery.data]);
  const maxLoaded = filesQuery.data?.maxLoaded ?? 3;
  const maxChars = filesQuery.data?.maxChars ?? 10_000;
  const refetchFiles = filesQuery.refetch;
  const selected = files.find(file => file.name === selectedName) ?? files[0] ?? null;
  const loadedCount = files.filter(file => file.loadInPrompt).length;
  const dirty = !!selected && draftFileName.current === selected.name && draft !== selected.content;
  const tooLong = draft.length > maxChars;
  const blocker = useBlocker(dirty);
  const currentRebuildEvent = useMemo(() => {
    if (rebuildStartedAt === null) return undefined;
    return rebuildEvents.data?.pages
      .flatMap(page => page.events)
      .find(event => Date.parse(event.createdAt) >= rebuildStartedAt - 2_000);
  }, [rebuildEvents.data, rebuildStartedAt]);

  useEffect((): void => {
    if (!selectedName && files[0]) setSelectedName(files[0].name);
  }, [files, selectedName]);

  useEffect((): void => {
    if (selected && draftFileName.current !== selected.name) {
      draftFileName.current = selected.name;
      setDraft(selected.content);
    }
  }, [selected]);

  useEffect((): (() => void) => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  useEffect((): (() => void) | undefined => {
    if (!rebuildPolling || rebuildStartedAt === null) return;
    if (
      currentRebuildEvent &&
      currentRebuildEvent.status !== 'running' &&
      currentRebuildEvent.status !== 'retry'
    ) {
      setRebuildPolling(false);
      void refetchFiles();
      if (currentRebuildEvent.status === 'error') {
        toast.error('Persona refresh failed. Open recent activity for details.');
      }
      return;
    }
    const remaining = Math.max(0, rebuildStartedAt + 120_000 - Date.now());
    const timeout = window.setTimeout((): void => {
      setRebuildPolling(false);
      void refetchFiles();
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [currentRebuildEvent, rebuildPolling, rebuildStartedAt, refetchFiles]);

  const selectFile = (name: string): void => {
    if (name === selected?.name) return;
    if (dirty) {
      setPendingSelection(name);
      return;
    }
    setSelectedName(name);
  };

  const save = (): void => {
    if (!selected || !dirty || tooLong) return;
    saveMutation.mutate({ name: selected.name, content: draft });
  };

  const rebuild = (): void => {
    const startedAt = Date.now();
    synthesize.mutate(undefined, {
      onSuccess: () => {
        setRebuildStartedAt(startedAt);
        setRebuildPolling(true);
      },
    });
  };

  if (filesQuery.isLoading) {
    return (
      <div className='grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]'>
        <Skeleton className='h-[520px]' />
        <Skeleton className='h-[520px]' />
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-5'>
      <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end'>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>How your Twin represents you</h2>
          <p className='mt-1 max-w-[70ch] text-sm text-muted-foreground'>
            Keep its voice, relationships, work, and expertise accurate. Choose up to {maxLoaded}{' '}
            sections to make available in every reply.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='secondary'>
            {loadedCount}/{maxLoaded} loaded
          </Badge>
          <Button
            variant='outline'
            size='sm'
            loading={synthesize.isPending}
            onClick={rebuild}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin refresh persona'
          >
            <Sparkles className='size-4' />
            Refresh suggestions
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              void navigate('/claw-agents/digital-twin/activity');
            }}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin view persona activity'
          >
            <Activity className='size-4' />
            Recent changes
          </Button>
        </div>
      </div>

      {filesQuery.isError && (
        <div role='alert' className='rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
          <p className='text-sm font-semibold text-destructive'>
            Your profile sections did not load.
          </p>
          <p className='mt-1 text-sm text-muted-foreground'>{filesQuery.error.message}</p>
          <Button
            variant='outline'
            size='sm'
            className='mt-3'
            onClick={() => void filesQuery.refetch()}
          >
            <RefreshCw className='size-4' />
            Try again
          </Button>
        </div>
      )}

      {rebuildPolling && (
        <div
          className='flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3'
          aria-live='polite'
        >
          <Sparkles className='size-5 text-primary' />
          <p className='min-w-0 flex-1 text-sm text-foreground'>
            Profile suggestions are refreshing in the background. Sections you edited by hand will
            stay unchanged.
          </p>
          <Button variant='ghost' size='sm' onClick={() => void filesQuery.refetch()}>
            Refresh now
          </Button>
        </div>
      )}

      {!filesQuery.isError && files.length === 0 ? (
        <div className='flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-8 py-12 text-center'>
          <FileText className='size-7 text-muted-foreground' />
          <h3 className='mt-4 text-base font-semibold text-foreground'>No profile sections yet</h3>
          <p className='mt-1 max-w-[58ch] text-sm text-muted-foreground'>
            Create suggested sections from your approved memories, then edit them in your own words.
          </p>
          <Button size='sm' className='mt-4' loading={synthesize.isPending} onClick={rebuild}>
            <Sparkles className='size-4' />
            Create profile
          </Button>
        </div>
      ) : (
        !filesQuery.isError && (
          <div className='dt-responsive-split grid min-h-[560px] grid-cols-[300px_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card'>
            <aside
              className='border-r border-border bg-muted/20 py-2'
              aria-label='Profile sections'
            >
              {files.map(file => {
                const active = file.name === selected?.name;
                const detail = fileDetail(file.name);
                return (
                  <button
                    key={file.name}
                    type='button'
                    onClick={() => selectFile(file.name)}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin select persona file'
                    className={
                      active
                        ? 'flex min-h-20 w-full items-start gap-3 border-l-2 border-primary bg-accent px-4 py-3 text-left'
                        : 'flex min-h-20 w-full items-start gap-3 border-l-2 border-transparent px-4 py-3 text-left transition-colors hover:bg-accent/60'
                    }
                    aria-current={active ? 'page' : undefined}
                  >
                    <FileText className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                    <span className='min-w-0'>
                      <span className='block text-sm font-medium text-foreground'>
                        {detail.title}
                      </span>
                      <span className='mt-1 block text-xs leading-5 text-muted-foreground'>
                        {detail.description}
                      </span>
                      <span className='mt-1 block text-xs text-muted-foreground'>{file.name}</span>
                    </span>
                  </button>
                );
              })}
            </aside>

            {selected && (
              <section className='flex min-w-0 flex-col'>
                <div className='flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4'>
                  <div>
                    <h3 className='text-base font-semibold text-foreground'>
                      {fileDetail(selected.name).title}
                    </h3>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      {fileDetail(selected.name).description} Updated{' '}
                      {fmtRelative(selected.updatedAt)}.
                    </p>
                  </div>
                  <div className='flex flex-wrap items-center gap-3'>
                    <div className='flex min-h-9 items-center gap-2'>
                      <Switch
                        id={`load-${selected.name}`}
                        checked={selected.loadInPrompt}
                        disabled={
                          loadMutation.isPending ||
                          (!selected.loadInPrompt && loadedCount >= maxLoaded)
                        }
                        onCheckedChange={load => loadMutation.mutate({ file: selected, load })}
                        aria-label={`Use ${fileDetail(selected.name).title} in every reply`}
                      />
                      <label
                        htmlFor={`load-${selected.name}`}
                        className='cursor-pointer text-xs font-medium text-foreground'
                      >
                        Use in every reply
                      </label>
                    </div>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:bg-destructive/10 hover:text-destructive'
                      onClick={() => setPendingDelete(selected)}
                    >
                      <Trash2 className='size-4' />
                      Delete section
                    </Button>
                    <Button
                      size='sm'
                      loading={saveMutation.isPending}
                      disabled={!dirty || tooLong}
                      onClick={save}
                    >
                      <Save className='size-4' />
                      Save changes
                    </Button>
                  </div>
                </div>

                {!selected.loadInPrompt && loadedCount >= maxLoaded && (
                  <p className='border-b border-amber-500/25 bg-amber-500/10 px-5 py-3 text-xs text-foreground'>
                    All {maxLoaded} reply slots are in use. Turn off another section before using
                    this one in replies.
                  </p>
                )}
                <label className='flex min-h-0 flex-1 flex-col'>
                  <span className='px-6 pt-5 text-xs font-medium text-foreground'>
                    What your Twin should know
                  </span>
                  <textarea
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    spellCheck
                    className='min-h-[400px] flex-1 resize-y bg-background px-6 py-4 text-sm leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/20'
                    placeholder='Write the guidance your Twin should carry…'
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin edit persona file'
                  />
                </label>
                <div className='flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs'>
                  <p className={tooLong ? 'text-destructive' : 'text-muted-foreground'}>
                    {tooLong
                      ? `Remove ${(draft.length - maxChars).toLocaleString()} characters before saving.`
                      : dirty
                        ? 'Unsaved changes'
                        : 'All changes saved'}
                  </p>
                  <span
                    className={
                      tooLong
                        ? 'tabular-nums text-destructive'
                        : 'tabular-nums text-muted-foreground'
                    }
                  >
                    {draft.length.toLocaleString()} / {maxChars.toLocaleString()}
                  </span>
                </div>
              </section>
            )}
          </div>
        )
      )}

      <ConfirmDialog
        surface='digital-twin'
        open={pendingSelection !== null}
        onOpenChange={open => {
          if (!open) setPendingSelection(null);
        }}
        title='Discard unsaved changes?'
        description={`Your edits to ${selected ? fileDetail(selected.name).title : 'this section'} have not been saved.`}
        confirmLabel='Discard and switch'
        danger
        onConfirm={() => {
          setSelectedName(pendingSelection);
          setPendingSelection(null);
        }}
      />

      <ConfirmDialog
        surface='digital-twin'
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete ? fileDetail(pendingDelete.name).title : 'this section'}?`}
        description='This removes the section. Refreshing suggestions may create it again from approved memories.'
        confirmLabel='Delete section'
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMutation.mutate(
            { name: pendingDelete.name },
            {
              onSuccess: () => {
                setSelectedName(null);
                setPendingDelete(null);
              },
            },
          );
        }}
      />

      <ConfirmDialog
        surface='digital-twin'
        open={blocker.state === 'blocked'}
        onOpenChange={open => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        title='Leave without saving?'
        description='Your changes to this profile section have not been saved.'
        confirmLabel='Discard and leave'
        danger
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
    </div>
  );
};

export default DigitalTwinPersonaTab;
