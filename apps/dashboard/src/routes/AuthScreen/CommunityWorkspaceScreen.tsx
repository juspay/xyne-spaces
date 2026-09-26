import { ReactElement, useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import {
  CheckCircle2,
  Clock3,
  Loader2,
  LockKeyhole,
  MessageSquare,
  Plus,
  Users,
  XCircle,
  Zap,
} from 'lucide-react';
import { CommunityJoinResultStatus, WorkspaceJoinPolicy } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';
import { cn } from '../../utils/classNames';
import {
  PENDING_WORKSPACE_ID_KEY,
  PENDING_WORKSPACE_NAME_KEY,
  clearEnterpriseLoginIntent,
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

const SANS_FONT = "'Inter', sans-serif";

/* Reference-matched tokens (see Generate Screen Code reference). */
const REF_TEXT = '#232229';
const REF_TEXT_60 = 'rgba(35,34,41,0.6)';
const REF_TEXT_40 = 'rgba(35,34,41,0.4)';
const REF_LINE = 'rgba(35,34,41,0.1)';
const REF_RED = '#fd6b6b';
const REF_JOIN_BORDER = '#e1e7ef';

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
}

const LeftPanel = ({
  communityOrganizations,
  isLoading,
  communityError,
  communityJoinRequest,
  onJoin,
  onContinueToAuth,
}: LeftPanelProps): ReactElement => (
  <section className='flex min-h-screen w-full max-w-[720px] flex-col bg-white'>
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
    // Joining a community supersedes any earlier enterprise sign-in intent.
    clearEnterpriseLoginIntent();
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
      className='flex min-h-screen justify-center bg-white'
      style={{ fontFamily: SANS_FONT, WebkitFontSmoothing: 'antialiased' }}
    >
      <LeftPanel
        communityOrganizations={communityOrganizations}
        isLoading={isLoadingCommunityWorkspaces}
        communityError={communityError}
        communityJoinRequest={communityJoinRequest}
        onJoin={handleJoinCommunityWorkspace}
        onContinueToAuth={handleContinueWithWorkEmail}
      />
    </div>
  );
};
