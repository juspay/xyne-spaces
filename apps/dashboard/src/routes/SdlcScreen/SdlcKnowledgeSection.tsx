import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Ellipsis,
  Link2,
  Info,
  Lock,
  PenLine,
  Plus,
  Search,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type { SdlcHubKnowledgeLinks, SdlcHubPin } from '@xyne/shared';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { Tooltip } from '../../components/ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import Input from '../../components/ui/Input';
import { SegmentedToggle } from '../../components/ui/SegmentedToggle/SegmentedToggle';
import Textarea from '../../components/ui/Textarea';
import { useAuth } from '../../hooks/useAuth';
import { useClawSkills } from '../../hooks/useClawSkills';
import { ClawApiError } from '../../services/claw/clawRequest';
import { submitSkillRequest } from '../../services/claw/clawSkillsService';
import { apiInstance } from '../../services/clients/apiClient';
import { cn } from '../../utils/classNames';
import ClawSkillCreateV2 from '../AIScreen/library/skills/create/ClawSkillCreateV2';
import { LibraryFilterMenu } from '../AIScreen/library/shared/components/LibraryFilterMenu';
import ClawSkillDetailV2 from '../AIScreen/library/skills/detail/ClawSkillDetailV2';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { AddSkillList, SkeletonRows } from './AddSkillList';
import { SdlcArchiveMenu } from './SdlcArchiveMenu';

export interface KnowledgeFile {
  id: string;
  title: string;
  status: 'ready' | 'generating' | 'archived';
}

function ArchivedPill(): ReactElement {
  return (
    <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
      Archived
    </span>
  );
}

// One column set for the header and every row in both groups, so they line up. Narrow, Type
// moves under the name and the controls share the last column.
const rowCols =
  'grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-5 md:grid-cols-[minmax(0,1fr)_8rem_12rem_2rem]';
const menuSlot = 'flex w-8 shrink-0 justify-end';
// The read mode and the menu: one cell each from md up, one group a fixed gap apart below it.
const trailing = 'flex items-center justify-end gap-2 md:contents';
const cellText = 'hidden truncate text-xs text-muted-foreground md:block';
const iconButton =
  'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** A click on a row's read mode control, which must not also open the row. */
const onReadMode = (event: MouseEvent): boolean =>
  event.target instanceof Element &&
  event.target.closest('[data-slot="segmented-toggle"]') !== null;

const applyPin = (links: SdlcHubKnowledgeLinks, pin: SdlcHubPin): SdlcHubKnowledgeLinks =>
  pin.targetType === 'CANVAS'
    ? {
        ...links,
        pinnedCanvasIds: [
          ...links.pinnedCanvasIds.filter(id => id !== pin.targetId),
          ...(pin.pinned ? [pin.targetId] : []),
        ],
      }
    : {
        ...links,
        skills: links.skills.map(link =>
          link.skillId === pin.targetId ? { ...link, pinnedForHub: pin.pinned } : link,
        ),
      };

// As SdlcFileList's: the app's tooltip, never the browser's title.
const TOOLTIP_DELAY_MS = 600;

const chipClass =
  'shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground';

/** A knowledge file's or skill's read mode; `onChange` unset shows it read-only. */
// Each item's last shown read mode. A flip moves the row to the other group, which remounts its
// control, so the new one slides from here instead of appearing in place.
const lastReadMode = new Map<string, boolean>();

function ReadMode(props: {
  id: string;
  always: boolean;
  onChange?: (always: boolean) => void;
}): ReactElement {
  const { id, always, onChange } = props;
  const [before] = useState(() => lastReadMode.get(id));
  useEffect(() => {
    lastReadMode.set(id, always);
  }, [id, always]);
  if (!onChange) {
    return (
      <Tooltip content='Only hub admins can change this' delayDuration={TOOLTIP_DELAY_MS}>
        <span
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- its tooltip must open from the keyboard
          tabIndex={0}
          className='rounded px-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        >
          {props.always ? 'Always read' : 'When relevant'}
        </span>
      </Tooltip>
    );
  }
  return (
    <SegmentedToggle<'always' | 'relevant'>
      // As tall as the row's menu button, so the trailing controls share one line.
      className='h-8 [&>button]:text-xs'
      options={[
        { value: 'always', label: 'Always read' },
        { value: 'relevant', label: 'When relevant' },
      ]}
      value={props.always ? 'always' : 'relevant'}
      {...(before !== undefined &&
        before !== always && { animateFrom: before ? 'always' : 'relevant' })}
      onChange={value => {
        if ((value === 'always') !== props.always) onChange(value === 'always');
      }}
      tone='primary'
      trackCategory='SdlcHub'
      trackPrefix='HubKnowledgeReadMode'
    />
  );
}

/** Cmd/Ctrl+Enter in a textarea submits its form; plain Enter stays a new line. */
function submitOnModEnter(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

/** The one shell for this page's dialogs: one title and line, the body, then Cancel and the primary. */
function HubDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Makes the dialog a form: Enter in a field submits it. */
  onSubmit?: () => void;
  /** Stays put above the scrolling body, e.g. tabs. */
  fixed?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Wider for a list whose rows carry a description. */
  wide?: boolean;
  children?: ReactNode;
}): ReactElement {
  const body = (
    <>
      <div className='flex items-start gap-3 px-6 pb-4 pt-6'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-lg font-semibold'>{props.title}</h2>
          <p className='mt-1 text-sm text-muted-foreground'>{props.description}</p>
        </div>
        <Tooltip content='Close' delayDuration={TOOLTIP_DELAY_MS}>
          <button
            type='button'
            aria-label='Close'
            onClick={() => props.onOpenChange(false)}
            data-track-category='SdlcHub'
            data-track-name='HubKnowledgeDialogClosed'
            className='grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          >
            <X size={15} />
          </button>
        </Tooltip>
      </div>
      {props.fixed && <div className='px-6 pb-4'>{props.fixed}</div>}
      {props.children && (
        <div className='flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6'>{props.children}</div>
      )}
      {props.footer && <div className='flex justify-end gap-2 px-6 pb-6'>{props.footer}</div>}
    </>
  );
  const shell = cn('flex max-h-[85vh] flex-col', props.className);
  const { onSubmit } = props;
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      description={props.description}
      className={props.wide ? 'max-w-2xl' : 'max-w-xl'}
    >
      {onSubmit ? (
        <form
          noValidate
          className={shell}
          onSubmit={event => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {body}
        </form>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </Dialog>
  );
}

/** Radio options with their one line showing, for a choice that needs explaining. */
function ChoiceList<T extends string>(props: {
  name: string;
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  autoFocus?: boolean;
}): ReactElement {
  return (
    <div role='radiogroup' className='flex flex-col gap-2'>
      {props.options.map(option => (
        <label
          key={option.value}
          htmlFor={`${props.name}-${option.value}`}
          aria-label={option.label}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
            props.value === option.value && 'border-primary bg-primary/5',
          )}
        >
          <input
            id={`${props.name}-${option.value}`}
            type='radio'
            name={props.name}
            value={option.value}
            checked={props.value === option.value}
            autoFocus={props.autoFocus && props.value === option.value}
            onChange={() => props.onChange(option.value)}
            className='mt-1 accent-primary'
            data-track-category='SdlcHub'
            data-track-name={`${props.name}: ${option.label}`}
          />
          <span>
            <span className='block text-sm font-medium'>{option.label}</span>
            <span className='block text-sm text-muted-foreground'>{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

const TYPE_HINT = {
  file: "Knowledge file: Facts and knowledge about this hub's repositories (like an AGENTS.md or CLAUDE.md file).",
  skill: 'Skill: Steps that work in any hub.',
};
const MODE_HINT = {
  always: 'Always read: every run in this hub starts with it in full.',
  relevant: 'When relevant: agents see its name and open it when a request needs it.',
};

/** A visible ⓘ whose app tooltip lists `lines`; a button, so it opens from the keyboard too. */
function InfoHint({ about, lines }: { about: string; lines: string[] }): ReactElement {
  return (
    <Tooltip
      delayDuration={TOOLTIP_DELAY_MS}
      className='max-w-xs text-xs'
      content={
        <div className='flex flex-col gap-1'>
          {lines.map(line => (
            <span key={line}>{line}</span>
          ))}
        </div>
      }
    >
      <button
        type='button'
        aria-label={`About ${about}`}
        className='inline-grid size-4 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        <Info className='size-3.5' aria-hidden />
      </button>
    </Tooltip>
  );
}

export interface HubKnowledgeAiDraft {
  name: string;
  description: string;
  /** `auto` leaves the choice between a knowledge file and a skill to the agent. */
  kind: 'auto' | 'file' | 'skill';
}

// No skill has this slug: slugs are lower case with dashes.
const NEW_SKILL = 'NEW';

const EMPTY_AI_DRAFT: HubKnowledgeAiDraft = { name: '', description: '', kind: 'auto' };

/** Skills page: the hub's knowledge files and linked skills, and which of them every run reads in full. */
export function SdlcKnowledgeSection(props: {
  channelId: string;
  files: KnowledgeFile[];
  /** False until the file list has arrived. */
  filesLoaded: boolean;
  isHubAdmin: boolean;
  showArchived: boolean;
  onShowArchivedChange: (show: boolean) => void;
  onOpenFile: (canvasId: string) => void;
  onArchiveFile: (canvasId: string, archived: boolean) => void;
  onNewFile: () => void;
  onCreateWithAi: (draft: HubKnowledgeAiDraft) => void;
  /** Status and start button of the workflow that generates knowledge files. */
  generateControl: ReactNode;
  /** The hub's name, for the count under the list. */
  channelName: string;
}): ReactElement {
  const { channelId, isHubAdmin } = props;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  const [writeKind, setWriteKind] = useState<'doc' | 'skill'>('doc');
  // Kept when the dialog is dismissed by Escape or a click outside, so typed text is not lost.
  const [aiDraft, setAiDraft] = useState<HubKnowledgeAiDraft | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTried, setAiTried] = useState(false);
  const closeAiDialog = (): void => {
    setAiOpen(false);
    setAiDraft(null);
    setAiTried(false);
  };
  // One confirmation for every request to make a skill global: from the row menu or on add.
  const [approval, setApproval] = useState<{
    name: string;
    send: () => Promise<void>;
    cancel?: () => void;
  } | null>(null);
  const [sharing, setSharing] = useState(false);
  const closeApproval = (): void => {
    approval?.cancel?.();
    setApproval(null);
  };
  // Which skill screen stands in for this page: in the URL, so the browser's Back returns to the list.
  const [searchParams, setSearchParams] = useSearchParams();
  const skillParam = searchParams.get('skill');
  const showSkill = (value: string | null): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('skill', value);
    else next.delete('skill');
    // Closing replaces the entry, or the browser's Back would open the screen again.
    setSearchParams(next, { replace: !value });
  };
  const [kind, setKind] = useState<'all' | 'file' | 'skill'>('all');
  const [query, setQuery] = useState('');

  const base = `/sdlc/channels/${encodeURIComponent(channelId)}/knowledge`;
  const linksKey = ['sdlc-hub-knowledge', channelId];
  const links = useQuery({
    queryKey: linksKey,
    queryFn: async () => (await apiInstance.get<SdlcHubKnowledgeLinks>(base)).data,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const skills = useClawSkills();
  const skillCatalog = skills.data;
  // Until both load, an empty list would read as "nothing linked, nothing pinned".
  const ready = Boolean(links.data && skillCatalog);
  const failed = links.isError || skills.isError;

  const change = async (
    request: () => Promise<unknown>,
    failure: string | ((error: unknown) => string),
    done?: { message: string; description?: string; undo?: () => void },
  ): Promise<void> => {
    try {
      await request();
      if (done) {
        toast.success(done.message, {
          className: 'hub-inline-action',
          ...(done.description && { description: done.description }),
          ...(done.undo && { action: { label: 'Undo', onClick: done.undo } }),
        });
      }
    } catch (error) {
      toast.error(typeof failure === 'string' ? failure : failure(error));
    }
    // The catalog too: a link whose skill is missing from a stale catalog reads as removed.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: linksKey }),
      queryClient.invalidateQueries({ queryKey: ['claw-skills'] }),
    ]);
  };
  const orderAtLoad = useRef<{ channelId: string; seen: Set<string>; pinned: Set<string> } | null>(
    null,
  );
  // One queue per hub, so the last click is the last PUT. The links are refetched only once the
  // queue drains, so no earlier answer overwrites a later click; a failure reverts through it.
  const pinKey = ['sdlc-hub-pin', channelId];
  const pinMutation = useMutation({
    mutationKey: pinKey,
    scope: { id: pinKey.join(':') },
    mutationFn: (pin: SdlcHubPin) => apiInstance.put(`${base}/pins`, pin),
    onMutate: async pin => {
      await queryClient.cancelQueries({ queryKey: linksKey });
      queryClient.setQueryData<SdlcHubKnowledgeLinks>(linksKey, old => old && applyPin(old, pin));
    },
    onError: () =>
      toast.error('Could not change the read mode. It is back to what it was; try again.', {
        id: 'hub-read-mode-failed',
      }),
    onSettled: () =>
      queryClient.isMutating({ mutationKey: pinKey }) === 1
        ? queryClient.invalidateQueries({ queryKey: linksKey })
        : undefined,
  });
  const setPin = (pin: SdlcHubPin): void => pinMutation.mutate(pin);

  const linked = links.data?.skills ?? [];
  const pinnedCanvasIds = new Set(links.data?.pinnedCanvasIds ?? []);
  const linkedIds = new Set(linked.map(link => link.skillId));
  const skillById = new Map((skillCatalog ?? []).map(skill => [skill.id, skill]));
  const skillRows = (skillCatalog ? linked : [])
    .flatMap(link => {
      const skill = skillById.get(link.skillId);
      // Someone else's personal skill, or one deleted since: only its linker has a row to clean up.
      if (!skill && link.linkedBy !== userId) return [];
      // A skill awaiting a claw admin's approval reaches no run; only hub admins see it listed.
      if (!isHubAdmin && skill?.scope !== 'global') return [];
      return [
        {
          ...link,
          skill,
          pending: skill?.scope === 'personal',
        },
      ];
    })
    // Usable skills first, then the ones awaiting approval. The sort is stable.
    .sort((a, b) => Number(a.pending) - Number(b.pending));
  const needle = query.trim().toLowerCase();
  const shows = (type: 'file' | 'skill', text: string): boolean =>
    (kind === 'all' || kind === type) && text.toLowerCase().includes(needle);
  const files = props.files.filter(file => shows('file', file.title));
  const shownSkills = skillRows.filter(row =>
    shows('skill', `${row.skill?.name ?? ''} ${row.skill?.slug ?? ''}`),
  );
  // An archived file's pin is not in effect.
  const filePinned = (file: KnowledgeFile): boolean =>
    file.status === 'ready' && pinnedCanvasIds.has(file.id);
  const skillPinned = (row: (typeof skillRows)[number]): boolean => row.pinnedForHub;
  const loading = !props.filesLoaded || (!ready && !failed);
  // A failed load says nothing about "none": no empty state, no count.
  const empty = !loading && !failed && props.files.length + skillRows.length === 0;
  // A fast load shows nothing until the final state; only a slow one gets placeholders.
  const showSkeleton = useDebouncedValue(loading, 300) && loading;

  /** `alwaysRead` is the skill's read mode, kept so undoing an unlink can put it back. */
  const linkSkill = (skillId: string, name: string, alwaysRead?: boolean): void => {
    void change(
      async () => {
        await apiInstance.post(`${base}/skills`, { skillId });
        // Unlinking deleted the pin with the link.
        if (alwaysRead) {
          const pin: SdlcHubPin = {
            targetType: 'SKILL',
            targetId: skillId,
            scope: 'hub',
            pinned: true,
          };
          await apiInstance.put(`${base}/pins`, pin);
        }
      },
      'Could not link the skill. Try again.',
      {
        message: `"${name}" linked to this hub`,
        undo: () => unlinkSkill(skillId, name, alwaysRead),
      },
    );
  };
  const unlinkSkill = (skillId: string, name: string, alwaysRead?: boolean): void =>
    void change(
      () => apiInstance.delete(`${base}/skills/${encodeURIComponent(skillId)}`),
      error =>
        isAxiosError(error) && error.response?.status === 403
          ? 'Only the member who linked it or a hub admin can unlink.'
          : 'Could not unlink the skill. Try again.',
      {
        message: `"${name}" unlinked from this hub`,
        // Only a hub admin can link it again.
        ...(isHubAdmin && { undo: () => linkSkill(skillId, name, alwaysRead) }),
      },
    );
  /** Never throws: every answer is said in a toast. */
  const requestGlobal = async (slug: string): Promise<void> => {
    if (!userId) return;
    try {
      await submitSkillRequest(slug, userId);
      toast.success('Sent to an admin for approval.');
    } catch (error) {
      const status = error instanceof ClawApiError ? error.status : 0;
      if (status === 400) toast.info('This skill is already available to everyone.');
      else if (status === 409) toast.info('A request is already waiting for an admin.');
      else toast.error('Could not send the request. Try again.');
      // Either answer means the cached skill list is behind.
      await queryClient.invalidateQueries({ queryKey: ['claw-skills'] });
    }
  };

  const openCreateWithAi = (): void => {
    setAiDraft(draft => draft ?? { ...EMPTY_AI_DRAFT, kind: isHubAdmin ? 'auto' : 'skill' });
    setAiOpen(true);
  };
  const openPicker = (): void => setPickerOpen(true);
  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          className='h-10'
          data-track-category='SdlcHub'
          data-track-name='HubKnowledgeAddOpened'
        >
          <Plus size={15} />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-64 rounded-xl p-1.5 shadow-sm'>
        <DropdownMenuItem
          onClick={openCreateWithAi}
          data-track-category='SdlcHub'
          data-track-name='HubKnowledgeCreateWithAi'
        >
          <Sparkles size={15} />
          Create with AI
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setWriteKind(isHubAdmin ? 'doc' : 'skill');
            setWriteOpen(true);
          }}
          data-track-category='SdlcHub'
          data-track-name='HubKnowledgeWriteOpened'
        >
          <PenLine size={15} />
          Write it yourself
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={openPicker}
          data-track-category='SdlcHub'
          data-track-name='HubKnowledgeSkillPickerOpened'
        >
          <Link2 size={15} />
          Add existing skill
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const rowClass = cn(
    'grid cursor-pointer py-2.5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    rowCols,
  );
  const meta = (type: string): ReactElement => (
    <p className='truncate text-xs text-muted-foreground md:hidden'>{type}</p>
  );

  const fileRow = (file: KnowledgeFile): ReactElement => (
    <div
      key={file.id}
      role='button'
      tabIndex={0}
      onClick={event => {
        if (!onReadMode(event)) props.onOpenFile(file.id);
      }}
      onKeyDown={event => {
        // The pin and the archive menu live inside this row.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          props.onOpenFile(file.id);
        }
      }}
      data-track-category='SdlcHub'
      data-track-name='HubKnowledgeCanvasOpened'
      data-track-metadata={JSON.stringify({ canvasId: file.id })}
      className={cn(rowClass, file.status !== 'ready' && 'opacity-60')}
    >
      <div className='flex min-w-0 items-center gap-3'>
        <BookOpen size={16} className='shrink-0 text-muted-foreground' aria-hidden />
        <div className='min-w-0'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate font-medium' title={file.title}>
              {file.title}
            </span>
            {file.status === 'archived' && <ArchivedPill />}
            {file.status === 'archived' && pinnedCanvasIds.has(file.id) && (
              <span className='truncate text-xs text-muted-foreground'>
                Always read again on restore
              </span>
            )}
          </div>
          {meta('Knowledge file')}
        </div>
      </div>
      <Tooltip content={TYPE_HINT.file} delayDuration={TOOLTIP_DELAY_MS}>
        <span className={cellText}>Knowledge file</span>
      </Tooltip>
      {file.status === 'generating' ? (
        // The run owns the file until it is written, so the row says so in place of its controls.
        <span className='text-xs text-muted-foreground md:col-span-2'>
          Being written. Read mode and archive come after.
        </span>
      ) : (
        <span className={trailing}>
          <span className='flex'>
            {links.data && file.status === 'ready' && (
              <ReadMode
                id={`CANVAS:${file.id}`}
                always={pinnedCanvasIds.has(file.id)}
                {...(isHubAdmin && {
                  onChange: (always: boolean) =>
                    setPin({
                      targetType: 'CANVAS',
                      targetId: file.id,
                      scope: 'hub',
                      pinned: always,
                    }),
                })}
              />
            )}
          </span>
          <span className={menuSlot}>
            {isHubAdmin && (
              <SdlcArchiveMenu
                title={file.title}
                archived={file.status === 'archived'}
                trackingScope='HubKnowledge'
                onToggle={next => props.onArchiveFile(file.id, next)}
              />
            )}
          </span>
        </span>
      )}
    </div>
  );

  const skillRow = (row: (typeof skillRows)[number]): ReactElement => {
    const { skillId, linkedBy, pinnedForHub, skill, pending } = row;
    const canUnlink = isHubAdmin || linkedBy === userId;
    const skillName = skill?.name || skill?.slug || 'Removed skill';
    const open = skill ? (): void => showSkill(skill.slug) : undefined;
    return (
      <div
        key={skillId}
        role={open && 'button'}
        tabIndex={open && 0}
        onClick={event => {
          if (open && !onReadMode(event)) open();
        }}
        onKeyDown={event => {
          // The pin and the menu live inside this row.
          if (!open || event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        }}
        data-track-category='SdlcHub'
        data-track-name='HubKnowledgeSkillOpened'
        className={open ? rowClass : cn('grid py-2.5 opacity-60', rowCols)}
      >
        <div className='flex min-w-0 items-center gap-3'>
          <Wrench size={16} className='shrink-0 text-muted-foreground' aria-hidden />
          <div className='min-w-0'>
            <div className='flex min-w-0 items-center gap-2'>
              {skill ? (
                <>
                  <span className='truncate font-medium' title={skill.description || skillName}>
                    {skillName}
                  </span>
                  {pending && (
                    <Tooltip
                      content='A claw admin must approve it before agents in this hub can use it.'
                      delayDuration={TOOLTIP_DELAY_MS}
                    >
                      <span
                        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- its tooltip must open from the keyboard
                        tabIndex={0}
                        className={cn(
                          chipClass,
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        )}
                      >
                        Pending approval
                      </span>
                    </Tooltip>
                  )}
                </>
              ) : (
                <>
                  <span className={chipClass}>Skill removed</span>
                  <span className='truncate text-xs text-muted-foreground'>
                    Deleted from the library. Agents no longer receive it.
                  </span>
                </>
              )}
            </div>
            {meta('Skill')}
          </div>
        </div>
        <Tooltip content={TYPE_HINT.skill} delayDuration={TOOLTIP_DELAY_MS}>
          <span className={cellText}>Skill</span>
        </Tooltip>
        <span className={trailing}>
          <span className='flex'>
            {skill && (
              <ReadMode
                id={`SKILL:${skillId}`}
                always={pinnedForHub}
                {...(isHubAdmin && {
                  onChange: (always: boolean) =>
                    setPin({
                      targetType: 'SKILL',
                      targetId: skillId,
                      scope: 'hub',
                      pinned: always,
                    }),
                })}
              />
            )}
          </span>
          <span className={menuSlot}>
            {/* No menu when nothing in it applies to the viewer. */}
            {((skill && pending && isHubAdmin) || canUnlink) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    aria-label={`More for ${skill?.name || skill?.slug || 'removed skill'}`}
                    onClick={event => event.stopPropagation()}
                    data-track-category='SdlcHub'
                    data-track-name='HubKnowledgeSkillMenuOpened'
                    className={iconButton}
                  >
                    <Ellipsis size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  sideOffset={6}
                  onClick={event => event.stopPropagation()}
                >
                  {skill && pending && isHubAdmin && (
                    // Sent on add; this sends it again, e.g. after a rejection.
                    <DropdownMenuItem
                      onClick={() =>
                        setApproval({ name: skillName, send: () => requestGlobal(skill.slug) })
                      }
                      data-track-category='SdlcHub'
                      data-track-name='HubKnowledgeSkillShareOpened'
                    >
                      Send for approval
                    </DropdownMenuItem>
                  )}
                  {canUnlink && (
                    <DropdownMenuItem
                      onClick={() => unlinkSkill(skillId, skillName, pinnedForHub)}
                      data-track-category='SdlcHub'
                      data-track-name='HubKnowledgeSkillUnlinked'
                    >
                      Unlink
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        </span>
      </div>
    );
  };

  // One list: Always read first, files first within each.
  const columns = (
    <div key='columns' className={cn('hidden py-2 text-xs text-muted-foreground md:grid', rowCols)}>
      <span>Name</span>
      <span className='flex items-center gap-1'>
        Type
        <InfoHint about='Type' lines={[TYPE_HINT.file, TYPE_HINT.skill]} />
      </span>
      <span className='flex items-center gap-1'>
        Read mode
        <InfoHint about='Read mode' lines={[MODE_HINT.always, MODE_HINT.relevant]} />
      </span>
      <span />
    </div>
  );
  // Grouped by the read modes this visit loaded with, so a toggle leaves its row in place; the
  // next visit regroups. The section stays mounted across a hub switch, so a new hub starts over.
  if (orderAtLoad.current?.channelId !== channelId) orderAtLoad.current = null;
  if (!orderAtLoad.current && !loading && links.data) {
    orderAtLoad.current = {
      channelId,
      seen: new Set([
        ...props.files.map(file => `CANVAS:${file.id}`),
        ...links.data.skills.map(link => `SKILL:${link.skillId}`),
      ]),
      pinned: new Set([
        ...links.data.pinnedCanvasIds.map(id => `CANVAS:${id}`),
        ...links.data.skills.filter(link => link.pinnedForHub).map(link => `SKILL:${link.skillId}`),
      ]),
    };
  }
  // Added since the load: placed by its live read mode.
  const placedPinned = (key: string, live: boolean): boolean =>
    orderAtLoad.current?.seen.has(key) ? orderAtLoad.current.pinned.has(key) : live;
  const group = (pinned: boolean): ReactElement[] => [
    ...files
      .filter(
        file =>
          (file.status === 'ready' && placedPinned(`CANVAS:${file.id}`, filePinned(file))) ===
          pinned,
      )
      .map(fileRow),
    ...shownSkills
      .filter(row => placedPinned(`SKILL:${row.skillId}`, skillPinned(row)) === pinned)
      .map(skillRow),
  ];
  const pinnedRows = group(true);
  const otherRows = group(false);

  // A skill's form or page takes this page's place, inside the hub, and hands it back when closed.
  if (skillParam === NEW_SKILL) {
    return (
      <ClawSkillCreateV2 hub={{ channelId, backLabel: 'Skills', onClose: () => showSkill(null) }} />
    );
  }
  if (skillParam) {
    return <ClawSkillDetailV2 hub={{ slug: skillParam, onClose: () => showSkill(null) }} />;
  }

  const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`;

  // Laid out as Environments is: heading, sticky toolbar, then the list. All three hold their place
  // while loading, empty or full.
  return (
    <>
      <div className='flex min-h-full flex-col'>
        {/* The page's actions sit with its heading; narrow, they wrap under it, right-aligned. */}
        <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6'>
          <div className='min-w-0 flex-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Skills</h1>
            <p className='mt-1.5 text-sm leading-6 text-muted-foreground'>
              What agents in this hub read.
            </p>
          </div>
          <div className='flex shrink-0 items-center justify-end gap-3'>
            {props.generateControl}
            {isHubAdmin && addMenu}
          </div>
        </div>

        <div className='sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 bg-background px-1 pb-4 pt-5'>
          <div className='relative min-w-64 flex-1'>
            <Search className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder='Search knowledge files and skills'
              aria-label='Search knowledge files and skills'
              className='h-10 pl-9'
              data-track-category='SdlcHub'
              data-track-name='HubKnowledgeSearched'
            />
          </div>
          <LibraryFilterMenu
            title='Type'
            options={[
              { id: 'all', label: 'All items' },
              { id: 'file', label: 'Knowledge files' },
              { id: 'skill', label: 'Skills' },
            ]}
            activeId={kind === 'all' ? null : kind}
            onSelect={id => setKind(id === 'file' || id === 'skill' ? id : 'all')}
            trackName='Filter agent context by type'
            extraGroups={[
              {
                title: 'Status',
                options: [
                  { id: 'all', label: 'Active' },
                  { id: 'archived', label: 'Include archived' },
                ],
                activeId: props.showArchived ? 'archived' : null,
                onSelect: id => props.onShowArchivedChange(id === 'archived'),
              },
            ]}
          />
        </div>

        <div className='flex flex-1 flex-col gap-5'>
          {!isHubAdmin && (
            <p className='flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground'>
              <Lock size={13} className='shrink-0' />
              Only hub admins can add knowledge files and skills.
            </p>
          )}
          {failed && (
            <p className='text-sm text-destructive'>
              Could not load read modes and skills. Reload to try again.
            </p>
          )}
          {/* Without the links nothing is known about read modes: no group may say "none". */}
          {(links.data || !failed) &&
            (loading ? (
              showSkeleton && <SkeletonRows />
            ) : empty ? (
              <div className='rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground'>
                No knowledge files or skills yet.
                <p className='mt-1 text-xs'>
                  {isHubAdmin
                    ? "Generate knowledge files from this hub's repositories, or add a skill."
                    : 'A hub admin can generate knowledge files or add skills.'}
                </p>
              </div>
            ) : pinnedRows.length + otherRows.length === 0 ? (
              !failed && (
                <div className='rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground'>
                  No knowledge files or skills match.
                </div>
              )
            ) : (
              <div className='rounded-xl border bg-background'>
                <div className='divide-y'>
                  {columns}
                  {pinnedRows}
                  {otherRows}
                </div>
              </div>
            ))}
          {!loading && !failed && (
            <p className='pt-1 text-xs text-muted-foreground'>
              {plural(files.length, 'knowledge file')} and {plural(shownSkills.length, 'skill')} in{' '}
              {props.channelName}
            </p>
          )}
        </div>

        <HubDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          title='Create with AI'
          description={
            isHubAdmin
              ? 'Ask AI writes it and shows you a card to approve before anything is saved.'
              : 'Ask AI writes a skill and shows you a card to approve. Only hub admins can add knowledge files.'
          }
          onSubmit={() => {
            if (!aiDraft) return;
            if (!aiDraft.name.trim() || !aiDraft.description.trim()) {
              setAiTried(true);
              return;
            }
            props.onCreateWithAi({
              ...aiDraft,
              name: aiDraft.name.trim(),
              description: aiDraft.description.trim(),
            });
            closeAiDialog();
          }}
          footer={
            <>
              <Button
                type='button'
                variant='outline'
                onClick={closeAiDialog}
                data-track-category='SdlcHub'
                data-track-name='HubKnowledgeCreateWithAiCancelled'
              >
                Cancel
              </Button>
              <Button
                type='submit'
                data-track-category='SdlcHub'
                data-track-name='HubKnowledgeCreateWithAi'
              >
                <Sparkles />
                Create
              </Button>
            </>
          }
        >
          {aiDraft && (
            <div className='flex flex-col gap-4'>
              <div className='flex flex-col gap-1.5'>
                <label htmlFor='hub-knowledge-ai-name' className='text-sm font-medium'>
                  Name
                </label>
                <Input
                  id='hub-knowledge-ai-name'
                  autoFocus
                  value={aiDraft.name}
                  onChange={event => setAiDraft({ ...aiDraft, name: event.target.value })}
                  className='h-9'
                  placeholder='e.g. Deploy runbook, Migration review checklist'
                  aria-invalid={aiTried && !aiDraft.name.trim()}
                />
                {aiTried && !aiDraft.name.trim() && (
                  <span role='alert' className='text-xs text-destructive'>
                    Add a name.
                  </span>
                )}
              </div>
              <div className='flex flex-col gap-1.5'>
                <label htmlFor='hub-knowledge-ai-description' className='text-sm font-medium'>
                  What should it cover
                </label>
                <Textarea
                  id='hub-knowledge-ai-description'
                  value={aiDraft.description}
                  onChange={event => setAiDraft({ ...aiDraft, description: event.target.value })}
                  onKeyDown={submitOnModEnter}
                  className='h-24 min-h-0 resize-none'
                  placeholder='A few lines are enough. Ask AI fills in the rest.'
                  data-track-category='SdlcHub'
                  data-track-name='HubKnowledgeAiDescriptionChanged'
                  aria-invalid={aiTried && !aiDraft.description.trim()}
                />
                {aiTried && !aiDraft.description.trim() && (
                  <span role='alert' className='text-xs text-destructive'>
                    Say what it should cover.
                  </span>
                )}
              </div>
              {isHubAdmin && (
                <div className='flex flex-col gap-1.5'>
                  <span className='text-sm font-medium'>Save as</span>
                  <ChoiceList<HubKnowledgeAiDraft['kind']>
                    name='HubKnowledgeAiKind'
                    options={[
                      {
                        value: 'auto',
                        label: 'Let AI decide',
                        hint: 'A knowledge file when it is about this hub, a skill when it is a generic procedure.',
                      },
                      {
                        value: 'file',
                        label: 'Knowledge file',
                        hint: "Facts and knowledge about this hub's repositories (like an AGENTS.md or CLAUDE.md file).",
                      },
                      {
                        value: 'skill',
                        label: 'Skill',
                        hint: 'Steps that work in any hub. Agents here use it once a claw admin approves it.',
                      },
                    ]}
                    value={aiDraft.kind}
                    onChange={kind => setAiDraft({ ...aiDraft, kind })}
                  />
                </div>
              )}
            </div>
          )}
        </HubDialog>

        <HubDialog
          open={writeOpen}
          onOpenChange={setWriteOpen}
          title='Write it yourself'
          description={
            isHubAdmin
              ? 'Choose what to write.'
              : 'Write a skill. Only hub admins can add knowledge files.'
          }
          onSubmit={() => {
            setWriteOpen(false);
            if (writeKind === 'doc' && isHubAdmin) props.onNewFile();
            else showSkill(NEW_SKILL);
          }}
          footer={
            <>
              <Button
                type='button'
                variant='outline'
                onClick={() => setWriteOpen(false)}
                data-track-category='SdlcHub'
                data-track-name='HubKnowledgeWriteCancelled'
              >
                Cancel
              </Button>
              <Button
                type='submit'
                data-track-category='SdlcHub'
                data-track-name={
                  writeKind === 'doc'
                    ? 'HubKnowledgeDocCreateOpened'
                    : 'HubKnowledgeSkillCreateOpened'
                }
              >
                Continue
              </Button>
            </>
          }
        >
          <ChoiceList<'doc' | 'skill'>
            name='HubKnowledgeWriteKind'
            autoFocus
            options={[
              ...(isHubAdmin
                ? [
                    {
                      value: 'doc' as const,
                      label: 'Knowledge file',
                      hint: "Facts and knowledge about this hub's repositories (like an AGENTS.md or CLAUDE.md file).",
                    },
                  ]
                : []),
              {
                value: 'skill',
                label: 'Skill',
                hint: 'Steps that work in any hub. Agents here use it once a claw admin approves it.',
              },
            ]}
            value={writeKind}
            onChange={setWriteKind}
          />
        </HubDialog>

        <HubDialog
          open={approval !== null}
          onOpenChange={open => {
            if (!open) closeApproval();
          }}
          title={`Send ${approval?.name ?? 'this skill'} for approval?`}
          description='A claw admin must approve it before agents in this hub can use it. Once approved it becomes a global skill.'
          onSubmit={() => {
            if (!approval) return;
            setSharing(true);
            void approval.send().finally(() => {
              setSharing(false);
              setApproval(null);
            });
          }}
          footer={
            <>
              <Button
                type='button'
                variant='outline'
                onClick={closeApproval}
                data-track-category='SdlcHub'
                data-track-name='HubKnowledgeSkillShareCancelled'
              >
                Cancel
              </Button>
              <Button
                type='submit'
                autoFocus
                loading={sharing}
                data-track-category='SdlcHub'
                data-track-name='HubKnowledgeSkillGlobalRequested'
              >
                Send for approval
              </Button>
            </>
          }
        />

        <HubDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          title='Add existing skill'
          description='Add one of your skills, or one from skills.sh or a GitHub repo.'
          // A fixed height, so loading, results and empty lists do not resize it.
          className='h-[min(560px,80vh)]'
          wide
        >
          <AddSkillList
            channelId={channelId}
            catalog={skillCatalog}
            catalogFailed={skills.isError}
            linkedIds={linkedIds}
            confirmApproval={name =>
              new Promise(resolve =>
                setApproval({
                  name,
                  send: () => Promise.resolve(resolve(true)),
                  cancel: () => resolve(false),
                }),
              )
            }
            requestApproval={requestGlobal}
          />
        </HubDialog>
      </div>
    </>
  );
}
