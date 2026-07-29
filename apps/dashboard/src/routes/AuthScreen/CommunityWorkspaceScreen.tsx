import { ReactElement, useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { ArrowRight, Building2, Clock3, Loader2, LockKeyhole, Send } from 'lucide-react';
import { CommunityJoinResultStatus, WorkspaceJoinPolicy } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';
import {
  ENTERPRISE_WORKSPACE_LOGIN_INTENT_KEY,
  PENDING_COMMUNITY_WORKSPACE_ID_KEY,
  PENDING_COMMUNITY_WORKSPACE_NAME_KEY,
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

const getWorkspaceInitials = (name: string): string => {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word.charAt(0).toUpperCase())
    .join('');

  return initials || 'CW';
};

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
    localStorage.removeItem(ENTERPRISE_WORKSPACE_LOGIN_INTENT_KEY);
    localStorage.setItem(PENDING_COMMUNITY_WORKSPACE_ID_KEY, workspace.id);
    localStorage.setItem(PENDING_COMMUNITY_WORKSPACE_NAME_KEY, workspace.name);

    if (pendingUserData || Cookies.get('user_session_id')) {
      joinCommunityWorkspace(workspace.id);
      return;
    }

    onContinueToAuth();
  };

  const isRequestToJoinWorkspace = (workspace: CommunityWorkspace): boolean =>
    workspace.joinPolicy === WorkspaceJoinPolicy.REQUEST_TO_JOIN;

  const handleContinueToEnterprise = (): void => {
    clearError();
    startEnterpriseLogin();
    localStorage.setItem(ENTERPRISE_WORKSPACE_LOGIN_INTENT_KEY, 'true');
    localStorage.removeItem(PENDING_COMMUNITY_WORKSPACE_ID_KEY);
    localStorage.removeItem(PENDING_COMMUNITY_WORKSPACE_NAME_KEY);
    onContinueToAuth();
  };

  return (
    <div className='min-h-[100dvh] bg-slate-50 text-slate-950'>
      <header className='flex h-14 w-full items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-8'>
        <div className='flex items-center gap-3'>
          <img src='/svgs/xyne.svg' alt='Xyne Logo' className='h-7 w-auto' />
          <span className='text-sm font-semibold tracking-tight text-slate-900'>Xyne Spaces</span>
        </div>
      </header>

      <main className='grid min-h-[calc(100dvh-3.5rem)] grid-cols-1 overflow-hidden lg:grid-cols-2'>
        <section className='flex min-h-0 flex-col overflow-y-auto border-r border-slate-200 bg-slate-50 px-5 py-8 sm:px-10 lg:px-12 lg:py-10'>
          <div className='mb-8'>
            <span className='text-xs font-bold uppercase tracking-[0.18em] text-blue-700'>
              Community
            </span>
            <h1 className='mt-2 text-3xl font-bold tracking-tight text-slate-950'>
              Choose your workspace
            </h1>
            <p className='mt-2 max-w-xl text-sm leading-6 text-slate-500'>
              Explore spaces, connect with communities.
            </p>
          </div>

          {communityJoinRequest ? (
            <div
              className={`mb-6 rounded-lg border p-4 ${
                communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED
                  ? 'border-red-200 bg-red-50'
                  : 'border-amber-200 bg-amber-50'
              }`}
            >
              <div className='flex items-start gap-3'>
                <Clock3
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED
                      ? 'text-red-700'
                      : 'text-amber-700'
                  }`}
                />
                <div>
                  <p
                    className={`text-sm font-semibold ${
                      communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED
                        ? 'text-red-900'
                        : 'text-amber-900'
                    }`}
                  >
                    {communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED
                      ? 'You cannot join this workspace'
                      : communityJoinRequest.isExisting
                        ? 'Request already created'
                        : 'Request submitted'}
                  </p>
                  <p
                    className={`mt-1 text-sm leading-5 ${
                      communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED
                        ? 'text-red-800'
                        : 'text-amber-800'
                    }`}
                  >
                    {communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED
                      ? 'A workspace admin rejected this access request.'
                      : communityJoinRequest.isExisting
                        ? 'Your request is already created and will be reviewed by community owners.'
                        : 'Your request has been submitted and will be reviewed by community owners.'}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className='flex flex-col gap-7'>
            {isLoadingCommunityWorkspaces ? (
              <div className='flex items-center justify-center rounded-lg border border-slate-200 bg-white py-12'>
                <Loader2 className='h-6 w-6 animate-spin text-blue-700' />
              </div>
            ) : communityError ? (
              <div className='rounded-lg border border-red-200 bg-red-50 p-4'>
                <p className='text-sm text-red-700'>{communityError}</p>
              </div>
            ) : communityOrganizations.length === 0 ? (
              <div className='rounded-lg border border-slate-200 bg-white p-6 text-center'>
                <p className='text-sm text-slate-500'>No community workspaces are available.</p>
              </div>
            ) : (
              communityOrganizations.map(org => (
                <div key={org.orgId} className='flex flex-col gap-3'>
                  <div className='border-b border-slate-200 pb-2'>
                    <p className='text-xs font-bold uppercase tracking-[0.16em] text-slate-400'>
                      {org.orgName}
                    </p>
                  </div>

                  <div className='flex flex-col gap-3'>
                    {org.workspaces.map(workspace => {
                      const isRequested =
                        communityJoinRequest?.workspaceId === workspace.id &&
                        communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_PENDING;
                      const isRejected =
                        communityJoinRequest?.workspaceId === workspace.id &&
                        communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED;
                      const isRequestToJoin = isRequestToJoinWorkspace(workspace);
                      const workspaceSubtitle =
                        workspace.description ||
                        (isRequestToJoin ? null : 'Open Community Workspace');

                      return (
                        <button
                          key={workspace.id}
                          type='button'
                          disabled={isRequested || isRejected}
                          onClick={() => handleJoinCommunityWorkspace(workspace)}
                          className='group flex min-h-20 items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-500 hover:shadow-md disabled:cursor-not-allowed disabled:border-amber-200 disabled:bg-amber-50 disabled:shadow-none'
                          data-track-category='Auth'
                          data-track-name={
                            isRequestToJoin
                              ? 'RequestCommunityWorkspaceAccess'
                              : 'JoinCommunityWorkspace'
                          }
                          data-track-metadata={JSON.stringify({
                            workspaceId: workspace.id,
                            orgId: org.orgId,
                          })}
                        >
                          <div className='flex min-w-0 items-center gap-4'>
                            <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-sm font-bold tracking-wide text-slate-700'>
                              {getWorkspaceInitials(workspace.name)}
                            </div>
                            <div className='min-w-0'>
                              <p className='truncate text-sm font-semibold text-slate-900'>
                                {workspace.name}
                              </p>
                              {workspaceSubtitle ? (
                                <p className='mt-1 flex items-center gap-2 text-xs text-slate-400'>
                                  <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                      isRequestToJoin ? 'bg-amber-500' : 'bg-emerald-500'
                                    }`}
                                  />
                                  <span className='truncate'>{workspaceSubtitle}</span>
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <span className='inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-blue-50 px-4 text-xs font-semibold text-blue-700 transition group-hover:bg-blue-700 group-hover:text-white group-disabled:bg-amber-100 group-disabled:text-amber-800'>
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
                              <>
                                Request access
                                <Send className='h-3.5 w-3.5' />
                              </>
                            ) : (
                              <>
                                Join
                                <ArrowRight className='h-3.5 w-3.5' />
                              </>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className='relative flex min-h-[420px] items-center justify-center overflow-hidden bg-slate-100 px-5 py-10 sm:px-10 lg:px-12'>
          <div className='absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [background-size:22px_22px]' />

          <div className='relative z-10 w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-xl'>
            <div className='mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700'>
              <Building2 className='h-8 w-8' />
            </div>

            <span className='block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400'>
              Enterprise
            </span>
            <h2 className='mt-2 text-2xl font-bold tracking-tight text-slate-950'>
              Join Enterprise Workspace
            </h2>
            <p className='mt-3 text-sm leading-6 text-slate-500'>
              Enter your company email to find your team&apos;s workspace, set up a new
              organization, or request to join an existing one.
            </p>

            <button
              type='button'
              onClick={handleContinueToEnterprise}
              className='mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
              data-track-category='Auth'
              data-track-name='ContinueToEnterpriseWorkspaceAuth'
            >
              Continue to Enterprise Login
              <ArrowRight className='h-4 w-4' />
            </button>

            <div className='mt-5 flex items-center justify-center gap-2 text-xs text-slate-400'>
              <LockKeyhole className='h-3.5 w-3.5' />
              <span>Managed access through organization invites and SSO</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
