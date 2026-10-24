import { describe, expect, it } from 'vitest';
import {
  canChangeDelivery,
  canEditJob,
  canPauseJob,
  canResumeJob,
  describeSchedule,
  draftFromJob,
  schedulePatch,
  toDateTimeLocal,
  type EditableScheduledJob,
} from './scheduledJobEdit';

const cronJob: EditableScheduledJob = {
  id: 'job-1',
  task: 'Post a Pokémon of the day',
  label: 'Pokémon of the day',
  type: 'cron',
  cronExpression: '0 9 * * *',
  nextRunAt: null,
  status: 'active',
  replyMode: 'thread',
  channelId: 'channel-1',
};

const NOW = Date.parse('2026-10-22T10:00:00Z');
const runAtJob: EditableScheduledJob = {
  ...cronJob,
  id: 'job-2',
  type: 'once',
  cronExpression: null,
  nextRunAt: '2026-10-23T10:00:00.000Z',
};

describe('scheduledJobEdit', () => {
  it('sends nothing when nothing changed', () => {
    expect(schedulePatch(cronJob, draftFromJob(cronJob), NOW)).toEqual({ patch: {} });
    expect(schedulePatch(runAtJob, draftFromJob(runAtJob), NOW)).toEqual({ patch: {} });
  });

  it('sends only the fields that changed, trimmed', () => {
    const draft = {
      ...draftFromJob(cronJob),
      task: '  Post a Pokémon of the day with one fun fact ',
      label: '   ',
      cron: ' 0  9 * *  1-5 ',
      replyMode: 'channel' as const,
    };
    expect(schedulePatch(cronJob, draft, NOW)).toEqual({
      patch: {
        task: 'Post a Pokémon of the day with one fun fact',
        label: null,
        cronExpression: '0 9 * * 1-5',
        replyMode: 'channel',
      },
    });
  });

  it('rejects an empty prompt and a malformed cron', () => {
    expect(schedulePatch(cronJob, { ...draftFromJob(cronJob), task: ' ' }, NOW)).toEqual({
      error: 'Describe what the agent should do.',
    });
    expect(schedulePatch(cronJob, { ...draftFromJob(cronJob), cron: '0 9 * *' }, NOW)).toEqual({
      error: 'A cron expression needs five fields, e.g. 0 9 * * 1-5',
    });
  });

  it('reschedules a one-off job to a future local time only', () => {
    const later = new Date(NOW + 2 * 60 * 60 * 1000);
    const result = schedulePatch(
      runAtJob,
      { ...draftFromJob(runAtJob), runAt: toDateTimeLocal(later.toISOString()) },
      NOW,
    );
    expect(result).toEqual({
      patch: { nextRunAt: new Date(toDateTimeLocal(later.toISOString())).toISOString() },
    });
    expect(
      schedulePatch(
        runAtJob,
        { ...draftFromJob(runAtJob), runAt: toDateTimeLocal(new Date(NOW).toISOString()) },
        NOW,
      ),
    ).toEqual({ error: 'Pick a time at least a minute from now.' });
  });

  it('leaves the schedule alone on a paused job, which claw-auth refuses to reschedule', () => {
    const paused = { ...cronJob, status: 'paused' };
    expect(schedulePatch(paused, { ...draftFromJob(paused), cron: 'not a cron' }, NOW)).toEqual({
      patch: {},
    });
  });

  it('only offers delivery for Spaces jobs, not WhatsApp or chat-only ones', () => {
    expect(canChangeDelivery(cronJob)).toBe(true);
    expect(canChangeDelivery({ ...cronJob, channelId: null })).toBe(false);
    expect(canChangeDelivery({ ...cronJob, replyMode: 'whatsapp' })).toBe(false);
    expect(
      schedulePatch(
        { ...cronJob, channelId: null },
        { ...draftFromJob(cronJob), replyMode: 'channel' },
        NOW,
      ),
    ).toEqual({
      patch: {},
    });
  });

  it('knows which controls apply to each status', () => {
    expect([canEditJob, canPauseJob, canResumeJob].map(fn => fn({ status: 'active' }))).toEqual([
      true,
      true,
      false,
    ]);
    expect([canEditJob, canPauseJob, canResumeJob].map(fn => fn({ status: 'paused' }))).toEqual([
      true,
      false,
      true,
    ]);
    expect([canEditJob, canPauseJob, canResumeJob].map(fn => fn({ status: 'cancelled' }))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('describes the schedule, marking paused ones', () => {
    expect(describeSchedule(cronJob)).toBe('Repeats · 0 9 * * *');
    expect(describeSchedule({ ...cronJob, status: 'paused' })).toBe('Paused · Repeats · 0 9 * * *');
    expect(describeSchedule({ ...runAtJob, nextRunAt: null })).toBe('One-off');
  });
});
