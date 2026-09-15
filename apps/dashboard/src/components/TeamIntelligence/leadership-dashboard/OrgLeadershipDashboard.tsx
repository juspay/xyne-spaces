import {
  ActivityIcon,
  AlertTriangleIcon,
  FlameIcon,
  NetworkIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TargetIcon,
  UsersIcon,
  ZapIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import type { OrgLeadershipSummary } from '@/services/TeamIntelligence/teamIntelligenceService';
import type { SectionRequest } from './leadershipDashboardTypes';
import { executiveNarrative, formatLabel, momentumTone } from './leadershipDashboardUtils';
import { EmptyState, ErrorState, LoadingState, SignalStrip } from './LeadershipDashboardPrimitives';
import {
  PaginatedItemSection,
  PaginatedTextSection,
  Section,
  SnapshotShell,
} from './LeadershipDashboardSections';

export const OrgLeadershipDashboard = ({
  snapshot,
  isLoading,
  isError,
  sectionRequest,
}: {
  snapshot: { summary: OrgLeadershipSummary; completedAt: string | null } | null;
  isLoading: boolean;
  isError: boolean;
  sectionRequest: SectionRequest;
}): ReactElement => {
  if (isLoading) return <LoadingState label='Loading founder brief...' />;
  if (isError) return <ErrorState label='Could not load the organization brief.' />;
  if (!snapshot) {
    return (
      <EmptyState
        title='No organization brief yet'
        text='No completed organization leadership snapshot exists for this range.'
      />
    );
  }

  const { summary } = snapshot;
  const operational = summary.operationalSnapshot;
  const narrative = executiveNarrative(summary.executiveSummary);

  return (
    <SnapshotShell
      scope='org'
      title='Leadership Brief'
      eyebrow={`${summary.organization.teamCount} teams · ${summary.organization.memberCount} members represented`}
      reportDate={summary.reportDate}
      confidence={summary.overallConfidence}
      momentum={summary.executiveSummary.momentum}
      narrative={narrative}
      sectionRequest={sectionRequest}
    >
      <SignalStrip
        signals={[
          {
            label: 'Momentum',
            value: formatLabel(operational.momentumAndDirection.momentum),
            description: operational.momentumAndDirection.assessment,
            tone: momentumTone(operational.momentumAndDirection.momentum),
            icon: ActivityIcon,
            targetId: 'org-portfolio-of-bets',
          },
          {
            label: 'Critical Work',
            value: `${operational.criticalAndMoving.length} active signals`,
            description: 'Initiatives the organization cannot afford to let drift.',
            tone: operational.criticalAndMoving.length > 0 ? 'accent' : 'neutral',
            icon: FlameIcon,
            targetId: 'org-founder-agenda',
          },
          {
            label: 'Open Blockers',
            value: `${operational.needsUnblocking.length} require attention`,
            description: 'Cross-team or leadership-level blockers surfaced by the model.',
            tone: operational.needsUnblocking.length > 0 ? 'warn' : 'good',
            icon: ShieldAlertIcon,
            targetId: 'org-cannot-deadlock',
          },
          {
            label: 'Coverage',
            value: `${summary.processingCoverage.completedTeamSummaries}/${summary.processingCoverage.expectedTeams} teams`,
            description: 'Completed team summaries included in this brief.',
            tone: summary.processingCoverage.failedTeamSummaries > 0 ? 'warn' : 'good',
            icon: UsersIcon,
            targetId: 'org-leadership-leverage',
          },
        ]}
      />

      <Section
        id='org-founder-agenda'
        icon={TargetIcon}
        title='Founder Agenda'
        eyebrow='Immediate leverage'
        tone='accent'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='founder-agenda'
          emptyTitle='No direct founder asks'
          emptyText='The snapshot did not surface immediate leadership actions.'
        />
      </Section>

      <Section
        id='org-portfolio-of-bets'
        icon={SparklesIcon}
        title='Portfolio Of Bets'
        eyebrow='Where the company is moving'
        tone='info'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='portfolio-of-bets'
          emptyTitle='No portfolio bets found'
          emptyText='The snapshot did not identify explicit organization-level bets.'
        />
      </Section>

      <Section
        id='org-cannot-deadlock'
        icon={AlertTriangleIcon}
        title='Cannot Deadlock'
        eyebrow='Critical intervention points'
        tone='danger'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='cannot-deadlock'
          emptyTitle='No deadlock risks surfaced'
          emptyText='No critical blockers or upcoming risks were present in the current snapshot.'
        />
      </Section>

      <Section
        id='org-leadership-leverage'
        icon={NetworkIcon}
        title='Leadership Leverage'
        eyebrow='Where one move can unlock many'
        tone='warn'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='leadership-leverage'
          emptyTitle='No leverage items'
          emptyText='The snapshot did not find leverage moves for this range.'
        />
      </Section>

      <Section icon={ZapIcon} title='Next Leap' eyebrow='Operating model shift' tone='good'>
        <PaginatedTextSection
          request={sectionRequest}
          section='next-leap'
          emptyTitle='No next leap drafted'
          emptyText='The snapshot did not produce a next-leap narrative.'
        />
      </Section>
    </SnapshotShell>
  );
};
