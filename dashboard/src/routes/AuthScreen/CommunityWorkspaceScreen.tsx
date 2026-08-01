import { ReactElement, useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import {
  AtSign,
  Bell,
  Bookmark,
  CheckCircle2,
  Clock3,
  File,
  Hash,
  Inbox as InboxIcon,
  ListChecks,
  Layers,
  Loader2,
  Lock,
  LockKeyhole,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Smile,
  SmilePlus,
  Ticket,
  Users,
  XCircle,
  Zap,
} from 'lucide-react';
import { CommunityJoinResultStatus, WorkspaceJoinPolicy } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';
import { TicketPriorityIcon } from '../../assets/icons/TicketPriorityIcon';
import { cn } from '../../utils/classNames';
import {
  PENDING_WORKSPACE_ID_KEY,
  PENDING_WORKSPACE_NAME_KEY,
  type CommunityJoinRequestContext,
} from '../../machines/authMachine';

interface CommunityWorkspace {
  id: string;
  name: string;
  description: string | null;
  joinPolicy: string | null;
  landingChannelId: string | null;
}

interface CommunityWorkspaceOrganization {
  orgId: string;
  orgName: string;
  workspaces: CommunityWorkspace[];
}

interface CommunityWorkspaceScreenProps {
  pendingUserData: { email: string; name: string; picture?: string } | null;
  clearError: () => void;
  joinCommunityWorkspace: (workspaceId: string) => void;
  startEnterpriseLogin: () => void;
  communityJoinRequest: CommunityJoinRequestContext | null;
  onContinueToAuth: () => void;
}

/* ------------------------------------------------------------------ */
/* Design tokens — pixel-matched to the community mock.                */
/* ------------------------------------------------------------------ */

const DISPLAY_FONT = "'Inter Tight', 'Inter', sans-serif";
const SANS_FONT = "'Inter', sans-serif";
const TICKET_FONT = "'Inconsolata', monospace";

/* Reference-matched tokens (see Generate Screen Code reference). */
const REF_TEXT = '#232229';
const REF_TEXT_60 = 'rgba(35,34,41,0.6)';
const REF_TEXT_40 = 'rgba(35,34,41,0.4)';
const REF_LINE = 'rgba(35,34,41,0.1)';
const REF_RED = '#fd6b6b';
const REF_JOIN_BORDER = '#e1e7ef';
const GRID = '#e9e9ec';
const MUTED = '#98a0ad'; // timestamp gray

/* ------------------------------------------------------------------ */
/* Pure helpers.                                                       */
/* ------------------------------------------------------------------ */

/** Deterministic hue from a string, used for the avatar-stack squares. */
const hashHue = (seed: string): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
};

const AVATAR_SQUARE_COLORS = [
  '#4f7df9',
  '#a78bfa',
  '#f5b63d',
  '#34c98e',
  '#6366f1',
  '#f472b6',
] as const;

const getAvatarSquareColor = (index: number, name: string): string =>
  AVATAR_SQUARE_COLORS[(index + hashHue(name)) % AVATAR_SQUARE_COLORS.length] ?? '#4f7df9';

/* ------------------------------------------------------------------ */
/* Left column — white marketing/auth panel.                           */
/* ------------------------------------------------------------------ */

interface LeftPanelProps {
  communityOrganizations: CommunityWorkspaceOrganization[];
  isLoading: boolean;
  communityError: string;
  communityJoinRequest: CommunityJoinRequestContext | null;
  onJoin: (workspace: CommunityWorkspace) => void;
  onContinueToAuth: () => void;
  onViewAll: () => void;
}

const LeftPanel = ({
  communityOrganizations,
  isLoading,
  communityError,
  communityJoinRequest,
  onJoin,
  onContinueToAuth,
  onViewAll,
}: LeftPanelProps): ReactElement => (
  <section className='flex min-h-screen flex-col bg-white'>
    <div className='flex w-full flex-col px-[88px] py-[72px]'>
      {/* Xyne logo */}
      <header>
        <img src='/svgs/xyne.svg' alt='Xyne' style={{ width: 133, height: 27 }} />
      </header>

      {/* Onboarding card */}
      <div
        className='mt-[92px] flex flex-col items-center overflow-clip rounded-[24px] bg-white px-[20px] py-[52px] text-center'
        style={{
          boxShadow: '0px 0px 6px 0px rgba(0,0,0,0.05)',
          border: `1px solid ${REF_LINE}`,
        }}
      >
        <div className='flex flex-col items-center gap-[10px]'>
          {/* Overlapping member tiles with + */}
          <div className='flex items-center'>
            <span
              className='mr-[-5px] flex items-center justify-center rounded-[6px] text-[13.5px] font-extrabold'
              style={{
                width: 24.6,
                height: 24.6,
                background: '#6277fc',
                border: '1px solid white',
              }}
            >
              <span
                style={{
                  color: 'transparent',
                  backgroundImage:
                    'linear-gradient(to bottom, rgba(255,255,255,1), rgba(255,255,255,0.75))',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                }}
              >
                A
              </span>
            </span>
            {/* Middle Xyne red tile */}
            <span
              className='mr-[-5px] flex items-center justify-center rounded-[6px]'
              style={{
                width: 24,
                height: 24,
                background:
                  'radial-gradient(circle at 30% 20%, #faa8aa 0%, #fb898c 25%, #fd6b6f 55%, #ff4c51 100%)',
                border: '1px solid white',
                boxShadow:
                  '26.8px 24px 5px rgba(191,191,191,0), 17.2px 15.6px 4.6px rgba(191,191,191,0.01), 9.6px 8.8px 4px rgba(191,191,191,0.05), 4.4px 4px 2.8px rgba(191,191,191,0.09), 1.2px 0.8px 1.6px rgba(191,191,191,0.1)',
              }}
            >
              <svg
                viewBox='0 0 24 24'
                className='h-[13px] w-[13px]'
                fill='white'
                aria-hidden='true'
              >
                <path
                  d='M18.4 11.7 29.4 23.4h-7.5l-7.2-7.7-7.2 7.7H0l10.9-11.7L.5.6h7.5l6.6 7.1L21.3.6h7.5L18.4 11.7Z'
                  transform='scale(0.83)'
                />
              </svg>
            </span>
            <span
              className='mr-[-3px] flex items-center justify-center rounded-[6px] text-[13.5px] font-extrabold'
              style={{
                width: 24.6,
                height: 24.6,
                background: '#d673ff',
                border: '1px solid white',
              }}
            >
              <span
                style={{
                  color: 'transparent',
                  backgroundImage:
                    'linear-gradient(to bottom, rgba(255,255,255,1), rgba(255,255,255,0.75))',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                }}
              >
                U
              </span>
            </span>
            {/* + tile */}
            <span
              className='ml-[2px] flex items-center justify-center rounded-[16px] bg-[#eee]'
              style={{ width: 18, height: 18, border: '1px solid white' }}
            >
              <Plus
                className='h-[8.7px] w-[8.7px]'
                style={{ color: 'rgba(35,34,41,0.6)' }}
                strokeWidth={1.4}
              />
            </span>
          </div>

          {/* Title + subtitle */}
          <div className='flex flex-col items-center gap-[2px]'>
            <h1
              className='text-[18px] font-semibold tracking-[-0.36px]'
              style={{ color: REF_TEXT }}
            >
              Join or create workspace
            </h1>
            <p
              className='text-[14px] font-medium tracking-[-0.28px]'
              style={{ color: REF_TEXT_60 }}
            >
              A collaborative space for your team and agents
            </p>
          </div>
        </div>

        {/* Button + caption */}
        <div className='mt-[20px] flex flex-col items-center gap-[8px]'>
          <button
            type='button'
            onClick={onContinueToAuth}
            className='overflow-clip rounded-[8px] px-[12px] py-[8px] text-[15px] font-semibold leading-[1.2] text-white transition active:scale-[0.99]'
            style={{ background: REF_RED }}
            data-track-category='Auth'
            data-track-name='ContinueWithWorkEmail'
          >
            Continue with work email
          </button>
        </div>
      </div>

      {/* Divider — hairline with centered white label chip */}
      <div className='relative mt-[24px] flex items-center justify-center'>
        <span className='h-px w-full' style={{ background: REF_LINE }} />
        <span
          className='absolute bg-white px-[8px] py-[2px] text-[12px] font-medium tracking-[-0.24px]'
          style={{ color: REF_TEXT_40 }}
        >
          Explore Public Communities
        </span>
      </div>

      {/* Pending-request banner */}
      {communityJoinRequest ? (
        <div
          className={cn(
            'mt-6 flex items-start gap-3 rounded-[14px] border px-4 py-3',
            communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED
              ? 'border-red-200 bg-red-50'
              : 'border-emerald-200 bg-emerald-50',
          )}
        >
          {communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED ? (
            <XCircle className='mt-0.5 h-4 w-4 shrink-0 text-red-500' />
          ) : (
            <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-emerald-600' />
          )}
          <div>
            <p className='text-[13.5px] font-semibold text-[#111827]'>
              {communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED
                ? 'Request rejected'
                : communityJoinRequest.isExisting
                  ? 'Request already created'
                  : 'Request submitted'}
            </p>
            <p className='mt-0.5 text-[13px] leading-[1.45] text-[#3f4756]'>
              {communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED
                ? 'A workspace admin rejected this access request.'
                : communityJoinRequest.isExisting
                  ? 'Your request is already created and will be reviewed by community owners.'
                  : 'Your request has been submitted and will be reviewed by community owners.'}
            </p>
          </div>
        </div>
      ) : null}

      {/* Community list */}
      <div className='mt-[24px] flex flex-col'>
        {isLoading ? (
          <div className='flex items-center justify-center py-14'>
            <Loader2 className='h-5 w-5 animate-spin text-[#98a0ad]' />
          </div>
        ) : communityError ? (
          <p className='py-6 text-center text-[13.5px] text-[#767c8a]'>{communityError}</p>
        ) : communityOrganizations.length === 0 ? (
          <p className='py-6 text-center text-[13.5px] text-[#767c8a]'>
            No community workspaces are available.
          </p>
        ) : (
          communityOrganizations.map(org => (
            <div key={org.orgId} className='flex flex-col'>
              {org.workspaces.map(workspace => {
                const isRequested =
                  communityJoinRequest?.workspaceId === workspace.id &&
                  communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_PENDING;
                const isRejected =
                  communityJoinRequest?.workspaceId === workspace.id &&
                  communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED;
                const isRequestToJoin =
                  workspace.joinPolicy === WorkspaceJoinPolicy.REQUEST_TO_JOIN;
                const disabled = isRequested || isRejected;

                return (
                  <button
                    key={workspace.id}
                    type='button'
                    disabled={disabled}
                    onClick={() => onJoin(workspace)}
                    className={cn(
                      'group flex w-full items-center gap-[10px] bg-transparent py-[12px] text-left transition',
                      disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                    )}
                    data-track-category='Auth'
                    data-track-name={
                      isRequestToJoin ? 'RequestCommunityWorkspaceAccess' : 'JoinCommunityWorkspace'
                    }
                    data-track-metadata={JSON.stringify({
                      workspaceId: workspace.id,
                      orgId: org.orgId,
                    })}
                  >
                    {/* Icon tile — 40px rounded, tinted surface */}
                    <span
                      className='flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-white'
                      style={{
                        background: getAvatarSquareColor(
                          hashHue(workspace.name) % 6,
                          workspace.name,
                        ),
                        border: '1px solid rgba(35,34,41,0.04)',
                        boxShadow: 'inset 0 0 0 1px rgba(35,34,41,0.04)',
                      }}
                    >
                      <WorkspaceGlyph name={workspace.name} />
                    </span>

                    {/* Name + description */}
                    <span className='min-w-0 flex-1'>
                      <span
                        className='block truncate text-[14px] font-medium tracking-[-0.28px]'
                        style={{ color: REF_TEXT }}
                      >
                        {workspace.name}
                      </span>
                      <span
                        className='mt-[2px] block truncate text-[12px] tracking-[-0.24px]'
                        style={{ color: REF_TEXT_60 }}
                      >
                        {workspace.description || 'Community space'}
                      </span>
                    </span>

                    {/* Join / Request button */}
                    <span className='flex shrink-0 items-center'>
                      <span
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-[8px] bg-white px-[12px] py-[6px] text-[15px] font-medium leading-[1.2] transition',
                          disabled ? 'text-[#98a0ad]' : 'text-[#101828] group-hover:bg-[#fafbfc]',
                        )}
                        style={{ border: `1px solid ${REF_JOIN_BORDER}` }}
                      >
                        {isRejected ? (
                          <>
                            Rejected
                            <LockKeyhole className='h-3.5 w-3.5' />
                          </>
                        ) : isRequested ? (
                          <>
                            Pending
                            <Clock3 className='h-3.5 w-3.5' />
                          </>
                        ) : isRequestToJoin ? (
                          'Request to Join'
                        ) : (
                          'Join'
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {communityOrganizations.length > 0 && (
        <button
          type='button'
          onClick={onViewAll}
          className='mt-[12px] self-start text-[14px] font-semibold tracking-[-0.28px] transition hover:opacity-70'
          style={{ color: REF_TEXT_60 }}
          data-track-category='Auth'
          data-track-name='ViewAllCommunities'
        >
          View all
        </button>
      )}
    </div>
  </section>
);

/** Minimal glyph per workspace — deterministic pick from a small set. */
const WorkspaceGlyph = ({ name }: { name: string }): ReactElement => {
  const hue = hashHue(name) % 4;
  const props = { className: 'h-5 w-5', strokeWidth: 2.2 } as const;
  switch (hue) {
    case 0:
      return <MessageSquare {...props} />;
    case 1:
      return <Zap {...props} />;
    case 2:
      return <Globe2Icon {...props} />;
    default:
      return <Users {...props} />;
  }
};

/** Lucide doesn't export Globe2 — keep a local alias to avoid confusion. */
const Globe2Icon = ({
  className,
  strokeWidth,
}: {
  className?: string;
  strokeWidth?: number;
}): ReactElement => (
  <svg
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={strokeWidth ?? 2}
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
    aria-hidden='true'
  >
    <circle cx='12' cy='12' r='9' />
    <path d='M3 12h18' />
    <path d='M12 3a15.3 15.3 0 0 1 0 18' />
    <path d='M12 3a15.3 15.3 0 0 0 0 18' />
  </svg>
);

/* ------------------------------------------------------------------ */
/* Right column — floating app mock.                                   */
/* ------------------------------------------------------------------ */

/* ---------------------------- Mock atoms ---------------------------- */

const MockAvatar = ({ color, size }: { color: string; size: number }): ReactElement => (
  <span
    className='inline-block shrink-0 rounded-full'
    style={{ width: size, height: size, background: color }}
  />
);

const ReactionPill = ({
  emoji,
  count,
  active,
}: {
  emoji: string;
  count: number;
  active?: boolean;
}): ReactElement => (
  <span
    className='inline-flex items-center gap-[3px] rounded-full px-[5px] py-[2px] text-[10px] leading-[1.2] tracking-[-0.19px]'
    style={
      active
        ? { background: '#fe6d36', color: 'white', boxShadow: 'inset 0 0 0 0.75px #e8601a' }
        : { background: '#e9eef5', color: 'rgba(35,34,41,0.6)' }
    }
  >
    <span style={active ? { filter: 'grayscale(1) brightness(2.2)' } : undefined}>{emoji}</span>
    <span style={{ fontWeight: 450 }}>{count}</span>
  </span>
);

const ThreadReply = ({
  avatar,
  name,
  text,
}: {
  avatar: string;
  name: string;
  text: string;
}): ReactElement => (
  <div
    className='inline-flex max-w-full items-center gap-2 rounded-[9px] px-[10px] py-[6px]'
    style={{ background: '#f6f7fa', boxShadow: '0 0 0 1px rgba(16,24,40,0.03)' }}
  >
    <span
      className='flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white'
      style={{ background: avatar }}
    >
      {name.charAt(0)}
    </span>
    <span className='truncate text-[11.5px] text-[#3f4756]'>
      <span className='font-semibold text-[#111827]'>{name}</span>
      <span className='mx-1.5 text-[#c6c9d0]'>|</span>
      {text}
    </span>
  </div>
);

const SidebarNavItem = ({
  icon,
  label,
  active,
}: {
  icon: ReactElement;
  label: string;
  active?: boolean;
}): ReactElement => (
  <span
    className='flex h-[28px] items-center gap-2 rounded-[7px] px-2 text-[12px]'
    style={
      active ? { background: '#f3f4f7', color: '#111827', fontWeight: 500 } : { color: '#4b5262' }
    }
  >
    {icon}
    <span className='truncate'>{label}</span>
  </span>
);

/* ---------------------------- Mock pieces ---------------------------- */

/** Left slim app rail. */
const MockRail = (): ReactElement => (
  <aside
    className='flex w-[46px] shrink-0 flex-col items-center gap-[18px] border-r pb-4 pt-3'
    style={{ borderColor: GRID, background: 'transparent' }}
  >
    <span
      className='flex h-[26px] w-[26px] items-center justify-center rounded-[8px] text-white'
      style={{ background: '#111827' }}
    >
      <XyneMark className='h-3 w-3' />
    </span>

    <span className='relative'>
      <InboxIcon className='h-[17px] w-[17px] text-[#111827]' strokeWidth={1.8} />
      <span className='absolute -right-[7px] -top-[5px] flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[#f04452] px-[3px] text-[9px] font-bold text-white ring-2 ring-white'>
        2
      </span>
    </span>
    <span className='relative'>
      <Bell className='h-[17px] w-[17px] text-[#767c8a]' strokeWidth={1.8} />
      <span className='absolute -right-[7px] -top-[5px] flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[#f04452] px-[3px] text-[9px] font-bold text-white ring-2 ring-white'>
        2
      </span>
    </span>
    <span className='relative'>
      <MessageSquare className='h-[17px] w-[17px] text-[#767c8a]' strokeWidth={1.8} />
      <span className='absolute -right-[7px] -top-[5px] flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[#f04452] px-[3px] text-[9px] font-bold text-white ring-2 ring-white'>
        2
      </span>
    </span>
    <MoreHorizontal className='h-[17px] w-[17px] text-[#767c8a]' strokeWidth={1.8} />

    <span className='relative mt-auto'>
      <span
        className='flex h-[24px] w-[24px] items-center justify-center rounded-full text-[9px] font-bold text-white'
        style={{ background: '#b45309' }}
      >
        DK
      </span>
      <span className='absolute -bottom-[1px] -right-[1px] h-2 w-2 rounded-full bg-[#22c55e] ring-2 ring-white' />
    </span>
  </aside>
);

/** Inbox / channel navigation column. */
const MockSidebar = (): ReactElement => (
  <aside className='w-[196px] shrink-0 overflow-hidden' style={{ background: 'transparent' }}>
    <div className='px-[14px] pb-1 pt-[14px]'>
      <p className='text-[13.5px] font-bold text-[#111827]' style={{ fontFamily: DISPLAY_FONT }}>
        Inbox
      </p>
      <div className='mt-2 flex items-center gap-[6px]'>
        <span
          className='flex h-[28px] flex-1 items-center gap-[6px] rounded-[8px] border bg-white px-[9px] text-[11.5px] font-medium text-[#111827]'
          style={{ borderColor: '#ededf0' }}
        >
          <span className='flex h-[14px] w-[14px] items-center justify-center rounded-[4px] bg-[#f0645a] text-white'>
            <XyneMark className='h-[8px] w-[8px]' />
          </span>
          Ask Xyne
          <span className='ml-auto h-[5px] w-[5px] rounded-full bg-[#f0645a]' />
        </span>
        <span
          className='flex h-[28px] w-[28px] items-center justify-center rounded-[8px] border bg-white text-[#111827]'
          style={{ borderColor: '#ededf0' }}
        >
          <Plus className='h-[13px] w-[13px]' strokeWidth={2.2} />
        </span>
      </div>
    </div>

    <nav className='mt-1 flex flex-col gap-[1px] px-[6px]'>
      <SidebarNavItem
        icon={<Mail className='h-[13px] w-[13px] text-[#98a0ad]' strokeWidth={1.8} />}
        label='New Message'
      />
      <SidebarNavItem
        icon={<MessageSquare className='h-[13px] w-[13px] text-[#98a0ad]' strokeWidth={1.8} />}
        label='Threads'
      />
      <SidebarNavItem
        icon={<Send className='h-[13px] w-[13px] text-[#98a0ad]' strokeWidth={1.8} />}
        label='Drafts & Sent'
      />
      <SidebarNavItem
        icon={<Bookmark className='h-[13px] w-[13px] text-[#98a0ad]' strokeWidth={1.8} />}
        label='Bookmarks'
      />
      <SidebarNavItem
        icon={<ListChecks className='h-[13px] w-[13px] text-[#98a0ad]' strokeWidth={1.8} />}
        label='Recap'
      />
    </nav>

    <div className='mt-3 px-[14px]'>
      <p className='text-[10px] font-medium text-[#98a0ad]'>Channels</p>
      <div className='mt-1 flex flex-col gap-[1px]'>
        {['announcements', 'discover-xyne'].map(name => (
          <span
            key={name}
            className='flex h-[24px] items-center gap-[7px] rounded-[7px] px-1 text-[12px] text-[#4b5262]'
          >
            <Hash className='h-[12px] w-[12px] text-[#98a0ad]' strokeWidth={2} />
            {name}
          </span>
        ))}
        <span className='flex h-[24px] items-center gap-[7px] rounded-[7px] px-1 text-[12px] text-[#4b5262]'>
          <Hash className='h-[12px] w-[12px] text-[#98a0ad]' strokeWidth={2} />
          xyne-design
        </span>
        <span className='flex h-[24px] items-center gap-[7px] rounded-[7px] bg-white px-1 text-[12px] font-medium text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,0.04)]'>
          <Lock className='h-[12px] w-[12px] text-[#111827]' strokeWidth={2} />
          designteam
        </span>
        <span className='flex h-[24px] items-center gap-[7px] rounded-[7px] px-1 text-[12px] text-[#4b5262]'>
          <Hash className='h-[12px] w-[12px] text-[#98a0ad]' strokeWidth={2} />
          random
        </span>
      </div>
    </div>

    <div className='mt-3 px-[14px]'>
      <p className='text-[10px] font-medium text-[#98a0ad]'>Direct Messages</p>
      <div className='mt-1 flex flex-col gap-[1px]'>
        {[
          { name: 'Devesh Prakash', color: '#10B981' },
          { name: 'Prakhar Kothari', color: '#F59E0B' },
          { name: 'Anirudh Nair', color: '#3B82F6' },
          { name: 'Anirudh Nair', color: '#8B5CF6' },
          { name: 'Harshvardhan Agarwal', color: '#EC4899' },
        ].map(({ name, color }) => (
          <span
            key={name + color}
            className='flex h-[24px] items-center gap-[7px] rounded-[7px] px-1 text-[12px] text-[#4b5262]'
          >
            <span className='flex items-center'>
              <span className='relative flex-shrink-0' style={{ width: 18, height: 18 }}>
                <MockAvatar color={color} size={14} />
                <span className='absolute -bottom-[0.5px] -right-[0.5px] h-[5px] w-[5px] rounded-full bg-[#22c55e] ring-2 ring-white' />
              </span>
            </span>
            <span className='truncate'>{name}</span>
          </span>
        ))}
      </div>
    </div>
  </aside>
);

/** Single chat message with avatar, name, time and body. */
const MockMessage = ({
  avatar,
  initial,
  name,
  text,
}: {
  avatar: string;
  initial: string;
  name: string;
  text: ReactElement | string;
}): ReactElement => (
  <div className='flex items-start gap-[9px]'>
    <span
      className='mt-[1px] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold text-white'
      style={{ background: avatar }}
    >
      {initial}
    </span>
    <div className='min-w-0'>
      <div className='flex items-baseline gap-2'>
        <span className='text-[12.5px] font-semibold text-[#111827]'>{name}</span>
        <span className='text-[10.5px]' style={{ color: MUTED }}>
          13:05
        </span>
      </div>
      <p className='text-[12px] leading-[1.5] text-[#3f4756]'>{text}</p>
    </div>
  </div>
);

/** Chat column with header, messages and composer. */
const MockChat = (): ReactElement => (
  <div className='flex min-w-0 flex-1 flex-col bg-white'>
    {/* Channel header */}
    <div className='shrink-0 border-b' style={{ borderColor: GRID }}>
      <div className='flex h-[42px] items-center px-4'>
        <span className='flex items-center gap-[6px] text-[13px] font-semibold text-[#111827]'>
          <Lock className='h-[12px] w-[12px] text-[#98a0ad]' strokeWidth={2.2} />
          designteam
        </span>
      </div>
      <div className='flex items-center gap-[18px] px-4 pb-[10px] text-[11.5px]'>
        <span className='flex items-center gap-[6px] font-medium text-[#111827]'>
          <MessageSquare className='h-[12px] w-[12px]' strokeWidth={1.8} />
          Messages
        </span>
        <span className='flex items-center gap-[6px] text-[#8a90a0]'>
          <File className='h-[12px] w-[12px]' strokeWidth={1.8} />
          Files
        </span>
        <span className='flex items-center gap-[6px] text-[#8a90a0]'>
          <Layers className='h-[12px] w-[12px]' strokeWidth={1.8} />
          Canvas
        </span>
        <span className='flex items-center gap-[6px] text-[#8a90a0]'>
          <Ticket className='h-[12px] w-[12px]' strokeWidth={1.8} />
          Tickets
        </span>
      </div>
    </div>

    {/* Messages */}
    <div className='flex flex-col gap-[16px] overflow-hidden px-[18px] pt-[14px]'>
      <div>
        <MockMessage
          avatar='#c2410c'
          initial='D'
          name='Devesh Prakash'
          text={
            <>
              heads up, checkout button on iOS is overlapping the address field in the latest Breeze
              demo build
            </>
          }
        />
        <div className='ml-[33px] mt-[7px] flex items-center gap-[5px]'>
          <ReactionPill emoji='👍' count={3} />
          <ReactionPill emoji='👀' count={10} />
          <ReactionPill emoji='😂' count={10} active />
          <SmilePlus className='ml-[2px] h-[12px] w-[12px] text-[#98a0ad]' strokeWidth={1.8} />
        </div>
        <div className='ml-[33px] mt-[12px]'>
          <ThreadReply
            avatar='#15803d'
            name='Samit Barai'
            text='Awesome! Keep decreasing the time.'
          />
        </div>
      </div>

      <MockMessage
        avatar='#c2410c'
        initial='P'
        name='Piyush Kesharwani'
        text='oh yeah i noticed that too, only on smaller screens'
      />
    </div>

    {/* Below-card messages — intentionally sit under the floating agent card,
        peeking out faded toward the right clip, like the reference mock. */}
    <div className='flex flex-col gap-[12px] overflow-hidden px-[18px] pt-[140px]'>
      <div>
        <MockMessage
          avatar='#0e7490'
          initial='P'
          name='Prakhar Kothari'
          text='Great! Let’s aim to reduce wait times even further. This will significantly enhance the user experience. The wireframes clearly highlight this potential. I urge the team to rethink the flow and consider a more effective solution that aligns better with our goals.'
        />
        <p className='ml-[33px] mt-[6px] text-[12px] leading-[1.5] text-[#3f4756]'>
          <span
            className='mr-1 inline-flex items-center rounded-[4px] px-[5px] py-[1.5px] text-[11px] font-medium leading-[1.3] text-[#0d74ce]'
            style={{ background: '#fdf2dd' }}
          >
            @here
          </span>
          starting a collab session among us only
        </p>
      </div>

      <div>
        <MockMessage
          avatar='#0e7490'
          initial='P'
          name='Prakhar Kothari'
          text='Starting a collab session among us only to ideate and align.'
        />
        <p className='ml-[33px] mt-[6px] text-[12px] leading-[1.5] text-[#3f4756]'>
          <span
            className='mr-1 inline-flex items-center rounded-[4px] px-[5px] py-[1.5px] text-[11px] font-medium leading-[1.3] text-[#0d74ce]'
            style={{ background: '#fdf2dd' }}
          >
            @here
          </span>
          starting a collab session among us only
        </p>
        <div className='ml-[33px] mt-[8px]'>
          <ThreadReply
            avatar='#15803d'
            name='Samit Barai'
            text='Awesome! Keep decreasing the time.'
          />
        </div>
      </div>
    </div>

    {/* Spacer keeps a visible gap between the last chat and the input */}
    <div className='flex-1' />

    {/* Composer */}
    <div className='shrink-0 px-[16px] pb-[14px] pt-2'>
      <div
        className='rounded-[12px] border bg-white px-[14px] pb-[10px] pt-[12px]'
        style={{ borderColor: '#e8e9ed', boxShadow: '0 1px 6px rgba(16,24,40,0.05)' }}
      >
        <p className='text-[12.5px] text-[#3f4756]'>Hello</p>
        <div className='mt-[14px] flex items-center gap-[14px] text-[#8a90a0]'>
          <Paperclip className='h-[13px] w-[13px]' strokeWidth={1.9} />
          <Smile className='h-[13px] w-[13px]' strokeWidth={1.9} />
          <AtSign className='h-[13px] w-[13px]' strokeWidth={1.9} />
          <Hash className='h-[13px] w-[13px]' strokeWidth={1.9} />
        </div>
      </div>
    </div>
  </div>
);

/** Floating "Xyne agent" ticket card. */
const MockAgentCard = (): ReactElement => (
  <div
    className='pointer-events-auto relative w-[520px] rounded-[12px] border bg-white px-[14px] py-[7px]'
    style={{
      borderColor: '#e8e9ee',
      boxShadow: '0 6px 16px rgba(16,24,40,0.07), 0 28px 72px rgba(16,24,40,0.18)',
    }}
  >
    {/* Agent line — avatar, name, time */}
    <div className='flex items-center gap-[8px]'>
      <XyneAgentAvatar size={28} />
      <span className='shrink-0 text-[13px] font-semibold text-[#111827]'>Xyne agent</span>
      <span className='shrink-0 text-[10.5px]' style={{ color: MUTED }}>
        13:05
      </span>
    </div>
    <p className='mt-[4px] text-[12.5px] leading-[1.45] text-[#3f4756]'>
      Filed this as a bug — linked to this thread.
    </p>

    {/* Ticket capsule */}
    <div
      className='mt-[8px] rounded-[11px] border px-[12px] py-[8px]'
      style={{ borderColor: '#e8e9ed', background: '#fbfbfc' }}
    >
      <div className='flex items-center justify-between'>
        <span
          className='flex items-center gap-[7px] text-[12px] tracking-[0.04em] text-[#767c8a]'
          style={{ fontFamily: TICKET_FONT }}
        >
          <Hash className='h-[12px] w-[12px]' strokeWidth={2} />
          TICKET-482
        </span>
        <span className='flex items-center gap-[10px]'>
          <span
            className='flex h-[22px] items-center gap-[5px] rounded-full border bg-white px-[9px] text-[11px] font-medium text-[#3f4756]'
            style={{ borderColor: '#e8e9ed' }}
          >
            <CheckCircle2 className='h-[11px] w-[11px] text-[#8a90a0]' strokeWidth={2} />
            Open
          </span>
          <TicketPriorityIcon color='#f0645a' size={14} />
        </span>
      </div>
      <p className='mt-[6px] text-[12.5px] font-medium leading-[1.45] text-[#111827]'>
        Checkout CTA overlaps address field when keyboard is open.
      </p>
    </div>
    <span
      className='absolute -bottom-[13px] right-[26px] text-[#98a0ad]'
      style={{ transform: 'rotate(-15deg)' }}
    >
      <HandCursorIcon />
    </span>
  </div>
);

const HandCursorIcon = (): ReactElement => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.5'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <path d='M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2' />
    <path d='M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v6' />
    <path d='M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8' />
    <path d='M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15' />
  </svg>
);

/* ------------------------------ Panel ------------------------------ */

const RightPanel = (): ReactElement => (
  <section
    className='relative hidden min-h-screen lg:block'
    style={{ background: 'linear-gradient(180deg,#f0f2f5 0%,#eceef2 55%,#e9ebef 100%)' }}
    aria-hidden='true'
  >
    <div className='absolute bottom-0 right-0 top-[110px] w-[calc(100%-132px)] overflow-hidden'>
      {/* App window — flush right, submerged past the section's bottom edge */}
      <div
        className='absolute inset-x-0 top-0 flex overflow-hidden rounded-tl-[16px]'
        style={{
          height: 'min(780px, calc(100% + 120px))',
          boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 24px 70px rgba(16,24,40,0.12)',
        }}
      >
        {/* Sidebar group — gray surface, holds the browser chrome */}
        <div className='flex h-full shrink-0 flex-col' style={{ background: '#f7f8fa' }}>
          {/* Browser chrome */}
          <div className='relative flex h-[42px] shrink-0 items-center px-4'>
            <span className='flex items-center gap-[6px]'>
              <span className='h-[10px] w-[10px] rounded-full bg-[#ff5f57]' />
              <span className='h-[10px] w-[10px] rounded-full bg-[#febc2e]' />
              <span className='h-[10px] w-[10px] rounded-full bg-[#28c840]' />
            </span>
            <span className='absolute left-1/2 flex -translate-x-1/2 items-center gap-3 text-[#98a0ad]'>
              <ChevronLeftMini />
              <ChevronRightMini />
              <Search className='h-[13px] w-[13px]' strokeWidth={2} />
            </span>
          </div>

          <div className='flex min-h-0 flex-1'>
            <MockRail />
            <MockSidebar />
          </div>
        </div>

        {/* Chat column — white, rounded top-left corner overlapping the gray */}
        <div className='relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-[14px] bg-white'>
          <MockChat />

          {/* Right clip fade */}
          <div
            className='pointer-events-none absolute inset-y-0 right-0 w-[210px]'
            style={{
              background:
                'linear-gradient(to right, rgba(255,255,255,0), rgba(255,255,255,0.98) 62%)',
            }}
          />

          {/* Bottom fade */}
          <div
            className='pointer-events-none absolute inset-x-0 bottom-0 h-24'
            style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0), #ffffff 88%)' }}
          />
        </div>
      </div>

      {/* Floating agent card — centered horizontally, nudged up, never clipped */}
      <div className='pointer-events-none absolute inset-x-0 top-[29%] z-30 flex justify-center pl-[64px]'>
        <MockAgentCard />
      </div>
    </div>
  </section>
);

/* Mini chevrons for the mock browser chrome. */
const ChevronLeftMini = (): ReactElement => (
  <svg
    viewBox='0 0 24 24'
    className='h-3.5 w-3.5 text-[#98a0ad]'
    fill='none'
    stroke='currentColor'
    strokeWidth='2.4'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <path d='m14 18-6-6 6-6' />
  </svg>
);
const ChevronRightMini = (): ReactElement => (
  <svg
    viewBox='0 0 24 24'
    className='h-3.5 w-3.5 text-[#98a0ad]'
    fill='none'
    stroke='currentColor'
    strokeWidth='2.4'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <path d='m10 18 6-6-6-6' />
  </svg>
);

/** Geometric X mark used in the mock rail + Xyne agent avatar. */
const XyneMark = ({ className = 'h-3.5 w-3.5' }: { className?: string }): ReactElement => (
  <svg viewBox='0 0 24 24' className={className} fill='currentColor' aria-hidden='true'>
    <path
      d='M18.4 11.7 29.4 23.4h-7.5l-7.2-7.7-7.2 7.7H0l10.9-11.7L.5.6h7.5l6.6 7.1L21.3.6h7.5L18.4 11.7Z'
      transform='scale(0.83)'
    />
  </svg>
);

/** Xyne agent avatar — rounded coral tile with a white "x" mark, as in the design. */
const XyneAgentAvatar = ({ size = 28 }: { size?: number }): ReactElement => (
  <span
    className='flex shrink-0 items-center justify-center rounded-[9px]'
    style={{
      width: size,
      height: size,
      background: 'linear-gradient(180deg,#f56b64 0%,#f0564f 100%)',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06), 0 1px 2px rgba(240,86,79,0.35)',
    }}
  >
    <svg
      viewBox='0 0 24 24'
      width={size * 0.6}
      height={size * 0.6}
      fill='none'
      stroke='white'
      strokeWidth='2.4'
      strokeLinecap='round'
      aria-hidden='true'
    >
      <path d='M7 7l10 10M17 7L7 17' />
    </svg>
  </span>
);

/* ------------------------------------------------------------------ */
/* Screen.                                                             */
/* ------------------------------------------------------------------ */

export const CommunityWorkspaceScreen = ({
  pendingUserData,
  clearError,
  joinCommunityWorkspace,
  startEnterpriseLogin,
  communityJoinRequest,
  onContinueToAuth,
}: CommunityWorkspaceScreenProps): ReactElement => {
  const [communityOrganizations, setCommunityOrganizations] = useState<
    CommunityWorkspaceOrganization[]
  >([]);
  const [isLoadingCommunityWorkspaces, setIsLoadingCommunityWorkspaces] = useState(false);
  const [communityError, setCommunityError] = useState('');

  useEffect(() => {
    let isCancelled = false;
    setIsLoadingCommunityWorkspaces(true);
    setCommunityError('');

    apiInstance
      .get<{ organizations: CommunityWorkspaceOrganization[] }>('/community/workspaces')
      .then(response => {
        if (isCancelled) return;
        setCommunityOrganizations(response.data.organizations || []);
      })
      .catch(() => {
        if (isCancelled) return;
        setCommunityError('Community workspaces are unavailable right now.');
      })
      .finally(() => {
        if (isCancelled) return;
        setIsLoadingCommunityWorkspaces(false);
      });

    return (): void => {
      isCancelled = true;
    };
  }, []);

  const handleJoinCommunityWorkspace = (workspace: CommunityWorkspace): void => {
    clearError();
    localStorage.setItem(PENDING_WORKSPACE_ID_KEY, workspace.id);
    localStorage.setItem(PENDING_WORKSPACE_NAME_KEY, workspace.name);

    if (pendingUserData || Cookies.get('user_session_id')) {
      joinCommunityWorkspace(workspace.id);
      return;
    }

    onContinueToAuth();
  };

  const handleContinueWithWorkEmail = (): void => {
    clearError();
    startEnterpriseLogin();
    localStorage.removeItem(PENDING_WORKSPACE_ID_KEY);
    localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
    onContinueToAuth();
  };

  return (
    <div
      className='grid min-h-screen grid-cols-[1.02fr_1fr]'
      style={{ fontFamily: SANS_FONT, WebkitFontSmoothing: 'antialiased' }}
    >
      <LeftPanel
        communityOrganizations={communityOrganizations}
        isLoading={isLoadingCommunityWorkspaces}
        communityError={communityError}
        communityJoinRequest={communityJoinRequest}
        onJoin={handleJoinCommunityWorkspace}
        onContinueToAuth={handleContinueWithWorkEmail}
        onViewAll={() => {
          const list = document.getElementById('community-workspace-list');
          list?.scrollIntoView({ behavior: 'smooth' });
        }}
      />
      <RightPanel />
    </div>
  );
};
