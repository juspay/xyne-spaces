import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Prisma } from '@prisma/client';

/**
 * `activities.updatedAt` is not bookkeeping — clients sort on it, cursor-paginate on it
 * (zero/queries.ts userActivitiesPaginatedV2) and render it as the row timestamp
 * (dashboard ActivityItemCard.tsx). It used to be `@updatedAt`, which made Prisma stamp
 * it on every update, so writes that only touched `classification`, `workspaceId` or
 * `channelId` silently reordered people's feeds and relabelled the rows.
 *
 * It is now `@default(now())`: the bump is opt-in. These tests are the guard.
 */

const SRC = join(__dirname, '..', '..');

/**
 * Activity writes that deliberately re-surface the row in the feed. Anything else that
 * sets `updatedAt` is the regression this file exists to catch.
 */
const INTENTIONAL_BUMPS: Record<string, string> = {
  'services/activity/activityService.ts':
    'upsertReactionActivityV2 and upsertReplyActivityV2 — a new reaction or reply must ' +
    'lift the batched row back to the top of the feed.',
  'services/noteTakerTranscriptService.ts':
    'a regenerated recording summary re-surfaces the existing row instead of stacking a ' +
    'second entry for the same recording.',
};

const EXPECTED_BUMP_COUNT = 3;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });

/** Returns the argument list of the call whose opening paren is at `openIdx`. */
const readCallArgs = (source: string, openIdx: number): string => {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  return source.slice(openIdx);
};

type WriteSite = { file: string; line: number; bumps: boolean };

/** Line number of `index`, counted without materialising slices of the source. */
const lineAt = (source: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
};

const collectActivityWrites = (): WriteSite[] =>
  walk(SRC).flatMap(file => {
    const source = readFileSync(file, 'utf8');
    // Cheap reject: most of src never touches the Activity delegate, and some files here
    // are tens of thousands of lines.
    if (!source.includes('.activity.')) return [];

    const sites: WriteSite[] = [];
    for (const match of source.matchAll(/\.activity\.(update|updateMany|upsert)\(/g)) {
      const openIdx = match.index! + match[0].length - 1;
      sites.push({
        file: relative(SRC, file),
        line: lineAt(source, match.index!),
        bumps: /\bupdatedAt\s*:/.test(readCallArgs(source, openIdx)),
      });
    }

    return sites;
  });

describe('activities.updatedAt is opt-in', () => {
  it('is not @updatedAt in the Prisma schema', () => {
    const activity = Prisma.dmmf.datamodel.models.find(m => m.name === 'Activity');
    expect(activity).toBeDefined();

    const updatedAt = activity!.fields.find(f => f.name === 'updatedAt');
    expect(updatedAt).toBeDefined();

    // `@updatedAt` makes Prisma append `"updatedAt" = now()` to EVERY generated UPDATE,
    // which is a user-visible feed reorder. Re-adding it reintroduces the bug.
    expect(updatedAt!.isUpdatedAt).toBe(false);
  });

  it('still gets a value on insert', () => {
    const activity = Prisma.dmmf.datamodel.models.find(m => m.name === 'Activity');
    const updatedAt = activity!.fields.find(f => f.name === 'updatedAt');

    // No create/createMany site supplies updatedAt, so the column default is what fills it.
    expect(updatedAt!.hasDefaultValue).toBe(true);
  });

  it('is bumped only by the writes that mean to re-surface a row', () => {
    const bumping = collectActivityWrites().filter(site => site.bumps);
    const offenders = bumping.filter(site => !(site.file in INTENTIONAL_BUMPS));

    expect(
      offenders.map(site => `${site.file}:${site.line}`)
    ).toEqual([]);

    // Guards the other direction too: if an intentional bump is dropped, replies and
    // reactions stop re-surfacing and the feed silently goes stale.
    expect(bumping).toHaveLength(EXPECTED_BUMP_COUNT);
  });
});
