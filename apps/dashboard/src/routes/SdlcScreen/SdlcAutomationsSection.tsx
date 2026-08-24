import { ReactElement, ReactNode, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { AutomationsList } from '../../components/Automation/AutomationsList/AutomationsList';
import { AutomationBuilder } from '../../components/Automation/AutomationBuilder/AutomationBuilder';
import { AutomationApprovalsList } from '../../components/Automation/AutomationApprovalsList/AutomationApprovalsList';
import { RunHistory } from '../../components/Automation/AutomationRuns/RunHistory/RunHistory';
import { RunDetail } from '../../components/Automation/AutomationRuns/RunDetail/RunDetail';
import {
  isAutomationWorkflow,
  workflowToAutomation,
} from '../../components/Automation/automation.adapter';
import {
  AutomationStatusValues,
  type Automation,
} from '../../components/Automation/Automation.types';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuthContextValues } from '../../hooks/useAuth';
import { queries } from '../../zero/queries';

export function sdlcAutomationScopesToChannel(automation: Automation, channelId: string): boolean {
  const cfg = automation.config?.trigger?.config;
  const channelIds = Array.isArray(cfg?.['channelIds']) ? (cfg['channelIds'] as string[]) : [];
  return channelIds.length === 0 || channelIds.includes(channelId);
}

/** `all` backs deep links (may be filtered out of the list); `activeCount` is the rail badge. */
export function useSdlcChannelAutomations(channelId: string | null): {
  all: Automation[];
  activeCount: number;
  isLoading: boolean;
} {
  const { workspaceId } = useAuthContextValues();
  const [rows, rowsMeta] = useCachedQuery(queries.automationsList({ workspaceId }));

  const all = useMemo(
    () => (rows ?? []).filter(isAutomationWorkflow).map(workflowToAutomation),
    [rows],
  );
  const activeCount = useMemo(
    () =>
      channelId === null
        ? 0
        : all.filter(
            a =>
              a.status === AutomationStatusValues.ACTIVE &&
              sdlcAutomationScopesToChannel(a, channelId),
          ).length,
    [all, channelId],
  );

  return { all, activeCount, isLoading: !rows || rowsMeta?.type !== 'complete' };
}

/** Omitted keys keep their current value; `null`/`false` clear them. */
export interface SdlcAutomationsNav {
  automation?: string | null;
  fork?: string | null;
  clone?: boolean;
  runs?: boolean;
  run?: string | null;
  approvals?: boolean;
}

export interface SdlcAutomationsSectionProps {
  channelId: string | null;
  automationId: string | null;
  forkFromId: string | null;
  isClone: boolean;
  showRuns: boolean;
  runId: string | null;
  showApprovals: boolean;
  onNavigate: (next: SdlcAutomationsNav) => void;
}

function Centered({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className='flex h-full min-h-[24rem] w-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
      {children}
    </div>
  );
}

export function SdlcAutomationsSection({
  channelId,
  automationId,
  forkFromId,
  isClone,
  showRuns,
  runId,
  showApprovals,
  onNavigate,
}: SdlcAutomationsSectionProps): ReactElement {
  const { all, isLoading } = useSdlcChannelAutomations(channelId);

  const filterPredicate = useCallback(
    (automation: Automation) =>
      channelId !== null && sdlcAutomationScopesToChannel(automation, channelId),
    [channelId],
  );

  // Stable identity — the builder's seeding effect depends on it.
  const scopeDefaults = useMemo(
    () => (channelId ? { channelIds: [channelId] } : undefined),
    [channelId],
  );

  const backToApprovals = useCallback(
    () => onNavigate({ automation: null, fork: null, clone: false, approvals: true }),
    [onNavigate],
  );

  const backToList = useCallback(
    () =>
      onNavigate({
        automation: null,
        fork: null,
        clone: false,
        runs: false,
        run: null,
        approvals: false,
      }),
    [onNavigate],
  );

  const isNew = automationId === 'new';
  const current = isNew ? null : (all.find(a => a.id === automationId) ?? null);
  const forkSource = forkFromId ? (all.find(a => a.id === forkFromId) ?? null) : null;

  if (!channelId) {
    return (
      <Centered>
        This repository has no linked channel yet, so there are no automations to scope to it.
      </Centered>
    );
  }

  // AutomationBuilder reads initialConfig in useState initialisers only, and the
  // key does not change when rows land — so the fork source must be resolved first.
  if (isLoading && (forkFromId || (automationId && !isNew))) {
    return (
      <Centered>
        <Loader2 className='mr-2 size-4 animate-spin' />
        Loading automations…
      </Centered>
    );
  }

  if (automationId && runId) {
    return <RunDetail runId={runId} onBack={() => onNavigate({ run: null, runs: true })} />;
  }

  if (automationId && showRuns && current) {
    return (
      <RunHistory
        automationId={current.id}
        onBack={() => onNavigate({ runs: false, run: null })}
        onOpenRun={run => onNavigate({ run: run.id, runs: false })}
      />
    );
  }

  if (automationId) {
    if (!isNew && !current) {
      return <Centered>Automation not found.</Centered>;
    }

    return (
      <AutomationBuilder
        key={isNew ? `new-${forkFromId ?? 'fresh'}` : (automationId ?? '')}
        automation={current}
        approvalReviewMode={showApprovals}
        {...(scopeDefaults ? { scopeDefaults } : {})}
        {...(isNew
          ? forkSource
            ? {
                initialConfig: forkSource.config,
                initialName: isClone ? `${forkSource.name.slice(0, 72)} - Clone` : forkSource.name,
                ...(forkSource.description ? { initialDescription: forkSource.description } : {}),
                // Clones start an independent lineage — forks stay pinned to the source.
                ...(isClone
                  ? {}
                  : {
                      forkFromSeriesId: forkSource.automationSeriesId ?? forkSource.id,
                      forkSourceAutomationId: forkSource.id,
                    }),
              }
            : {}
          : {})}
        onBack={showApprovals ? backToApprovals : backToList}
        onAfterApprovalDecision={backToApprovals}
        onSaved={result => {
          if (isNew) onNavigate({ automation: result.automation.id, fork: null, clone: false });
        }}
        onShowRuns={id => onNavigate({ automation: id, runs: true })}
        onFork={(id, mode) => onNavigate({ automation: 'new', fork: id, clone: mode === 'clone' })}
        onOpenAutomation={id => onNavigate({ automation: id, fork: null, clone: false })}
      />
    );
  }

  if (showApprovals) {
    return (
      <AutomationApprovalsList
        filterPredicate={filterPredicate}
        onBack={backToList}
        onOpenProposal={automation => onNavigate({ automation: automation.id })}
      />
    );
  }

  return (
    <AutomationsList
      filterPredicate={filterPredicate}
      onCreate={() => onNavigate({ automation: 'new' })}
      onOpen={automation => onNavigate({ automation: automation.id })}
      onShowRuns={automation => onNavigate({ automation: automation.id, runs: true })}
      onFork={(automation, mode) =>
        onNavigate({ automation: 'new', fork: automation.id, clone: mode === 'clone' })
      }
      onShowApprovals={() => onNavigate({ approvals: true })}
    />
  );
}
