import { Fragment, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Check,
  Ellipsis,
  HelpCircle,
  Link2,
  ListFilter,
  Pin,
  Plus,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { SdlcHubKnowledgeLinks, SdlcHubPin } from '@xyne/shared';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import Input from '../../components/ui/Input';
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
import { SdlcArchiveMenu } from './SdlcArchiveMenu';

export interface KnowledgeFile {
  id: string;
  title: string;
  status: 'ready' | 'generating' | 'archived';
  /** Already formatted: when it changed and where it came from. */
  detail: string;
}

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

function StatusPill({ status }: { status: KnowledgeFile['status'] }): ReactElement | null {
  if (status === 'ready') return null;
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'archived'
          ? 'bg-muted text-muted-foreground'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      )}
    >
      {status === 'archived' ? 'Archived' : 'Generating'}
    </span>
  );
}

const pinClass = (pinned: boolean): string =>
  cn(
    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
    pinned
      ? 'border-transparent bg-primary/10 text-primary'
      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
  );

function PinButton(props: {
  pinned: boolean;
  disabledReason?: string | undefined;
  label: string;
  text: string;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      type='button'
      aria-pressed={props.pinned}
      aria-label={`${props.pinned ? 'Unpin' : 'Pin'} ${props.label}`}
      title={props.disabledReason}
      disabled={Boolean(props.disabledReason)}
      onClick={event => {
        event.stopPropagation();
        props.onToggle();
      }}
      data-track-category='SdlcHub'
      data-track-name={props.pinned ? 'HubKnowledgeUnpinned' : 'HubKnowledgePinned'}
      className={pinClass(props.pinned)}
    >
      <Pin size={13} />
      {props.text}
    </button>
  );
}

function Help({ about, children }: { about: string; children: ReactNode }): ReactElement {
  return (
    <Tooltip side='right' className='max-w-xs p-3 text-xs font-normal' content={children}>
      <HelpCircle
        className='size-3.5 shrink-0 text-muted-foreground'
        aria-label={`About ${about}`}
      />
    </Tooltip>
  );
}

function Section(props: {
  title: string;
  count: number;
  help: string;
  /** Sits at the right of the title bar. */
  action?: ReactNode;
  empty: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='overflow-hidden rounded-xl border bg-background'>
      <h3 className='flex items-center gap-1.5 border-b px-5 py-3 text-sm font-semibold'>
        {props.title}
        <span className='font-normal tabular-nums text-muted-foreground'>{props.count}</span>
        <Help about={props.title}>{props.help}</Help>
        {props.action && (
          <span className='ml-auto flex items-center gap-2 font-normal'>{props.action}</span>
        )}
      </h3>
      {props.count === 0 ? (
        <p className='px-5 py-8 text-center text-sm text-muted-foreground'>{props.empty}</p>
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

const EMPTY_AI_DRAFT: HubKnowledgeAiDraft = { name: '', description: '', kind: 'auto' };

/** Hub Knowledge: the hub's Knowledge Files and Linked Skills, and which of them are pinned. */
export function SdlcKnowledgeSection(props: {
  channelId: string;
  files: KnowledgeFile[];
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
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [aiDraft, setAiDraft] = useState<HubKnowledgeAiDraft | null>(null);
  const [shareSkill, setShareSkill] = useState<Skill | null>(null);

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
  ): Promise<void> => {
    try {
      await request();
    } catch (error) {
      toast.error(typeof failure === 'string' ? failure : failure(error));
    }
    // The catalog too: a link whose skill is missing from a stale catalog reads as removed.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: linksKey }),
      queryClient.invalidateQueries({ queryKey: ['claw-skills'] }),
    ]);
  };
  const setPin = (pin: SdlcHubPin): void =>
    void change(() => apiInstance.put(`${base}/pins`, pin), 'Could not change the pin.');

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
  const pickable = (skillCatalog ?? []).filter(
    skill =>
      skill.enabled &&
      !linkedIds.has(skill.id) &&
      // Linking a global skill gives it to every member, so that is the admin's call.
      // The catalog holds global skills and the viewer's own, so a personal one is theirs.
      (isHubAdmin || skill.scope === 'personal') &&
      `${skill.name} ${skill.slug} ${skill.description}`.toLowerCase().includes(pickerNeedle),
  );

  const liveFiles = props.files.filter(file => file.status === 'ready');
  // Runs skip a disabled skill, so the counts do too.
  const liveSkills = skillRows.filter(row => row.skill?.enabled);
  const pinnedCount =
    liveFiles.filter(file => pinnedCanvasIds.has(file.id)).length +
    liveSkills.filter(row => row.pinnedForHub || row.pinnedForMe).length;
  const listedCount = liveFiles.length + liveSkills.length - pinnedCount;

  const skillPath = (slug: string): string =>
    `${workspaceId ? `/${workspaceId}` : ''}/ai/library/skill/${encodeURIComponent(slug)}`;
  const linkSkill = (skill: Skill): void => {
    setPickerOpen(false);
    setPickerQuery('');
    void change(
      () => apiInstance.post(`${base}/skills`, { skillId: skill.id }),
      'Could not link the skill.',
    );
  };
  const unlinkSkill = (skillId: string): void =>
    void change(
      () => apiInstance.delete(`${base}/skills/${encodeURIComponent(skillId)}`),
      error =>
        isAxiosError(error) && error.response?.status === 403
          ? 'Only the member who linked it or a hub admin can unlink.'
          : 'Could not unlink the skill.',
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
          onClick={() => setAiDraft({ ...EMPTY_AI_DRAFT, kind: isHubAdmin ? 'auto' : 'skill' })}
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
          onClick={() =>
            void navigate(
              `${workspaceId ? `/${workspaceId}` : ''}/ai/library/skill/create?${new URLSearchParams({ sdlcChannelId: channelId, returnTo: pathname })}`,
            )
          }
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

  return (
    <>
      {props.renderHeader(addMenu)}
      <div className='grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]'>
        <div className='flex min-w-0 flex-col gap-5'>
          <Section
            title='Knowledge Files'
            count={props.files.length}
            help='Documents with facts about this hub: its repositories, systems and environments. Hub admins add and edit them. Agents see every file by name and open one when a request needs it.'
            action={
              <>
                {/* Hidden only: the workflow trigger API has no hub admin check yet. Move the rule there once workflow auth is decided. */}
                {isHubAdmin && (
                  <Tooltip
                    side='bottom'
                    className='max-w-xs p-3 text-xs'
                    content="Runs the Hub Knowledge workflow. It reads this hub's repositories and writes or refreshes the Knowledge Files."
                  >
                    <span>{props.generateControl}</span>
                  </Tooltip>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label='Filter Knowledge Files'
                    data-track-category='SdlcHub'
                    data-track-name='HubKnowledgeFilterOpened'
                    className={cn(
                      'grid size-7 place-items-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      props.showArchived
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <ListFilter size={15} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align='end'
                    className='w-48 rounded-xl p-1.5 font-normal shadow-sm'
                  >
                    <DropdownMenuItem
                      onClick={() => props.onShowArchivedChange(!props.showArchived)}
                      data-track-category='SdlcHub'
                      data-track-name='HubKnowledgeArchivedToggled'
                    >
                      <Check size={14} className={cn(!props.showArchived && 'invisible')} />
                      Show archived
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
            empty={props.emptyFilesText}
          >
            {props.files.map(file => (
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
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  file.status === 'archived' && 'opacity-60',
                )}
              >
                <div className='grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'>
                  <BookOpen size={16} />
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-semibold'>{file.title}</span>
                    <StatusPill status={file.status} />
                  </div>
                  <p className='mt-0.5 break-words text-xs text-muted-foreground'>{file.detail}</p>
                </div>
                {links.data && (
                  <PinButton
                    pinned={pinnedCanvasIds.has(file.id)}
                    text={pinnedCanvasIds.has(file.id) ? 'Pinned for everyone' : 'Pin for everyone'}
                    label={file.title}
                    disabledReason={
                      !isHubAdmin
                        ? 'Only hub admins can pin Knowledge Files'
                        : file.status !== 'ready'
                          ? 'Not ready yet'
                          : undefined
                    }
                    onToggle={() =>
                      setPin({
                        targetType: 'CANVAS',
                        targetId: file.id,
                        scope: 'hub',
                        pinned: !pinnedCanvasIds.has(file.id),
                      })
                    }
                  />
                )}
                {isHubAdmin && (
                  <SdlcArchiveMenu
                    title={file.title}
                    archived={file.status === 'archived'}
                    trackingScope='HubKnowledge'
                    onToggle={next => props.onArchiveFile(file.id, next)}
                  />
                )}
              </div>
            ))}
          </Section>

          <Section
            title='Linked Skills'
            count={skillRows.length}
            help='Reusable procedures from the skill library, attached to this hub. Agents running here can use them.'
            empty={
              failed
                ? 'Could not load the linked skills. Reload to try again.'
                : ready
                  ? 'No skills linked. Link one from the library, or create one with AI.'
                  : 'Loading…'
            }
          >
            {skillRows.map((row, index) => {
              const { skillId, linkedBy, pinnedForHub, pinnedForMe, skill, forEveryone } = row;
              const personal = skill?.scope === 'personal';
              const startsGroup = skillRows[index - 1]?.forEveryone !== forEveryone;
              const canUnlink = isHubAdmin || linkedBy === userId;
              const pinned = pinnedForHub || pinnedForMe;
              const pinText = pinnedForHub
                ? 'Pinned for everyone'
                : pinnedForMe
                  ? 'Pinned for you'
                  : 'Pin for me';
              const pinSkill = (scope: SdlcHubPin['scope'], next: boolean): void =>
                setPin({ targetType: 'SKILL', targetId: skillId, scope, pinned: next });
              const linker =
                linkedBy === userId
                  ? 'you'
                  : skill?.owner?.id === linkedBy
                    ? skill.owner.name
                    : null;
              const open = skill ? (): void => void navigate(skillPath(skill.slug)) : undefined;
              return (
                <Fragment key={skillId}>
                  {startsGroup && (
                    <div className='flex items-center gap-1.5 px-5 pb-2 pt-4 text-muted-foreground'>
                      <span className='text-[11px] font-semibold uppercase tracking-wider'>
                        {forEveryone ? 'Everyone' : 'Only you'}
                      </span>
                      <Help about={forEveryone ? 'Everyone' : 'Only you'}>
                        {forEveryone
                          ? "Skills available to everyone. Every member's runs in this hub get them. Only a hub admin can add or remove one here."
                          : 'Skills you created. They stay with you, and only your runs in this hub get them. To give one to the whole hub, choose "Share with everyone" from its menu. It moves to Everyone once an admin approves.'}
                      </Help>
                    </div>
                  )}
                  <div
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
                    className={cn(
                      'flex items-center gap-3 px-5 py-3',
                      open
                        ? 'cursor-pointer transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                        : 'opacity-60',
                    )}
                  >
                    <div className='grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground'>
                      <Wrench size={16} />
                    </div>
                    <div className='min-w-0 flex-1'>
                      {skill ? (
                        <>
                          <div className='flex flex-wrap items-baseline gap-x-2'>
                            <span className='font-semibold'>{skill.name || skill.slug}</span>
                            <span className='text-xs tabular-nums text-muted-foreground'>
                              {wordCount(skill.content).toLocaleString()} words
                              {!personal && linker && ` · linked by ${linker}`}
                            </span>
                          </div>
                          {skill.description && (
                            <p
                              className='mt-0.5 truncate text-sm text-muted-foreground'
                              title={skill.description}
                            >
                              {skill.description}
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                            Skill removed
                          </span>
                          <p className='mt-0.5 text-xs text-muted-foreground'>
                            Deleted from the library. Agents no longer receive it.
                          </p>
                        </>
                      )}
                    </div>
                    {skill &&
                      // Only a hub admin on a global skill has both pins to choose from.
                      (isHubAdmin && !personal ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Pin options for ${skill.name || skill.slug}`}
                            onClick={event => event.stopPropagation()}
                            data-track-category='SdlcHub'
                            data-track-name='HubKnowledgePinMenuOpened'
                            className={pinClass(pinned)}
                          >
                            <Pin size={13} />
                            {pinned ? pinText : 'Pin'}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align='end'
                            className='w-48 rounded-xl p-1.5 shadow-sm'
                            onClick={event => event.stopPropagation()}
                          >
                            <DropdownMenuItem
                              onClick={() => pinSkill('me', !pinnedForMe)}
                              data-track-category='SdlcHub'
                              data-track-name='HubKnowledgePinForMeToggled'
                            >
                              {pinnedForMe ? 'Unpin for me' : 'Pin for me'}
                            </DropdownMenuItem>
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
                        <PinButton
                          pinned={pinned}
                          text={pinText}
                          label={skill.name || skill.slug}
                          disabledReason={
                            pinnedForHub && !isHubAdmin
                              ? 'Pinned for everyone by a hub admin'
                              : undefined
                          }
                          onToggle={() =>
                            pinnedForHub ? pinSkill('hub', false) : pinSkill('me', !pinnedForMe)
                          }
                        />
                      ))}
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
                        <DropdownMenuItem
                          disabled={!canUnlink}
                          onClick={() => unlinkSkill(skillId)}
                          data-track-category='SdlcHub'
                          data-track-name='HubKnowledgeSkillUnlinked'
                        >
                          Unlink
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Fragment>
              );
            })}
          </Section>
        </div>

        <aside className='flex min-w-0 flex-col gap-4 lg:sticky lg:top-4'>
          {ready && (
            <div className='rounded-xl border bg-background p-5'>
              <h3 className='text-sm font-semibold'>Your runs in this hub receive</h3>
              <div className='mt-3 grid grid-cols-2 gap-3'>
                <div>
                  <p className='text-2xl font-semibold tabular-nums leading-none'>{pinnedCount}</p>
                  <p className='mt-1 text-xs text-muted-foreground'>pinned, in full</p>
                </div>
                <div>
                  <p className='text-2xl font-semibold tabular-nums leading-none'>{listedCount}</p>
                  <p className='mt-1 text-xs text-muted-foreground'>listed by name</p>
                </div>
              </div>
              <p className='mt-3 text-xs text-muted-foreground'>
                {pinnedCount === 0
                  ? 'Nothing is pinned. Agents choose what to open from the names alone.'
                  : 'Every run pays for pinned text before the question. Pin only what most requests need.'}
              </p>
            </div>
          )}
          <>
            {(
              [
                [
                  'Types',
                  [
                    ['Knowledge File', 'Facts about this hub. Hub admins add and edit them.'],
                    [
                      'Skill',
                      'A reusable procedure. It sits under Only you until an admin approves sharing it, then it moves to Everyone.',
                    ],
                  ],
                ],
                [
                  'Pinning',
                  [
                    ['Pin for me', 'Only your runs read it in full. Nobody else is affected.'],
                    [
                      'Pin for everyone',
                      "Every member's runs read it in full. Only hub admins can do this.",
                    ],
                    ['Not pinned', 'Agents see only the name and open it when a request needs it.'],
                  ],
                ],
              ] as const
            ).map(([group, terms]) => (
              <div key={group} className='rounded-xl border bg-background p-5 text-xs'>
                <h3 className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                  {group}
                </h3>
                <dl className='mt-2 flex flex-col gap-3'>
                  {terms.map(([term, meaning]) => (
                    <div key={term}>
                      <dt className='font-semibold'>{term}</dt>
                      <dd className='mt-0.5 text-muted-foreground'>{meaning}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </>
        </aside>

        <Dialog
          open={aiDraft !== null}
          onOpenChange={open => {
            if (!open) setAiDraft(null);
          }}
          title='Create with AI'
          className='max-w-lg'
        >
          {aiDraft && (
            <form
              className='p-6'
              onSubmit={event => {
                event.preventDefault();
                props.onCreateWithAi({
                  ...aiDraft,
                  name: aiDraft.name.trim(),
                  description: aiDraft.description.trim(),
                });
                setAiDraft(null);
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
              />
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
              />
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
                  onClick={() => setAiDraft(null)}
                  data-track-category='SdlcHub'
                  data-track-name='HubKnowledgeCreateWithAiCancelled'
                >
                  Cancel
                </Button>
                <Button
                  type='submit'
                  disabled={!aiDraft.name.trim() || !aiDraft.description.trim()}
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
          className='max-w-lg'
        >
          <div className='flex max-h-[60vh] flex-col gap-3 p-6'>
            <Input
              id='hub-knowledge-skill-search'
              autoFocus
              placeholder='Search skills'
              value={pickerQuery}
              onChange={event => setPickerQuery(event.target.value)}
            />
            <div className='min-h-0 flex-1 divide-y overflow-auto rounded-lg border'>
              {pickable.map(skill => (
                <button
                  key={skill.id}
                  type='button'
                  onClick={() => linkSkill(skill)}
                  data-track-category='SdlcHub'
                  data-track-name='HubKnowledgeSkillLinked'
                  className='flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                >
                  <span className='text-sm font-medium'>
                    {skill.name || skill.slug}
                    <span className='ml-2 text-xs font-normal text-muted-foreground'>
                      {skill.scope === 'personal' ? 'Only you' : 'Everyone'}
                    </span>
                  </span>
                  {skill.description && (
                    <span className='line-clamp-2 text-xs text-muted-foreground'>
                      {skill.description}
                    </span>
                  )}
                </button>
              ))}
              {pickable.length === 0 && (
                <p className='px-3 py-6 text-center text-sm text-muted-foreground'>
                  No skills to link.
                </p>
              )}
            </div>
          </div>
        </Dialog>
      </div>
    </>
  );
}
