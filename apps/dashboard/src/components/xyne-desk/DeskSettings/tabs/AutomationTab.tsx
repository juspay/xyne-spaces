import React, { useState } from 'react';
import { AutomationsList } from '../../../Automation/AutomationsList/AutomationsList';
import { AutomationBuilder } from '../../../Automation/AutomationBuilder/AutomationBuilder';
import { RunHistory } from '../../../Automation/AutomationRuns/RunHistory/RunHistory';
import { RunDetail } from '../../../Automation/AutomationRuns/RunDetail/RunDetail';
import { AutomationApprovalsList } from '../../../Automation/AutomationApprovalsList/AutomationApprovalsList';
import { VersionHistory } from '../../../Automation/AutomationVersions/VersionHistory/VersionHistory';
import { VersionDiffView } from '../../../Automation/AutomationVersions/VersionDiffView/VersionDiffView';
import type { Automation, AutomationRunSummary } from '../../../Automation/Automation.types';

interface AutomationTabProps {
  channelId: string;
}

type AutomationView =
  | { screen: 'list' }
  | { screen: 'approvals' }
  | {
      screen: 'builder';
      automation: Automation | null;
      approvalReviewMode?: boolean;
      /** Set when this builder is a new draft proposing a change to (or a clone of) `forkFrom`. */
      forkFrom?: Automation;
      /** Clones start an independent lineage — forks (propose-change) stay pinned to the source. */
      isClone?: boolean;
    }
  | { screen: 'runs'; automation: Automation }
  | { screen: 'run-detail'; automation: Automation; run: AutomationRunSummary }
  | { screen: 'history'; automationId: string; returnTo: Automation }
  | { screen: 'compare'; automationId: string; fromId: string; toId: string; returnTo: Automation };

export const AutomationTab: React.FC<AutomationTabProps> = ({ channelId }) => {
  const [view, setView] = useState<AutomationView>({ screen: 'list' });

  if (view.screen === 'builder') {
    const backTarget: AutomationView = view.approvalReviewMode
      ? { screen: 'approvals' }
      : view.forkFrom
        ? { screen: 'builder', automation: view.forkFrom }
        : { screen: 'list' };
    return (
      <AutomationBuilder
        key={view.automation?.id ?? `new-${view.forkFrom?.id ?? 'fresh'}`}
        automation={view.automation}
        approvalReviewMode={view.approvalReviewMode ?? false}
        {...(view.forkFrom
          ? {
              initialConfig: view.forkFrom.config,
              initialName: view.isClone
                ? `${view.forkFrom.name.slice(0, 72)} - Clone`
                : view.forkFrom.name,
              ...(view.forkFrom.description
                ? { initialDescription: view.forkFrom.description }
                : {}),
              ...(view.isClone
                ? {}
                : {
                    forkFromSeriesId: view.forkFrom.automationSeriesId ?? view.forkFrom.id,
                    forkSourceAutomationId: view.forkFrom.id,
                  }),
            }
          : {})}
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
        onShowVersionHistory={() => {
          if (view.automation) {
            setView({
              screen: 'history',
              automationId: view.automation.id,
              returnTo: view.automation,
            });
          }
        }}
        onProposeChange={source =>
          setView({ screen: 'builder', automation: null, forkFrom: source })
        }
        onCancelFork={() => {
          if (view.forkFrom) setView({ screen: 'builder', automation: view.forkFrom });
        }}
      />
    );
  }

  if (view.screen === 'approvals') {
    return <AutomationApprovalsList />;
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

  if (view.screen === 'history') {
    return (
      <VersionHistory
        automationId={view.automationId}
        onBack={() => setView({ screen: 'builder', automation: view.returnTo })}
        onOpenVersion={version => setView({ screen: 'builder', automation: version })}
        onCompare={(fromId, toId) =>
          setView({
            screen: 'compare',
            automationId: view.automationId,
            fromId,
            toId,
            returnTo: view.returnTo,
          })
        }
      />
    );
  }

  if (view.screen === 'compare') {
    return (
      <VersionDiffView
        automationId={view.automationId}
        fromId={view.fromId}
        toId={view.toId}
        onFromChange={fromId => setView({ ...view, fromId })}
        onToChange={toId => setView({ ...view, toId })}
        onClose={() =>
          setView({ screen: 'history', automationId: view.automationId, returnTo: view.returnTo })
        }
      />
    );
  }

  return (
    <AutomationsList
      initialChannelIds={[channelId]}
      onCreate={() => setView({ screen: 'builder', automation: null })}
      onOpen={automation => setView({ screen: 'builder', automation })}
      onShowRuns={automation => setView({ screen: 'runs', automation })}
      onEditFork={automation =>
        setView({ screen: 'builder', automation: null, forkFrom: automation })
      }
      onClone={automation =>
        setView({ screen: 'builder', automation: null, forkFrom: automation, isClone: true })
      }
    />
  );
};
