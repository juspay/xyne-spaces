import { ReactElement, useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Loader2,
  LockKeyhole,
  MessageSquare,
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

/* Tokens matched to the "Join Xyne Community" mock. */
const REF_TEXT = '#16161A';
const REF_MUTED = '#63636B';
const REF_ACCENT = '#C92F35';
const REF_PAGE_BG = '#F4F4F5';
const REF_CARD_BORDER = '#E4E4E7';
const REF_DIVIDER = '#DCDCE0';

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
/* Join panel — featured community card + work-email row.              */
/* ------------------------------------------------------------------ */

const WORK_EMAIL_TILES = [
  { letter: 'A', background: '#2F5BD3' },
  { letter: 'X', background: '#E0393E' },
  { letter: 'U', background: '#7C3AED' },
] as const;

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
}: LeftPanelProps): ReactElement => {
  // For now there is a single public community — feature the first one in the card.
  const featuredOrg = communityOrganizations.find(org => org.workspaces.length > 0);
  const featuredWorkspace = featuredOrg?.workspaces[0];

  const isRequested =
    !!featuredWorkspace &&
    communityJoinRequest?.workspaceId === featuredWorkspace.id &&
    communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_PENDING;
  const isRejected =
    !!featuredWorkspace &&
    communityJoinRequest?.workspaceId === featuredWorkspace.id &&
    communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED;
  const isRequestToJoin = featuredWorkspace?.joinPolicy === WorkspaceJoinPolicy.REQUEST_TO_JOIN;
  const joinDisabled = isRequested || isRejected;
  const description = featuredWorkspace?.description?.trim();

  return (
    <section className='flex w-full max-w-[560px] flex-col gap-[28px]'>
      {/* Logo + heading */}
      <header className='flex flex-col items-center gap-[14px] text-center'>
        <img src='/svgs/xyne.svg' alt='Xyne' className='h-[40px] w-auto' />
        <p className='text-[16px]' style={{ color: '#55555C' }}>
          Join the community or start a workspace for your team
        </p>
      </header>

      {/* Primary: community card */}
      <div
        className='flex flex-col items-center gap-[20px] rounded-[20px] bg-white px-[32px] pb-[28px] pt-[36px] text-center'
        style={{
          border: `1px solid ${REF_CARD_BORDER}`,
          boxShadow: '0 12px 40px rgba(22,22,26,0.07)',
        }}
      >
        {isLoading ? (
          <Loader2 className='h-5 w-5 animate-spin text-[#98a0ad]' />
        ) : communityError ? (
          <p className='text-[14px]' style={{ color: REF_MUTED }}>
            {communityError}
          </p>
        ) : !featuredOrg || !featuredWorkspace ? (
          <p className='text-[14px]' style={{ color: REF_MUTED }}>
            No community workspaces are available.
          </p>
        ) : (
          <>
            <span
              className='flex h-[60px] w-[60px] items-center justify-center rounded-[16px] text-white'
              style={{
                background: getAvatarSquareColor(
                  hashHue(featuredWorkspace.name) % 6,
                  featuredWorkspace.name,
                ),
              }}
            >
              <WorkspaceGlyph name={featuredWorkspace.name} className='h-7 w-7' strokeWidth={2} />
            </span>

            <div className='flex flex-col gap-[6px]'>
              <h1
                className='text-[26px] font-extrabold tracking-[-0.5px]'
                style={{ color: REF_TEXT }}
              >
                {featuredWorkspace.name}
              </h1>
              <span className='text-[15px]' style={{ color: REF_MUTED }}>
                Community space
              </span>
            </div>

            {description && description.toLowerCase() !== 'community space' ? (
              <p className='max-w-[400px] text-[15px] leading-[1.55]' style={{ color: '#3F3F46' }}>
                {description}
              </p>
            ) : null}

            <button
              type='button'
              disabled={joinDisabled}
              onClick={() => onJoin(featuredWorkspace)}
              className={cn(
                'mt-[4px] flex w-full items-center justify-center gap-[10px] rounded-[12px] px-[24px] py-[16px] text-[17px] font-bold text-white transition hover:brightness-95 active:scale-[0.99]',
                joinDisabled && 'cursor-not-allowed opacity-70 hover:brightness-100',
              )}
              style={{ background: REF_ACCENT }}
              data-track-category='Auth'
              data-track-name={
                isRequestToJoin ? 'RequestCommunityWorkspaceAccess' : 'JoinCommunityWorkspace'
              }
              data-track-metadata={JSON.stringify({
                workspaceId: featuredWorkspace.id,
                orgId: featuredOrg.orgId,
              })}
            >
              {isRejected ? (
                <>
                  Request rejected
                  <LockKeyhole className='h-[18px] w-[18px]' />
                </>
              ) : isRequested ? (
                <>
                  Request pending
                  <Clock3 className='h-[18px] w-[18px]' />
                </>
              ) : (
                <>
                  {isRequestToJoin ? 'Request to join' : 'Join community'}
                  <ArrowRight className='h-[18px] w-[18px]' strokeWidth={2.4} />
                </>
              )}
            </button>

            {!isRequestToJoin && !joinDisabled ? (
              <span className='text-[13px]' style={{ color: REF_MUTED }}>
                Free to join
              </span>
            ) : null}
          </>
        )}
      </div>

      {/* Pending-request banner */}
      {communityJoinRequest ? (
        <div
          className={cn(
            'flex items-start gap-3 rounded-[14px] border px-4 py-3',
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

      {/* Divider */}
      <div className='flex items-center gap-[14px] text-[13px]' style={{ color: REF_MUTED }}>
        <span className='h-px flex-1' style={{ background: REF_DIVIDER }} />
        Or use your work email
        <span className='h-px flex-1' style={{ background: REF_DIVIDER }} />
      </div>

      {/* Secondary: workspace row */}
      <div
        className='flex flex-wrap items-center gap-[16px] rounded-[16px] bg-white px-[20px] py-[18px]'
        style={{ border: `1px solid ${REF_CARD_BORDER}` }}
      >
        <span className='flex shrink-0'>
          {WORK_EMAIL_TILES.map((tile, index) => (
            <span
              key={tile.letter}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-[8px] border-2 border-white text-[14px] font-extrabold text-white',
                index > 0 && 'ml-[-8px]',
              )}
              style={{ background: tile.background }}
            >
              {tile.letter}
            </span>
          ))}
        </span>
        <div className='flex min-w-0 flex-[1_1_200px] flex-col gap-[3px]'>
          <strong className='text-[15px] font-bold' style={{ color: REF_TEXT }}>
            Join or create workspace
          </strong>
          <span className='text-[13px] leading-[1.45]' style={{ color: REF_MUTED }}>
            A private Xyne workspace to try with your team
          </span>
        </div>
        <button
          type='button'
          onClick={onContinueToAuth}
          className='mx-auto shrink-0 rounded-[10px] bg-white px-[16px] py-[12px] text-[14px] font-bold transition hover:bg-[#fafafa] active:scale-[0.99]'
          style={{ color: REF_TEXT, border: '1px solid #CFCFD4' }}
          data-track-category='Auth'
          data-track-name='ContinueWithWorkEmail'
        >
          Continue with work email
        </button>
      </div>
    </section>
  );
};

/** Minimal glyph per workspace — deterministic pick from a small set. */
const WorkspaceGlyph = ({
  name,
  className = 'h-5 w-5',
  strokeWidth = 2.2,
}: {
  name: string;
  className?: string;
  strokeWidth?: number;
}): ReactElement => {
  const hue = hashHue(name) % 4;
  const props = { className, strokeWidth };
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
      className='flex min-h-screen flex-col items-center justify-center px-[20px] py-[48px]'
      style={{ fontFamily: SANS_FONT, WebkitFontSmoothing: 'antialiased', background: REF_PAGE_BG }}
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
