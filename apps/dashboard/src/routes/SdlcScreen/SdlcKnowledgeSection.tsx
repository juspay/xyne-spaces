import { useState, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Check,
  ChevronDown,
  Ellipsis,
  HelpCircle,
  Link2,
  Lock,
  Pin,
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
import { Checkbox } from '../../components/ui/Checkbox/Checkbox';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import Input from '../../components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { SegmentedToggle } from '../../components/ui/SegmentedToggle/SegmentedToggle';
import Textarea from '../../components/ui/Textarea';
import { Tooltip } from '../../components/ui/Tooltip/Tooltip';
import { useAuth } from '../../hooks/useAuth';
import { useClawSkills } from '../../hooks/useClawSkills';
import { ClawApiError } from '../../services/claw/clawRequest';
import { submitSkillRequest } from '../../services/claw/clawSkillsService';
import type { Skill } from '../../services/claw/clawSkillsTypes';
import { apiInstance } from '../../services/clients/apiClient';
import { cn } from '../../utils/classNames';
import ClawSkillCreateV2 from '../AIScreen/library/skills/create/ClawSkillCreateV2';
import ClawSkillDetailV2 from '../AIScreen/library/skills/detail/ClawSkillDetailV2';
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

// One quiet style: the group a row sits in says whether it is pinned.
const pinClass =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
// Fixed slots, so the pin and the menu line up down the list whatever a row has.
const pinSlot = 'flex w-[5.5rem] shrink-0 justify-end';
const menuSlot = 'flex w-7 shrink-0 justify-end';

function PinButton(props: { pinned: boolean; label: string; onToggle: () => void }): ReactElement {
  return (
    <button
      type='button'
      aria-pressed={props.pinned}
      aria-label={`${props.pinned ? 'Unpin' : 'Pin'} ${props.label}`}
      onClick={event => {
        event.stopPropagation();
        props.onToggle();
      }}
      data-track-category='SdlcHub'
      data-track-name={props.pinned ? 'HubKnowledgeUnpinned' : 'HubKnowledgePinned'}
      className={pinClass}
    >
      <Pin size={13} />
      {props.pinned ? 'Unpin' : 'Pin'}
    </button>
  );
}

function Help({ about, children }: { about: string; children: ReactNode }): ReactElement {
  return (
    <Tooltip side='right' className='max-w-xs p-3 text-xs font-normal' content={children}>
      <button
        type='button'
        aria-label={`About ${about}`}
        className='grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        <HelpCircle className='size-3.5' aria-hidden />
      </button>
    </Tooltip>
  );
}

function Section(props: {
  title: string;
  count: number;
  /** What agents do with the items in this group. */
  caption: string;
  /** Not known yet: an empty list would read as "none". */
  loading?: boolean;
  empty: string;
  /** The first action, offered in the empty state itself. */
  emptyAction?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='rounded-xl border bg-background'>
      <h3 className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-5 py-3 text-sm font-semibold'>
        {props.title}
        <span className='ml-auto text-xs font-normal text-muted-foreground'>{props.caption}</span>
      </h3>
      {props.count === 0 ? (
        <div className='flex flex-col items-center gap-3 px-5 py-8 text-center text-sm text-muted-foreground'>
          {props.loading ? 'Loading…' : props.empty}
          {!props.loading && props.emptyAction}
        </div>
      ) : (
        <div className='divide-y'>{props.children}</div>
      )}
    </div>
  );
}

export interface HubKnowledgeAiDraft {
  name: string;
  description: string;
  /** `auto` leaves the choice between a Knowledge File and a skill to the agent. */
  kind: 'auto' | 'file' | 'skill';
}

// No skill has this slug: slugs are lower case with dashes.
const NEW_SKILL = 'NEW';

const EMPTY_AI_DRAFT: HubKnowledgeAiDraft = { name: '', description: '', kind: 'auto' };

/** Hub Knowledge: the hub's Knowledge Files and Linked Skills, and which of them are pinned. */
export function SdlcKnowledgeSection(props: {
  channelId: string;
  files: KnowledgeFile[];
  /** False until the file list has arrived. */
  filesLoaded: boolean;
  isHubAdmin: boolean;
  showArchived: boolean;
  emptyFilesText: string;
  onShowArchivedChange: (show: boolean) => void;
  onOpenFile: (canvasId: string) => void;
  onArchiveFile: (canvasId: string, archived: boolean) => void;
  onNewFile: () => void;
  onCreateWithAi: (draft: HubKnowledgeAiDraft) => void;
  /** The page header, with the page-wide Add menu placed in it. */
  renderHeader: (actions: ReactNode) => ReactNode;
  /** Status and start button of the workflow that generates Knowledge Files. */
  generateControl: ReactNode;
}): ReactElement {
  const { channelId, isHubAdmin } = props;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  // Kept when the dialog is dismissed by Escape or a click outside, so typed text is not lost.
  const [aiDraft, setAiDraft] = useState<HubKnowledgeAiDraft | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTried, setAiTried] = useState(false);
  const closeAiDialog = (): void => {
    setAiOpen(false);
    setAiDraft(null);
    setAiTried(false);
  };
  const [shareSkill, setShareSkill] = useState<Skill | null>(null);
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
  });
  const skills = useClawSkills();
  const skillCatalog = skills.data;
  // Until both load, an empty list would read as "nothing linked, nothing pinned".
  const ready = Boolean(links.data && skillCatalog);
  const failed = links.isError || skills.isError;

  const change = async (
    request: () => Promise<unknown>,
    failure: string | ((error: unknown) => string),
    done?: { message: string; description?: string; undo: () => void },
  ): Promise<void> => {
    try {
      await request();
      if (done) {
        toast.success(done.message, {
          className: 'hub-inline-action',
          ...(done.description && { description: done.description }),
          action: { label: 'Undo', onClick: done.undo },
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
  const setPin = (pin: SdlcHubPin, name: string): void => {
    const whom = pin.scope === 'hub' ? 'everyone' : 'me';
    void change(() => apiInstance.put(`${base}/pins`, pin), 'Could not change the pin.', {
      message: !pin.pinned
        ? `"${name}" unpinned for ${whom}`
        : pin.scope === 'hub'
          ? `"${name}" pinned for everyone. Every member's runs now read it in full.`
          : `"${name}" pinned for me`,
      undo: () => setPin({ ...pin, pinned: !pin.pinned }, name),
    });
  };

  const linked = links.data?.skills ?? [];
  const pinnedCanvasIds = new Set(links.data?.pinnedCanvasIds ?? []);
  const linkedIds = new Set(linked.map(link => link.skillId));
  const skillById = new Map((skillCatalog ?? []).map(skill => [skill.id, skill]));
  const skillRows = (skillCatalog ? linked : [])
    .flatMap(link => {
      const skill = skillById.get(link.skillId);
      // Someone else's personal skill, or one deleted since: only its linker has a row to clean up.
      if (!skill && link.linkedBy !== userId) return [];
      return [{ ...link, skill, forEveryone: skill?.scope === 'global' }];
    })
    // Everyone's skills first, then the ones only this user gets. The sort is stable.
    .sort((a, b) => Number(b.forEveryone) - Number(a.forEveryone));
  const pickerNeedle = pickerQuery.trim().toLowerCase();
  // Linked ones stay in the list, marked: a search for one must not read as "no such skill".
  const pickable = (skillCatalog ?? []).filter(
    skill =>
      skill.enabled &&
      // Linking a global skill gives it to every member, so that is the admin's call.
      // The catalog holds global skills and the viewer's own, so a personal one is theirs.
      (isHubAdmin || skill.scope === 'personal') &&
      `${skill.name} ${skill.slug} ${skill.description}`.toLowerCase().includes(pickerNeedle),
  );
  // The ones that can still be linked come first. The sort is stable.
  pickable.sort((a, b) => Number(linkedIds.has(a.id)) - Number(linkedIds.has(b.id)));

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
  const skillPinned = (row: (typeof skillRows)[number]): boolean =>
    row.pinnedForHub || row.pinnedForMe;
  const loading = !props.filesLoaded || (!ready && !failed);

  /** The viewer's two pins on a skill, kept so undoing an unlink can put them back. */
  interface SkillPins {
    hub: boolean;
    me: boolean;
  }
  const linkSkill = (skillId: string, name: string, pins?: SkillPins): void => {
    setPickerOpen(false);
    setPickerQuery('');
    void change(
      async () => {
        await apiInstance.post(`${base}/skills`, { skillId });
        // Unlinking deleted the pins with the link.
        for (const scope of ['hub', 'me'] as const) {
          if (!pins?.[scope]) continue;
          const pin: SdlcHubPin = { targetType: 'SKILL', targetId: skillId, scope, pinned: true };
          await apiInstance.put(`${base}/pins`, pin);
        }
      },
      'Could not link the skill.',
      {
        message: `"${name}" linked to this hub`,
        undo: () => unlinkSkill(skillId, name, pins),
      },
    );
  };
  const unlinkSkill = (skillId: string, name: string, pins?: SkillPins): void =>
    void change(
      () => apiInstance.delete(`${base}/skills/${encodeURIComponent(skillId)}`),
      error =>
        isAxiosError(error) && error.response?.status === 403
          ? 'Only the member who linked it or a hub admin can unlink.'
          : 'Could not unlink the skill.',
      {
        message: `"${name}" unlinked from this hub`,
        // The server drops every member's pin with the link, and only the viewer's can be put back.
        description: "Undo links it again with your pins. Other members' own pins on it are gone.",
        undo: () => linkSkill(skillId, name, pins),
      },
    );
  const requestGlobal = async (skill: Skill): Promise<void> => {
    if (!userId) return;
    try {
      await submitSkillRequest(skill.slug, userId);
      toast.success('Sent to an admin for approval.');
    } catch (error) {
      const status = error instanceof ClawApiError ? error.status : 0;
      if (status === 400) toast.info('This skill is already available to everyone.');
      else if (status === 409) toast.info('A request is already waiting for an admin.');
      else toast.error('Could not send the request.');
      // Either answer means the cached skill list is behind.
      await queryClient.invalidateQueries({ queryKey: ['claw-skills'] });
    }
  };

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          size='sm'
          data-track-category='SdlcHub'
          data-track-name='HubKnowledgeAddOpened'
        >
          <Plus size={15} />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-64 rounded-xl p-1.5 shadow-sm'>
        <DropdownMenuItem
          onClick={() => {
            setAiDraft(
              draft => draft ?? { ...EMPTY_AI_DRAFT, kind: isHubAdmin ? 'auto' : 'skill' },
            );
            setAiOpen(true);
          }}
          data-track-category='SdlcHub'
          data-track-name='HubKnowledgeCreateWithAi'
        >
          <Sparkles size={15} />
          Create with AI
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isHubAdmin && (
          <DropdownMenuItem
            onClick={props.onNewFile}
            data-track-category='SdlcHub'
            data-track-name='HubKnowledgeDocCreateOpened'
          >
            <BookOpen size={15} />
            New Knowledge File
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => showSkill(NEW_SKILL)}
          data-track-category='SdlcHub'
          data-track-name='HubKnowledgeSkillCreateOpened'
        >
          <Wrench size={15} />
          New skill
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setPickerOpen(true)}
          data-track-category='SdlcHub'
          data-track-name='HubKnowledgeSkillPickerOpened'
        >
          <Link2 size={15} />
          Link existing skill
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const rowClass =
    'flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
  const onlyMine = (
    <span
      className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
      title='Only your runs in this hub get it.'
    >
      Only my runs
    </span>
  );

  const fileRow = (file: KnowledgeFile): ReactElement => (
    <div
      key={file.id}
      role='button'
      tabIndex={0}
      onClick={() => props.onOpenFile(file.id)}
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
      <div className='grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'>
        <BookOpen size={16} />
      </div>
      <div className='flex min-w-0 flex-1 items-center gap-2'>
        <span className='truncate font-semibold' title={file.title}>
          {file.title}
        </span>
        {file.status === 'archived' && <ArchivedPill />}
        {file.status === 'archived' && pinnedCanvasIds.has(file.id) && (
          <span className='truncate text-xs text-muted-foreground'>
            Pinned for everyone again on restore
          </span>
        )}
      </div>
      {file.status === 'generating' ? (
        // The run owns the file until it is written, so the row says so in place of its controls.
        <span className='shrink-0 text-xs text-muted-foreground'>
          Being written. Pin and archive come after.
        </span>
      ) : (
        <>
          {/* Only a ready file can be pinned, and only by a hub admin: everyone else reads it from the group. */}
          <span className={pinSlot}>
            {links.data && file.status === 'ready' && isHubAdmin && (
              <PinButton
                pinned={pinnedCanvasIds.has(file.id)}
                label={file.title}
                onToggle={() =>
                  setPin(
                    {
                      targetType: 'CANVAS',
                      targetId: file.id,
                      scope: 'hub',
                      pinned: !pinnedCanvasIds.has(file.id),
                    },
                    file.title,
                  )
                }
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
        </>
      )}
    </div>
  );

  const skillRow = (row: (typeof skillRows)[number]): ReactElement => {
    const { skillId, linkedBy, pinnedForHub, pinnedForMe, skill } = row;
    const personal = skill?.scope === 'personal';
    const canUnlink = isHubAdmin || linkedBy === userId;
    const pinned = pinnedForHub || pinnedForMe;
    const skillName = skill?.name || skill?.slug || 'Removed skill';
    const pinSkill = (scope: SdlcHubPin['scope'], next: boolean): void =>
      setPin({ targetType: 'SKILL', targetId: skillId, scope, pinned: next }, skillName);
    const open = skill ? (): void => showSkill(skill.slug) : undefined;
    return (
      <div
        key={skillId}
        role={open && 'button'}
        tabIndex={open && 0}
        onClick={open}
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
        className={open ? rowClass : 'flex items-center gap-3 px-5 py-2.5 opacity-60'}
      >
        <div className='grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground'>
          <Wrench size={16} />
        </div>
        <div className='flex min-w-0 flex-1 items-baseline gap-2'>
          {skill ? (
            <>
              <span className='truncate font-semibold' title={skill.description || skillName}>
                {skillName}
              </span>
              {/* A personal skill, or a pin for me, reaches only the viewer's runs. */}
              {(personal || (pinnedForMe && !pinnedForHub)) && onlyMine}
            </>
          ) : (
            <>
              <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                Skill removed
              </span>
              <span className='truncate text-xs text-muted-foreground'>
                Deleted from the library. Agents no longer receive it.
              </span>
            </>
          )}
        </div>
        <span className={pinSlot}>
          {skill &&
            // Only a hub admin on a global skill has both pins to choose from.
            (isHubAdmin && !personal ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Pin options for ${skillName}`}
                  onClick={event => event.stopPropagation()}
                  data-track-category='SdlcHub'
                  data-track-name='HubKnowledgePinMenuOpened'
                  className={pinClass}
                >
                  <Pin size={13} />
                  {pinned ? 'Unpin' : 'Pin'}
                  <ChevronDown size={12} aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  className='w-48 rounded-xl p-1.5 shadow-sm'
                  onClick={event => event.stopPropagation()}
                >
                  {/* Already given to everyone: a pin for me on top would change nothing. */}
                  {(pinnedForMe || !pinnedForHub) && (
                    <DropdownMenuItem
                      onClick={() => pinSkill('me', !pinnedForMe)}
                      data-track-category='SdlcHub'
                      data-track-name='HubKnowledgePinForMeToggled'
                    >
                      {pinnedForMe ? 'Unpin for me' : 'Pin for me'}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => pinSkill('hub', !pinnedForHub)}
                    data-track-category='SdlcHub'
                    data-track-name='HubKnowledgePinForEveryoneToggled'
                  >
                    {pinnedForHub ? 'Unpin for everyone' : 'Pin for everyone'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              // A member cannot undo a pin a hub admin made for everyone.
              !(pinnedForHub && !isHubAdmin) && (
                <PinButton
                  pinned={pinned}
                  label={skillName}
                  onToggle={() =>
                    pinnedForHub ? pinSkill('hub', false) : pinSkill('me', !pinnedForMe)
                  }
                />
              )
            ))}
        </span>
        <span className={menuSlot}>
          {/* No menu when nothing in it applies to the viewer. */}
          {((skill && personal) || canUnlink) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  aria-label={`More for ${skill?.name || skill?.slug || 'removed skill'}`}
                  onClick={event => event.stopPropagation()}
                  data-track-category='SdlcHub'
                  data-track-name='HubKnowledgeSkillMenuOpened'
                  className='grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                >
                  <Ellipsis size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                className='w-48 rounded-xl p-1.5 shadow-sm'
                onClick={event => event.stopPropagation()}
              >
                {skill && personal && (
                  <DropdownMenuItem
                    onClick={() => setShareSkill(skill)}
                    data-track-category='SdlcHub'
                    data-track-name='HubKnowledgeSkillShareOpened'
                  >
                    Share with everyone
                  </DropdownMenuItem>
                )}
                {canUnlink && (
                  <DropdownMenuItem
                    onClick={() =>
                      unlinkSkill(skillId, skillName, { hub: pinnedForHub, me: pinnedForMe })
                    }
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
      </div>
    );
  };

  // One list, grouped by what agents do with each item. Files first in each group.
  const group = (pinned: boolean): ReactElement[] => [
    ...files.filter(file => filePinned(file) === pinned).map(fileRow),
    ...shownSkills.filter(row => skillPinned(row) === pinned).map(skillRow),
  ];
  const pinnedRows = group(true);
  const otherRows = group(false);
  const filtered = Boolean(needle) || kind !== 'all';

  // A skill's form or page takes this page's place, inside the hub, and hands it back when closed.
  if (skillParam === NEW_SKILL) {
    return <ClawSkillCreateV2 hub={{ channelId, onClose: () => showSkill(null) }} />;
  }
  if (skillParam) {
    return <ClawSkillDetailV2 hub={{ slug: skillParam, onClose: () => showSkill(null) }} />;
  }

  return (
    <>
      {props.renderHeader(
        // The run's status and button are one group, with a wider gap before Add.
        <div className='flex shrink-0 flex-wrap items-center justify-end gap-x-5 gap-y-2'>
          {props.generateControl}
          {addMenu}
        </div>,
      )}
      <div className='flex flex-col gap-5'>
        <div className='flex flex-wrap items-center gap-3'>
          <div className='relative min-w-48 flex-1'>
            <Search
              size={14}
              className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'
            />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              className='h-9 pl-9'
              placeholder='Search knowledge'
              aria-label='Search knowledge'
              data-track-category='SdlcHub'
              data-track-name='HubKnowledgeSearched'
            />
          </div>
          <Select value={kind} onValueChange={value => setKind(value as typeof kind)}>
            <SelectTrigger className='h-9 w-44' aria-label='Show'>
              <SelectValue />
            </SelectTrigger>
            {/* Opts out of the dark theme's hardcoded blue for the chosen option (see global.css). */}
            <SelectContent data-theme-tokens>
              <SelectItem value='all' data-theme-tokens>
                All items
              </SelectItem>
              <SelectItem value='file' data-theme-tokens>
                Knowledge Files
              </SelectItem>
              <SelectItem value='skill' data-theme-tokens>
                Linked Skills
              </SelectItem>
            </SelectContent>
          </Select>
          <Checkbox
            labelClassName='text-xs font-normal text-muted-foreground'
            label='Show archived'
            checked={props.showArchived}
            onChange={props.onShowArchivedChange}
            data-track-category='SdlcHub'
            data-track-name='HubKnowledgeArchivedToggled'
          />
        </div>
        {!isHubAdmin && (
          <p className='flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground'>
            <Lock size={13} className='shrink-0' />
            View only for Knowledge Files. You can link and pin your own skills.
          </p>
        )}
        {failed && (
          <p className='text-sm text-destructive'>
            Could not load pins and linked skills. Reload to try again.
          </p>
        )}
        {/* Without the links nothing is known about pins: no group may say "nothing is pinned". */}
        {(links.data || !failed) && (
          <>
            <Section
              title='Always read in full'
              caption='Every run starts with these. Keep the list short.'
              loading={loading}
              count={loading ? 0 : pinnedRows.length}
              empty={
                filtered
                  ? 'No pinned items match.'
                  : 'Nothing is pinned. Agents choose what to open from the names alone.'
              }
            >
              {pinnedRows}
            </Section>
            <Section
              title='Opened when needed'
              caption='Agents see only the name, and open the item when a request needs it.'
              loading={loading}
              count={loading ? 0 : otherRows.length}
              empty={
                filtered
                  ? 'No items match.'
                  : props.files.length === 0
                    ? props.emptyFilesText
                    : 'Everything here is pinned.'
              }
              emptyAction={
                !filtered &&
                props.files.length === 0 &&
                (isHubAdmin ? (
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    onClick={props.onNewFile}
                    data-track-category='SdlcHub'
                    data-track-name='HubKnowledgeDocCreateOpened'
                  >
                    <BookOpen size={15} />
                    New Knowledge File
                  </Button>
                ) : (
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    onClick={() => setPickerOpen(true)}
                    data-track-category='SdlcHub'
                    data-track-name='HubKnowledgeSkillPickerOpened'
                  >
                    <Link2 size={15} />
                    Link existing skill
                  </Button>
                ))
              }
            >
              {otherRows}
            </Section>
          </>
        )}

        <Dialog open={aiOpen} onOpenChange={setAiOpen} title='Create with AI' className='max-w-lg'>
          {aiDraft && (
            <form
              className='p-6'
              onSubmit={event => {
                event.preventDefault();
                // The button stays enabled: a press says what is missing.
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
            >
              <h2 className='text-lg font-semibold'>Create with AI</h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                {isHubAdmin
                  ? 'Ask AI writes it and shows you a card to approve before anything is saved.'
                  : 'Ask AI writes a skill and shows you a card to approve. Only hub admins add Knowledge Files.'}
              </p>
              <label htmlFor='hub-knowledge-ai-name' className='mt-5 block text-sm font-medium'>
                Name
              </label>
              <Input
                id='hub-knowledge-ai-name'
                autoFocus
                value={aiDraft.name}
                onChange={event => setAiDraft({ ...aiDraft, name: event.target.value })}
                className='mt-2 h-10'
                placeholder='e.g. Deploy runbook, Migration review checklist'
                aria-invalid={aiTried && !aiDraft.name.trim()}
              />
              {aiTried && !aiDraft.name.trim() && (
                <span role='alert' className='mt-1 block text-xs text-destructive'>
                  Add a name.
                </span>
              )}
              <label
                htmlFor='hub-knowledge-ai-description'
                className='mt-4 block text-sm font-medium'
              >
                What should it cover
              </label>
              <Textarea
                id='hub-knowledge-ai-description'
                value={aiDraft.description}
                onChange={event => setAiDraft({ ...aiDraft, description: event.target.value })}
                className='mt-2 h-24 min-h-0 resize-none'
                placeholder='A few lines are enough. Ask AI fills in the rest.'
                data-track-category='SdlcHub'
                data-track-name='HubKnowledgeAiDescriptionChanged'
                aria-invalid={aiTried && !aiDraft.description.trim()}
              />
              {aiTried && !aiDraft.description.trim() && (
                <span role='alert' className='mt-1 block text-xs text-destructive'>
                  Say what it should cover.
                </span>
              )}
              {isHubAdmin && (
                <>
                  <p className='mt-4 flex items-center gap-1 text-sm font-medium'>
                    Save as
                    <Help about='Save as'>
                      <ul className='flex flex-col gap-2'>
                        <li>
                          <b>Let AI decide:</b> a Knowledge File when it is about this hub, a skill
                          when it is a generic procedure.
                        </li>
                        <li>
                          <b>Knowledge File:</b> a document that belongs to this hub, for facts
                          about its repositories, systems and environments.
                        </li>
                        <li>
                          <b>Skill:</b> a procedure that works in any hub. It is yours alone until
                          an admin makes it global.
                        </li>
                      </ul>
                    </Help>
                  </p>
                  <SegmentedToggle<HubKnowledgeAiDraft['kind']>
                    className='mt-2 flex w-full [&>button]:flex-1'
                    options={[
                      { value: 'auto', label: 'Let AI decide' },
                      { value: 'file', label: 'Knowledge File' },
                      { value: 'skill', label: 'Skill' },
                    ]}
                    value={aiDraft.kind}
                    onChange={kind => setAiDraft({ ...aiDraft, kind })}
                    tone='primary'
                    trackCategory='SdlcHub'
                    trackPrefix='HubKnowledgeAiKind'
                  />
                </>
              )}
              <div className='mt-6 flex justify-end gap-2'>
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
              </div>
            </form>
          )}
        </Dialog>

        <Dialog
          open={shareSkill !== null}
          onOpenChange={open => {
            if (!open) setShareSkill(null);
          }}
          title='Share with everyone'
          className='max-w-md'
        >
          <div className='p-6'>
            <h2 className='text-lg font-semibold'>Share {shareSkill?.name || shareSkill?.slug}?</h2>
            <p className='mt-2 text-sm text-muted-foreground'>
              Once an admin approves, this skill is available to everyone, and every member&apos;s
              runs in this hub will get it.
            </p>
            <div className='mt-6 flex justify-end gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setShareSkill(null)}
                data-track-category='SdlcHub'
                data-track-name='HubKnowledgeSkillShareCancelled'
              >
                Cancel
              </Button>
              <Button
                type='button'
                onClick={() => {
                  if (shareSkill) void requestGlobal(shareSkill);
                  setShareSkill(null);
                }}
                data-track-category='SdlcHub'
                data-track-name='HubKnowledgeSkillGlobalRequested'
              >
                Send request
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          title='Link existing skill'
          description={
            isHubAdmin
              ? 'A global skill reaches every member. A personal one reaches only you.'
              : 'Your personal skills. Only a hub admin can link a global skill.'
          }
          className='max-w-2xl'
        >
          <div className='flex max-h-[75vh] flex-col gap-5 p-8'>
            <div className='flex items-start gap-3'>
              <div className='min-w-0 flex-1'>
                <h2 className='text-lg font-semibold'>Link existing skill</h2>
                <p className='mt-1 text-sm text-muted-foreground'>
                  {isHubAdmin
                    ? "A linked skill goes to every member's runs in this hub. One of your own skills goes only to your runs."
                    : 'Your own skills. Only a hub admin can link a skill for everyone.'}
                </p>
              </div>
              <button
                type='button'
                aria-label='Close'
                title='Close'
                onClick={() => setPickerOpen(false)}
                data-track-category='SdlcHub'
                data-track-name='HubKnowledgeSkillPickerClosed'
                className='grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                <X size={15} />
              </button>
            </div>
            <div className='relative'>
              <Search
                size={14}
                className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'
              />
              <Input
                id='hub-knowledge-skill-search'
                autoFocus
                className='h-9 pl-9'
                placeholder='Search skills'
                aria-label='Search skills'
                value={pickerQuery}
                onChange={event => setPickerQuery(event.target.value)}
              />
            </div>
            {/* Right padding keeps the Link buttons clear of the scrollbar. */}
            <div className='-ml-2 -mr-4 min-h-0 flex-1 overflow-auto pr-4'>
              {pickable.map(skill => {
                const name = skill.name || skill.slug;
                const isLinked = linkedIds.has(skill.id);
                return (
                  <div
                    key={skill.id}
                    className='flex items-center gap-4 rounded-lg px-2 py-3 hover:bg-muted/40'
                  >
                    <div className='grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground'>
                      <Wrench size={16} />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-2'>
                        <span className='truncate text-sm font-semibold'>{name}</span>
                        {skill.scope === 'personal' && onlyMine}
                      </div>
                      {skill.description && (
                        <p
                          className='mt-0.5 truncate text-xs text-muted-foreground'
                          title={skill.description}
                        >
                          {skill.description}
                        </p>
                      )}
                    </div>
                    {isLinked ? (
                      <span className='flex shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground'>
                        <Check size={13} />
                        Linked
                      </span>
                    ) : (
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        aria-label={`Link ${name}`}
                        onClick={() => linkSkill(skill.id, name)}
                        data-track-category='SdlcHub'
                        data-track-name='HubKnowledgeSkillLinked'
                      >
                        Link
                      </Button>
                    )}
                  </div>
                );
              })}
              {pickable.length === 0 && (
                <p className='px-3 py-6 text-center text-sm text-muted-foreground'>
                  {!skillCatalog
                    ? skills.isError
                      ? 'Could not load the skill library. Reload to try again.'
                      : 'Loading…'
                    : pickerNeedle
                      ? `No skill matches "${pickerQuery.trim()}".`
                      : isHubAdmin
                        ? 'The skill library has no skills yet. Create one with New skill.'
                        : 'You have no personal skills yet. Create one with New skill, or ask a hub admin to link a global one.'}
                </p>
              )}
            </div>
          </div>
        </Dialog>
      </div>
    </>
  );
}
