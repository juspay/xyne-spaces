import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowUpRightIcon,
  BadgeCheckIcon,
  CompassIcon,
  GaugeIcon,
  LightbulbIcon,
  ListChecksIcon,
  TargetIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type {
  TeamMember,
  UserLeadershipSummary,
} from '@/services/TeamIntelligence/teamIntelligenceService';
import type { SectionRequest } from './leadershipDashboardTypes';
import { formatLabel, momentumTone } from './leadershipDashboardUtils';
import { EmptyState, ErrorState, LoadingState, SignalStrip } from './LeadershipDashboardPrimitives';
import {
  PaginatedItemSection,
  PaginatedTextSection,
  Section,
  SnapshotShell,
} from './LeadershipDashboardSections';

export const MemberLeadershipDashboard = ({
  snapshot,
  member,
  isLoading,
  isError,
  sectionRequest,
}: {
  snapshot: { summary: UserLeadershipSummary; completedAt: string | null } | null;
  member?: TeamMember | undefined;
  isLoading: boolean;
  isError: boolean;
  sectionRequest: SectionRequest;
}): ReactElement => {
  if (isLoading) return <LoadingState label='Loading member brief...' />;
  if (isError) return <ErrorState label='Could not load the member brief.' />;
  if (!snapshot) {
    return (
      <EmptyState
        title='No member brief yet'
        text='No completed member leadership summary exists for this range.'
      />
    );
  }

  const summary = snapshot.summary;
  const displayName = member?.name ?? summary.user.name;
  const teamPath = summary.user.teamId
    ? `/team-intelligence/team/${encodeURIComponent(summary.user.teamId)}`
    : null;

  return (
    <SnapshotShell
      scope='member'
      title={`${displayName} Daily Brief`}
      eyebrow={summary.user.teamName ?? member?.team?.name ?? 'Individual contributor signal'}
      reportDate={summary.reportDate}
      confidence={summary.overallConfidence}
      momentum={summary.momentumAndDirection.momentum}
      narrative={summary.executiveSummary}
      sectionRequest={sectionRequest}
    >
      {teamPath ? (
        <div className='flex justify-end'>
          <Link
            to={teamPath}
            className='inline-flex items-center gap-2 rounded-md border border-border/70 bg-card px-3 py-2 text-sm text-foreground transition-colors hover:border-action-accent/50'
          >
            Open team brief
            <ArrowUpRightIcon className='size-4' />
          </Link>
        </div>
      ) : null}

      <SignalStrip
        signals={[
          {
            label: 'Momentum',
            value: formatLabel(summary.momentumAndDirection.momentum),
            description: summary.momentumAndDirection.assessment,
            tone: momentumTone(summary.momentumAndDirection.momentum),
            icon: ActivityIcon,
          },
          {
            label: 'Focus',
            value: formatLabel(summary.peopleLoadFocusAndGaps.focusAssessment),
            description: summary.peopleLoadFocusAndGaps.assessment,
            tone: summary.peopleLoadFocusAndGaps.focusAssessment.includes('FRAGMENTED')
              ? 'warn'
              : 'info',
            icon: TargetIcon,
          },
          {
            label: 'Load',
            value: formatLabel(summary.peopleLoadFocusAndGaps.loadAssessment),
            description: 'Current load reading from the evidence window.',
            tone:
              summary.peopleLoadFocusAndGaps.loadAssessment === 'OVERLOADED' ? 'danger' : 'good',
            icon: GaugeIcon,
          },
          {
            label: 'Manager Attention',
            value: `${summary.managerAttention.length} actions`,
            description: 'Items the manager should notice or clear.',
            tone: summary.managerAttention.length > 0 ? 'accent' : 'neutral',
            icon: BadgeCheckIcon,
          },
        ]}
      />

      <Section
        icon={ListChecksIcon}
        title='Manager Attention'
        eyebrow='Person-specific asks'
        tone='accent'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='manager-attention'
          emptyTitle='No manager attention needed'
          emptyText='No person-specific manager actions were surfaced in this range.'
        />
      </Section>

      <Section icon={CompassIcon} title='Work And Movement' eyebrow='Current state' tone='info'>
        <PaginatedItemSection
          request={sectionRequest}
          section='work-and-movement'
          emptyTitle='No visible workstreams'
          emptyText='The selected range did not produce workstream signals for this person.'
        />
      </Section>

      <Section
        icon={AlertTriangleIcon}
        title='Blockers And Risks'
        eyebrow='Needs clearing'
        tone='danger'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='blockers-and-risks'
          emptyTitle='No blockers or risks'
          emptyText='No blockers, gaps, or at-risk commitments were detected.'
        />
      </Section>

      <Section icon={LightbulbIcon} title='Decisions And Signals' eyebrow='Direction' tone='warn'>
        <PaginatedTextSection
          request={sectionRequest}
          section='decisions-and-signals'
          emptyTitle='No decisions or directional signals'
          emptyText='The snapshot did not surface decisions, open questions, or team direction signals.'
        />
      </Section>
    </SnapshotShell>
  );
};
