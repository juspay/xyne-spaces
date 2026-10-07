import { describe, expect, it } from 'vitest';
import {
  cronFromRepeat,
  parseCreateSchedule,
  repeatFromCron,
  scheduledJobInput,
  scheduleLabel,
  scheduleProblem,
  type CreateSchedule,
} from './agentSchedule';

const NOW = Date.parse('2026-09-29T10:00:00Z');

const once = (at: string): CreateSchedule => ({ kind: 'once', at, timezone: 'UTC', task: '' });
const repeat = (cron: string): CreateSchedule => ({
  kind: 'repeat',
  cron,
  timezone: 'Europe/London',
  task: 'Post the digest',
});

describe('agentSchedule', () => {
  it('round-trips the repeat picker through cron', () => {
    for (const parts of [
      { frequency: 'daily' as const, hour: 9, minute: 0, weekday: 1 },
      { frequency: 'weekdays' as const, hour: 17, minute: 30, weekday: 1 },
      { frequency: 'weekly' as const, hour: 8, minute: 15, weekday: 3 },
    ]) {
      expect(repeatFromCron(cronFromRepeat(parts))).toEqual(parts);
    }
    expect(cronFromRepeat({ frequency: 'weekdays', hour: 9, minute: 0, weekday: 1 })).toBe(
      '0 9 * * 1-5',
    );
  });

  it('leaves crons the picker cannot express to the raw editor', () => {
    expect(repeatFromCron('*/30 * * * *')).toBeNull();
    expect(repeatFromCron('0 9 1 * *')).toBeNull();
    expect(repeatFromCron('0 9 * *')).toBeNull();
  });

  it('labels repeats as a sentence', () => {
    expect(scheduleLabel(repeat('0 9 * * 1-5'))).toMatch(/^Weekdays at 9:00/);
    expect(scheduleLabel(repeat('0 9 * * 1'))).toMatch(/^Mondays at 9:00/);
    expect(scheduleLabel(repeat('0 9 * * *'))).toMatch(/^Every day at 9:00/);
  });

  it('blocks a once-schedule in the past and a malformed cron', () => {
    expect(scheduleProblem(null, NOW)).toBeNull();
    expect(scheduleProblem(once('2026-09-28T10:00:00Z'), NOW)).toMatch(/passed/);
    expect(scheduleProblem(once('2026-10-03T09:00:00Z'), NOW)).toBeNull();
    expect(scheduleProblem(repeat('0 9 * *'), NOW)).toMatch(/five-field/);
  });

  it('turns a once-schedule into a delayed job and a repeat into a zoned cron', () => {
    const job = scheduledJobInput(once('2026-09-29T11:00:00Z'), 'digest', 'Daily digest', NOW);
    expect(job).toMatchObject({ agentSlug: 'digest', type: 'once', delayMs: 3_600_000 });
    expect(job.task).toBe('Daily digest');

    expect(scheduledJobInput(repeat('0 9 * * 1-5'), 'digest', 'x', NOW)).toMatchObject({
      type: 'cron',
      cronExpression: '0 9 * * 1-5',
      timezone: 'Europe/London',
      task: 'Post the digest',
    });
  });

  it('parses only well-formed stored schedules', () => {
    expect(parseCreateSchedule({ kind: 'once', at: '2026-10-03T09:00:00Z' })).toMatchObject({
      kind: 'once',
      timezone: 'UTC',
      task: '',
    });
    expect(parseCreateSchedule({ kind: 'repeat' })).toBeNull();
    expect(parseCreateSchedule('tomorrow')).toBeNull();
  });
});
