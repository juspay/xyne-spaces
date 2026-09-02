import { ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MetricsCard } from '@/components/ClawAgents/metrics/MetricsCard';
import { subsystemLabel, sourceLabel } from '../subsystems';
import type { DigitalTwinMetrics } from '@/services/claw/digitalTwinTypes';

const CHART_HEIGHT = 240;
const TICK_FONT_SIZE = 11;
const LEGEND_FONT_SIZE = 12;
const tick = { fontSize: TICK_FONT_SIZE, fill: 'currentColor', opacity: 0.65 };

const OUTCOME_COLORS = {
  approvedClean: 'var(--status-success)',
  approvedEdited: 'var(--status-scheduled)',
  rejected: 'var(--status-failure)',
  pending: 'var(--status-pending)',
} as const;

export const DigitalTwinMetricsCharts = ({ data }: { data: DigitalTwinMetrics }): ReactElement => {
  const outcomes = [
    { name: 'Approved (clean)', value: data.approvedClean, fill: OUTCOME_COLORS.approvedClean },
    { name: 'Approved (edited)', value: data.approvedEdited, fill: OUTCOME_COLORS.approvedEdited },
    { name: 'Rejected', value: data.rejected, fill: OUTCOME_COLORS.rejected },
    { name: 'Pending', value: data.pending, fill: OUTCOME_COLORS.pending },
  ].filter(o => o.value > 0);

  const bySubsystem = data.bySubsystem.map(s => ({
    name: subsystemLabel(s.subsystem),
    Approved: s.approved,
    Rejected: s.rejected,
    Pending: s.pending,
  }));

  const bySource = data.bySource.map(s => ({
    name: sourceLabel(s.source),
    Approved: s.approved,
    Rejected: s.rejected,
  }));

  return (
    <>
      <div className='grid gap-5 lg:grid-cols-2'>
        <MetricsCard title='Candidate outcomes' description='How reviewed candidates resolved.'>
          {outcomes.length === 0 ? (
            <p className='py-16 text-center text-sm text-muted-foreground'>No candidates yet.</p>
          ) : (
            <ResponsiveContainer width='100%' height={CHART_HEIGHT}>
              <PieChart>
                <Pie
                  data={outcomes}
                  dataKey='value'
                  nameKey='name'
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  isAnimationActive={false}
                  cursor='pointer'
                >
                  {outcomes.map(entry => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip cursor={false} />
                <Legend wrapperStyle={{ fontSize: LEGEND_FONT_SIZE }} verticalAlign='bottom' />
              </PieChart>
            </ResponsiveContainer>
          )}
        </MetricsCard>

        <MetricsCard
          title='By subsystem'
          description='Approved, rejected, and pending per subsystem.'
        >
          {bySubsystem.length === 0 ? (
            <p className='py-16 text-center text-sm text-muted-foreground'>No subsystem data.</p>
          ) : (
            <ResponsiveContainer width='100%' height={CHART_HEIGHT}>
              <BarChart
                data={bySubsystem}
                layout='vertical'
                margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
              >
                <CartesianGrid strokeDasharray='3 3' opacity={0.1} horizontal={false} />
                <XAxis type='number' tick={tick} tickLine={false} allowDecimals={false} />
                <YAxis type='category' dataKey='name' tick={tick} tickLine={false} width={110} />
                <Tooltip cursor={false} />
                <Legend
                  wrapperStyle={{ fontSize: LEGEND_FONT_SIZE, paddingBottom: 8 }}
                  verticalAlign='top'
                  align='left'
                />
                <Bar
                  dataKey='Approved'
                  stackId='s'
                  fill={OUTCOME_COLORS.approvedClean}
                  cursor='pointer'
                />
                <Bar
                  dataKey='Rejected'
                  stackId='s'
                  fill={OUTCOME_COLORS.rejected}
                  cursor='pointer'
                />
                <Bar
                  dataKey='Pending'
                  stackId='s'
                  fill={OUTCOME_COLORS.pending}
                  radius={[0, 4, 4, 0]}
                  cursor='pointer'
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </MetricsCard>
      </div>

      <MetricsCard
        title='By source'
        description='Which intake to trust — approvals vs rejections per source.'
      >
        {bySource.length === 0 ? (
          <p className='py-16 text-center text-sm text-muted-foreground'>No source data.</p>
        ) : (
          <ResponsiveContainer width='100%' height={CHART_HEIGHT}>
            <BarChart data={bySource} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray='3 3' opacity={0.1} vertical={false} />
              <XAxis dataKey='name' tick={tick} tickLine={false} />
              <YAxis tick={tick} tickLine={false} width={40} allowDecimals={false} />
              <Tooltip cursor={false} />
              <Legend
                wrapperStyle={{ fontSize: LEGEND_FONT_SIZE, paddingBottom: 8 }}
                verticalAlign='top'
                align='left'
              />
              <Bar
                dataKey='Approved'
                fill={OUTCOME_COLORS.approvedClean}
                radius={[4, 4, 0, 0]}
                cursor='pointer'
              />
              <Bar
                dataKey='Rejected'
                fill={OUTCOME_COLORS.rejected}
                radius={[4, 4, 0, 0]}
                cursor='pointer'
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </MetricsCard>
    </>
  );
};
