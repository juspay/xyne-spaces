import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import {
  CHANNEL_NAME_UNIQUE_INDEX,
  DuplicateChannelNameError,
  isChannelNameUniqueViolation,
} from './channelNameUniqueness';

const knownError = (code: string, target?: unknown) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
    meta: target === undefined ? undefined : { target },
  });

describe('isChannelNameUniqueViolation', () => {
  it('matches P2002 on the (workspaceId, name) guard — column-list target', () => {
    // Observed shape when two concurrent creates race against the partial index.
    expect(isChannelNameUniqueViolation(knownError('P2002', ['workspaceId', 'name']))).toBe(true);
  });

  it('matches P2002 reported by index name', () => {
    expect(isChannelNameUniqueViolation(knownError('P2002', CHANNEL_NAME_UNIQUE_INDEX))).toBe(true);
  });

  it('ignores unique violations on other indexes', () => {
    expect(isChannelNameUniqueViolation(knownError('P2002', ['id']))).toBe(false);
    expect(isChannelNameUniqueViolation(knownError('P2002', 'connect_groups_pkey'))).toBe(false);
    expect(isChannelNameUniqueViolation(knownError('P2002'))).toBe(false);
  });

  it('ignores other Prisma errors and non-Prisma errors', () => {
    expect(isChannelNameUniqueViolation(knownError('P2025', ['workspaceId', 'name']))).toBe(false);
    expect(isChannelNameUniqueViolation(new Error('Unique constraint failed'))).toBe(false);
    expect(isChannelNameUniqueViolation(undefined)).toBe(false);
  });
});

describe('DuplicateChannelNameError', () => {
  it('keeps the existing user-facing message and exposes a stable code', () => {
    const err = new DuplicateChannelNameError('general');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Channel with name "general" already exists.');
    expect(err.code).toBe('DUPLICATE_CHANNEL_NAME');
  });
});

describe('channel-name unique index migration', () => {
  const migrationsDir = join(__dirname, '../../../prisma/migrations');
  const sql = readdirSync(migrationsDir)
    .filter(d => d.endsWith('_channels_unique_active_default_name'))
    .map(d => readFileSync(join(migrationsDir, d, 'migration.sql'), 'utf8'))
    .join('\n');

  it('creates the index the app matches on, scoped to active DEFAULT channels', () => {
    expect(sql).toContain(`CREATE UNIQUE INDEX CONCURRENTLY "${CHANNEL_NAME_UNIQUE_INDEX}"`);
    expect(sql).toMatch(/\("workspaceId", "name"\)/);
    // DM/GROUP_DM have known historical duplicates (XYNE-64861) and archived names must stay reusable.
    expect(sql).toMatch(/WHERE "scopeType" = 'DEFAULT' AND "isArchived" = false/);
  });
});
