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
import { subsystemLabel, sourceLabel } from '@/components/ClawAgents/digitalTwin/subsystems';
import type { DigitalTwinMetrics } from '@/services/claw/digitalTwinTypes';

const CHART_HEIGHT = 240;
const tick = { fontSize: 11, fill: 'currentColor', opacity: 0.65 };

const OUTCOME_COLORS = {
  approvedClean: '#22c55e',
  approvedEdited: '#3b82f6',
  rejected: '#ef4444',
  pending: '#f59e0b',
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
                >
                  {outcomes.map(entry => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign='bottom' />
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
                <Tooltip />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
                  verticalAlign='top'
                  align='left'
                />
                <Bar dataKey='Approved' stackId='s' fill='#22c55e' />
                <Bar dataKey='Rejected' stackId='s' fill='#ef4444' />
                <Bar dataKey='Pending' stackId='s' fill='#f59e0b' radius={[0, 4, 4, 0]} />
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
              <Tooltip />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
                verticalAlign='top'
                align='left'
              />
              <Bar dataKey='Approved' fill='#22c55e' radius={[4, 4, 0, 0]} />
              <Bar dataKey='Rejected' fill='#ef4444' radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </MetricsCard>
    </>
  );
};
