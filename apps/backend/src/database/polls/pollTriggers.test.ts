import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backendRoot = resolve(__dirname, '../../..');
const migrationSql = readFileSync(
  resolve(backendRoot, 'prisma/migrations/20260929120000_add_message_polls/migration.sql'),
  'utf8'
);
const dbPushSql = readFileSync(
  resolve(backendRoot, 'prisma/sql/poll-question-results.sql'),
  'utf8'
);

describe.each([
  ['forward migration', migrationSql],
  ['db-push SQL', dbPushSql],
])('poll trigger contract: %s', (_label, sql) => {
  it('serializes aggregate refreshes for one question', () => {
    expect(sql).toContain('pg_advisory_xact_lock(hashtextextended(affected_question_id, 0))');
  });

  it('recomputes choice, ranking, and rating aggregates from ballot source-of-truth', () => {
    expect(sql).toContain('"optionCounts"');
    expect(sql).toContain('"rankTotals"');
    expect(sql).toContain('"rankResponseCount"');
    expect(sql).toContain('"ratingCounts"');
    expect(sql).toContain('"ratingTotal"');
  });

  it('does not install a trigger on every message writer', () => {
    expect(sql).not.toContain('messages_reject_disabled_poll_comments');
    expect(sql).not.toContain('reject_disabled_poll_comments');
  });
});
