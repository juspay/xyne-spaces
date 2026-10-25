import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { PaintBucket, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog/Dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { cn } from '@/utils/classNames';
import { useClawAgentDetail } from '@/hooks/useClawAgentDetail';
import { useSelectedAgent } from '@/hooks/useSelectedAgent';
import { useDesignSystemActions, useDesignSystems } from '@/hooks/useDesignSystems';
import type { DesignSystemRecord } from '@/services/XyneAI/XyneAIDesignSystemsService';
import { SpecimenView } from './SpecimenView';
import { StarterGallery } from './StarterGallery';
import type { StarterSystem } from './starters';
import { formatCreatedAt, sourceLabel } from './designTokens';

const MAX_DESIGN_MD_CHARS = 32_000;

const TABS: readonly TabItem[] = [
  { id: 'specimen', label: 'Specimen' },
  { id: 'markdown', label: 'DESIGN.md' },
  { id: 'starters', label: 'Templates & starters' },
];

function Meta({ system }: { system: DesignSystemRecord }): ReactElement {
  const created = formatCreatedAt(system.createdAt);
  const origin = system.sourceUrl ?? system.sourceRepo;
  return (
    <div className='flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
      <span className='rounded-full bg-secondary px-2 py-0.5'>{sourceLabel(system.source)}</span>
      <span className='rounded-full bg-secondary px-2 py-0.5'>v{system.version}</span>
      {created && <span>{created}</span>}
      {origin && (
        <span className='truncate' title={origin}>
          {origin}
        </span>
      )}
    </div>
  );
}

function DesignMdEditor({ system }: { system: DesignSystemRecord }): ReactElement {
  const { update } = useDesignSystemActions();
  const [draft, setDraft] = useState(system.designMd);

  useEffect(() => {
    setDraft(system.designMd);
  }, [system.id, system.designMd]);

  const dirty = draft !== system.designMd;
  const overLimit = draft.length > MAX_DESIGN_MD_CHARS;

  const save = (): void => {
    update.mutate(
      { id: system.id, patch: { designMd: draft } },
      {
        onSuccess: () => toast.success('Design system saved'),
        onError: () => toast.error('Could not save the design system'),
      },
    );
  };

  return (
    <div className='pb-10'>
      <textarea
        value={draft}
        onChange={event => setDraft(event.target.value)}
        rows={20}
        spellCheck={false}
        aria-label='DESIGN.md'
        data-track-category='XyneAI'
        data-track-name='EDIT_DESIGN_SYSTEM_MD'
        className={cn(
          'w-full resize-y rounded-lg border bg-background px-3 py-2 font-mono text-xs text-foreground',
          'focus:outline-none focus:ring-1',
          overLimit ? 'border-destructive focus:ring-destructive' : 'border-border focus:ring-ring',
        )}
      />
      <div className='mt-2 flex items-center justify-between gap-3 text-xs'>
        <span className={overLimit ? 'font-medium text-destructive' : 'text-muted-foreground'}>
          {overLimit
            ? `${(draft.length - MAX_DESIGN_MD_CHARS).toLocaleString()} over the ${MAX_DESIGN_MD_CHARS.toLocaleString()} limit — the runtime drops a larger system`
            : `${draft.length.toLocaleString()} / ${MAX_DESIGN_MD_CHARS.toLocaleString()}`}
        </span>
        <Button
          size='sm'
          disabled={!dirty || overLimit || update.isPending}
          onClick={save}
          data-track-category='XyneAI'
          data-track-name='SAVE_DESIGN_SYSTEM_MD'
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }): ReactElement {
  return (
    <div className='flex min-h-0 flex-1 items-center justify-center px-6 pb-16 pt-16 text-center'>
      <div className='max-w-sm'>
        <PaintBucket className='mx-auto size-6 text-muted-foreground' aria-hidden />
        <p className='mt-3 text-sm text-muted-foreground'>{message}</p>
      </div>
    </div>
  );
}

export function DesignSystemsScreen(): ReactElement {
  const { systems, isLoading, isError } = useDesignSystems();
  const { create, remove, setDefault } = useDesignSystemActions();
  const { selectedAgentSlug } = useSelectedAgent();
  const { data: agent } = useClawAgentDetail(selectedAgentSlug ?? undefined);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState('specimen');
  const [deleteTarget, setDeleteTarget] = useState<DesignSystemRecord | null>(null);

  const active = useMemo(
    () => systems.find(system => system.id === activeId) ?? systems[0] ?? null,
    [systems, activeId],
  );

  const agentName = agent?.name ?? selectedAgentSlug;

  const onSetDefault = (): void => {
    if (!active || !selectedAgentSlug) return;
    setDefault.mutate(
      { agentSlug: selectedAgentSlug, designSystemId: active.id },
      {
        onSuccess: () => toast.success(`${active.name} is now the default for ${agentName}`),
        onError: () => toast.error('Could not set the default'),
      },
    );
  };

  const uniqueName = (base: string): string => {
    const taken = new Set(systems.map(system => system.name));
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base} ${suffix}`)) suffix += 1;
    return `${base} ${suffix}`;
  };

  const onUseStarter = (starter: StarterSystem): void => {
    create.mutate(
      {
        name: uniqueName(starter.name),
        designMd: starter.designMd,
        tokensCss: starter.tokensCss,
        source: 'library',
      },
      {
        onSuccess: created => {
          setActiveId(created.id);
          setTab('specimen');
          toast.success(`${created.name} added to your design systems`);
        },
        onError: () => toast.error('Could not add that starter'),
      },
    );
  };

  const onDelete = (): void => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    remove.mutate(target.id, {
      onSuccess: () => {
        toast.success(`${target.name} deleted`);
        if (activeId === target.id) setActiveId(null);
      },
      onError: () => toast.error('Could not delete the design system'),
    });
  };

  return (
    <div className='max-w-ai-content mx-auto flex h-full min-h-0 w-full flex-col px-6'>
      <div className='flex shrink-0 flex-col bg-background'>
        <div className='flex items-center gap-5 pt-5'>
          <div className='flex min-w-0 flex-1 flex-col justify-center gap-1'>
            <h1 className='text-2xl font-semibold leading-tight tracking-tight text-foreground'>
              Design systems
            </h1>
            <p className='text-sm leading-tight text-muted-foreground'>
              Palettes, type and scale a /design run is held to
            </p>
          </div>
          {tab !== 'starters' && systems.length > 0 && (
            <Select value={active?.id ?? ''} onValueChange={setActiveId}>
              <SelectTrigger
                className='w-auto max-w-[16rem] shrink-0 gap-2 focus-visible:border-ring focus-visible:ring-0'
                aria-label='Design system'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {systems.map(system => (
                  <SelectItem key={system.id} value={system.id}>
                    {system.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className='mt-4 flex flex-wrap items-center justify-between gap-3'>
          <Tabs
            items={TABS}
            activeId={tab}
            onSelect={setTab}
            trackCategory='XyneAI'
            trackPrefix='Design systems tab'
          />
          {active && tab !== 'starters' && (
            <div className='flex shrink-0 items-center gap-2'>
              {selectedAgentSlug && (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={setDefault.isPending}
                  onClick={onSetDefault}
                  data-track-category='XyneAI'
                  data-track-name='SET_AGENT_DEFAULT_DESIGN_SYSTEM'
                >
                  Set as default for {agentName}
                </Button>
              )}
              <Button
                size='sm'
                variant='ghost'
                disabled={remove.isPending}
                onClick={() => setDeleteTarget(active)}
                data-track-category='XyneAI'
                data-track-name='DELETE_DESIGN_SYSTEM'
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className='no-scrollbar relative min-h-0 flex-1 overflow-auto'>
        {tab === 'starters' ? (
          <StarterGallery onUse={onUseStarter} isUsing={create.isPending} />
        ) : isLoading ? (
          <EmptyState message='Loading design systems…' />
        ) : isError ? (
          <EmptyState message='Could not load design systems. Refresh to try again.' />
        ) : !active ? (
          <EmptyState message='No design systems yet. Start from a template, or extract one from a website or repository.' />
        ) : (
          <div className='pt-5'>
            <Meta system={active} />
            <div className='mt-5'>
              {tab === 'specimen' ? (
                <SpecimenView tokensCss={active.tokensCss} />
              ) : (
                <DesignMdEditor system={active} />
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}
        title='Delete design system?'
        description={
          deleteTarget
            ? `Delete "${deleteTarget.name}"? Chats pinned to it fall back to the agent default.`
            : undefined
        }
        className='max-w-[420px] p-0'
        testId='delete-design-system-dialog'
      >
        <div>
          <div className='flex items-start justify-between gap-3 px-5 py-4'>
            <h2 className='pr-2 text-base font-semibold leading-tight text-foreground'>
              Delete design system?
            </h2>
            <button
              type='button'
              onClick={() => setDeleteTarget(null)}
              className='shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              aria-label='Close'
              data-track-category='XyneAI'
              data-track-name='CLOSE_DELETE_DESIGN_SYSTEM_DIALOG'
            >
              <X className='size-4' aria-hidden />
            </button>
          </div>
          <p className='px-5 pb-5 text-sm leading-relaxed text-foreground'>
            <span className='font-semibold'>{deleteTarget?.name}</span> will be deleted. Chats
            pinned to it fall back to the agent default. This cannot be undone.
          </p>
          <div className='flex justify-end gap-2 px-5 pb-4'>
            <Button
              variant='outline'
              onClick={() => setDeleteTarget(null)}
              disabled={remove.isPending}
              data-track-category='XyneAI'
              data-track-name='CANCEL_DELETE_DESIGN_SYSTEM'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={onDelete}
              disabled={remove.isPending}
              data-track-category='XyneAI'
              data-track-name='CONFIRM_DELETE_DESIGN_SYSTEM'
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
