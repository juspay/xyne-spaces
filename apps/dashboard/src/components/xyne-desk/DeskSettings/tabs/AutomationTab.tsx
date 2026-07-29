import React, { useCallback, useState } from 'react';
import { AutomationsList } from '../../../Automation/AutomationsList/AutomationsList';
import { AutomationBuilder } from '../../../Automation/AutomationBuilder/AutomationBuilder';
import { RunHistory } from '../../../Automation/AutomationRuns/RunHistory/RunHistory';
import { RunDetail } from '../../../Automation/AutomationRuns/RunDetail/RunDetail';
import { AutomationApprovalsList } from '../../../Automation/AutomationApprovalsList/AutomationApprovalsList';
import type { Automation, AutomationRun } from '../../../Automation/Automation.types';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface AutomationTabProps {
  channelId: string;
  form: DeskSettingsForm;
}

type AutomationView =
  | { screen: 'list' }
  | { screen: 'approvals' }
  | { screen: 'builder'; automation: Automation | null; approvalReviewMode?: boolean }
  | { screen: 'runs'; automation: Automation }
  | { screen: 'run-detail'; automation: Automation; run: AutomationRun };

function automationScopesToChannel(
  automation: Automation,
  channelId: string,
  boardId: string | null,
): boolean {
  const cfg = automation.config?.trigger?.config;
  const channelIds = Array.isArray(cfg?.['channelIds']) ? (cfg['channelIds'] as string[]) : [];
  const boardIds = Array.isArray(cfg?.['boardIds']) ? (cfg['boardIds'] as string[]) : [];
  const channelMatch = channelIds.length === 0 || channelIds.includes(channelId);
  const boardMatch = boardIds.length === 0 || (boardId !== null && boardIds.includes(boardId));
  return channelMatch && boardMatch;
}

export const AutomationTab: React.FC<AutomationTabProps> = ({ channelId, form }) => {
  const { boardId } = form;
  const [view, setView] = useState<AutomationView>({ screen: 'list' });

  const filterPredicate = useCallback(
    (automation: Automation) => automationScopesToChannel(automation, channelId, boardId),
    [channelId, boardId],
  );

  if (view.screen === 'builder') {
    const backTarget: AutomationView = view.approvalReviewMode
      ? { screen: 'approvals' }
      : { screen: 'list' };
    return (
      <AutomationBuilder
        key={view.automation?.id ?? 'new'}
        automation={view.automation}
        approvalReviewMode={view.approvalReviewMode ?? false}
        onBack={() => setView(backTarget)}
        onAfterApprovalDecision={() => setView({ screen: 'approvals' })}
        onSaved={result => {
          if (!view.automation) {
            setView({ screen: 'list' });
            return;
          }
          setView({ screen: 'builder', automation: result.automation });
        }}
        onShowRuns={() => {
          if (view.automation) setView({ screen: 'runs', automation: view.automation });
        }}
      />
    );
  }

  if (view.screen === 'approvals') {
    return <AutomationApprovalsList filterPredicate={filterPredicate} />;
  }

  if (view.screen === 'runs') {
    return (
      <RunHistory
        automationId={view.automation.id}
        onBack={() => setView({ screen: 'builder', automation: view.automation })}
        onOpenRun={run => setView({ screen: 'run-detail', automation: view.automation, run })}
      />
    );
  }

  if (view.screen === 'run-detail') {
    return (
      <RunDetail
        runId={view.run.id}
        onBack={() => setView({ screen: 'runs', automation: view.automation })}
      />
    );
  }

  return (
    <AutomationsList
      filterPredicate={filterPredicate}
      onCreate={() => setView({ screen: 'builder', automation: null })}
      onOpen={automation => setView({ screen: 'builder', automation })}
      onShowRuns={automation => setView({ screen: 'runs', automation })}
    />
  );
};
