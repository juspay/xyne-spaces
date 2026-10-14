import { ReactElement, useMemo } from 'react';
import { ArrowRight } from '@xyne/icons';
import { Check, Loader2 } from 'lucide-react';
import { useClawMcp } from '../../hooks/useClawMcp';
import type { McpServer } from '../../services/claw/clawMcpTypes';
import { McpLogo } from '../AIScreen/library/shared/pickers/mcp/McpLogo';
import { connectStrategyFor } from '../AIScreen/library/shared/pickers/mcp/mcpConnectionService';
import { useMcpConnect } from '../AIScreen/library/shared/pickers/mcp/useMcpConnect';

interface OnboardingAppDefinition {
  type: string;
  label: string;
  blurb: string;
}

const ONBOARDING_APPS: readonly OnboardingAppDefinition[] = [
  { type: 'github-remote', label: 'GitHub', blurb: 'Repositories, issues and pull requests' },
  { type: 'slack-remote', label: 'Slack', blurb: 'Search and read your conversations' },
  { type: 'notion-remote', label: 'Notion', blurb: 'Pages, databases and docs' },
  { type: 'linear', label: 'Linear', blurb: 'Issues, projects and cycles' },
  { type: 'atlassian-remote', label: 'Jira & Confluence', blurb: 'Issues and pages' },
];

export interface OnboardingApp extends OnboardingAppDefinition {
  server: McpServer;
  connected: boolean;
}

/**
 * The onboarding apps that can be connected in this environment. A connector is
 * listed only when claw-auth has it as an enabled OAuth server, so one whose
 * client credentials are not configured simply doesn't appear.
 */
export const useOnboardingApps = (): { apps: OnboardingApp[]; isLoading: boolean } => {
  const mcp = useClawMcp();

  const apps = useMemo(() => {
    const servers = mcp.data?.servers ?? [];
    const connectedServerIds = new Set(
      (mcp.data?.connections ?? []).map(connection => connection.mcpServerId),
    );
    const orgCoveredServerIds = new Set(
      (mcp.data?.availability ?? [])
        .filter(entry => entry.org && !entry.personal)
        .map(entry => entry.mcpServerId),
    );

    return ONBOARDING_APPS.flatMap((definition): OnboardingApp[] => {
      const server = servers.find(candidate => candidate.type === definition.type);
      if (!server || server.enabled === false || connectStrategyFor(server) !== 'oauth') return [];
      return [
        {
          ...definition,
          server,
          connected: connectedServerIds.has(server.id) || orgCoveredServerIds.has(server.id),
        },
      ];
    });
  }, [mcp.data]);

  return { apps, isLoading: mcp.isLoading };
};

export type OAuthReturnResults = Record<string, 'connected' | 'error'>;

/**
 * claw-auth sends the browser back with `?<type>_connected=true` or
 * `?<type>_error=<reason>`. Pure read, so it is safe to call from a state
 * initializer; `clearOAuthReturnParams` strips them afterwards.
 */
export const readOAuthReturnParams = (): OAuthReturnResults => {
  const results: OAuthReturnResults = {};
  try {
    for (const [key] of new URLSearchParams(window.location.search)) {
      if (key.endsWith('_connected')) results[key.slice(0, -'_connected'.length)] = 'connected';
      else if (key.endsWith('_error')) results[key.slice(0, -'_error'.length)] = 'error';
    }
  } catch {
    // Unparseable query string: treat as no result
  }
  return results;
};

export const clearOAuthReturnParams = (): void => {
  try {
    const url = new URL(window.location.href);
    const stale = [...url.searchParams.keys()].filter(
      key => key.endsWith('_connected') || key.endsWith('_error'),
    );
    if (stale.length === 0) return;
    for (const key of stale) url.searchParams.delete(key);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Best-effort cleanup
  }
};

const ConnectAppRow = ({
  app,
  result,
}: {
  app: OnboardingApp;
  result: OAuthReturnResults[string] | undefined;
}): ReactElement => {
  const connect = useMcpConnect(app.server, () => undefined);
  const failed = result === 'error' && !app.connected;

  return (
    <div className='flex w-full items-center gap-3 rounded-[9px] border border-[#DDE3EC] bg-white px-[14px] py-[12px]'>
      <McpLogo type={app.type} name={app.label} size='md' />
      <span className='min-w-0 flex-1'>
        <span className='block text-[14px] leading-[20px] font-semibold text-[#272B35]'>
          {app.label}
        </span>
        <span className='block truncate text-[12px] leading-[18px] text-[#8E939D]'>
          {connect.error ? (
            <span role='alert' className='text-[#D8453F]'>
              {connect.error}
            </span>
          ) : failed ? (
            <span role='alert' className='text-[#D8453F]'>
              Couldn&apos;t connect. Try again.
            </span>
          ) : (
            app.blurb
          )}
        </span>
      </span>
      {app.connected ? (
        <span className='flex shrink-0 items-center gap-1.5 text-[13px] leading-none text-[#3F9E6B]'>
          <Check className='size-4' strokeWidth={2.5} />
          Connected
        </span>
      ) : (
        <button
          type='button'
          onClick={() => connect.connect({})}
          disabled={connect.isPending}
          className='inline-flex h-[32px] min-w-[84px] shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-[#DDE3EC] bg-white px-3 text-[14px] leading-none text-[#272B35] transition-colors hover:bg-[#F8FAFC] disabled:opacity-50'
          data-track-category='Questionnaire'
          data-track-name='ConnectApp'
          data-track-metadata={JSON.stringify({ type: app.type })}
        >
          {connect.isPending ? <Loader2 className='size-4 animate-spin' /> : 'Connect'}
        </button>
      )}
    </div>
  );
};

interface PanelProps {
  apps: OnboardingApp[];
  results: OAuthReturnResults;
  onBack: () => void;
  onNext: () => void;
}

export const ConnectAppsStepPanel = ({
  apps,
  results,
  onBack,
  onNext,
}: PanelProps): ReactElement => {
  const anyConnected = apps.some(app => app.connected);

  return (
    <div className='flex-1 flex flex-col justify-center max-w-[520px] w-full md:absolute md:left-12 lg:left-16 md:top-[276px] md:bottom-[38px] md:w-[calc(100%_-_96px)] md:max-w-[600px] md:justify-start'>
      <h1 className='text-[28px] leading-[34px] font-bold text-[#242936]'>
        Connect the tools you use
      </h1>
      <p className='mt-2 text-[14px] leading-[22px] text-[#777B85]'>
        Let your agents search and work in the tools you already use. Each one asks for your
        permission, and everything runs as you.
      </p>

      <div className='mt-[28px] h-px w-full bg-[#ECEFF3]' />

      <div className='mt-[28px] flex flex-col gap-3'>
        {apps.map(app => (
          <ConnectAppRow key={app.type} app={app} result={results[app.type]} />
        ))}
      </div>

      <div className='mt-auto mb-4 md:mb-0 flex items-center gap-5 pt-6'>
        <button
          type='button'
          onClick={onBack}
          className='text-[14px] text-[#8E939D] hover:text-[#272B35] transition-colors'
          data-track-category='Questionnaire'
          data-track-name='ConnectAppsBack'
        >
          Back
        </button>
        <button
          type='button'
          onClick={onNext}
          className='inline-flex h-[48px] items-center gap-2.5 px-5 bg-[#FF6868] text-white text-[15px] font-semibold rounded-[10px] hover:bg-[#FF5A5A] transition-colors'
          data-track-category='Questionnaire'
          data-track-name={anyConnected ? 'ConnectAppsNext' : 'ConnectAppsSkip'}
        >
          {anyConnected ? 'Next' : 'Skip for now'}
          <ArrowRight className='w-4 h-4' />
        </button>
      </div>

      <p className='mt-[18px] text-[12px] leading-[18px] text-[#9399A6]'>
        You can connect more any time in AI → Library.
      </p>
    </div>
  );
};

export const ConnectAppsPreview = ({ apps }: { apps: OnboardingApp[] }): ReactElement => (
  <div className='w-[368px] rounded-[16px] border border-[#E2E5EA] bg-white shadow-[0_18px_38px_rgba(27,36,52,0.13)] overflow-hidden'>
    <div className='h-[48px] flex items-center justify-center border-b border-[#EFF2F6]'>
      <div className='w-[86px] h-[20px] rounded-full border border-[#E5EAF0] bg-[#F3F5F8] shadow-[inset_0_1px_3px_rgba(20,31,48,0.08)]' />
    </div>

    <div className='px-[26px] pb-[28px] pt-[26px]'>
      <p className='text-[15px] leading-[20px] font-semibold text-[#242936]'>Your tools</p>
      <p className='mt-1 text-[13px] leading-[18px] text-[#9399A6]'>
        Available to your agents in Xyne
      </p>

      <ul className='mt-[18px] flex flex-col gap-[10px]'>
        {apps.map(app => (
          <li
            key={app.type}
            className='flex items-center gap-3 rounded-[10px] border border-[#E7EBF1] bg-[#F8FAFD] px-[12px] py-[10px]'
          >
            <McpLogo type={app.type} name={app.label} size='sm' />
            <span className='flex-1 truncate text-[14px] leading-[20px] text-[#272B35]'>
              {app.label}
            </span>
            {app.connected ? (
              <span className='flex items-center gap-1.5 text-[12px] leading-none text-[#5C9E7A]'>
                <span className='size-1.5 rounded-full bg-[#5C9E7A]' />
                Connected
              </span>
            ) : (
              <span className='text-[12px] leading-none text-[#B2B6BE]'>Not connected</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  </div>
);
