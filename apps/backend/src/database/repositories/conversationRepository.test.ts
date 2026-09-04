import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';

const INTENTIONALLY_NOT_MOVED: Record<string, string> = {
  Ticket:
    "channelId drives board placement as well as access — three queries list a channel's " +
    'tickets straight off it, so moving one into a GROUP_DM drops it from its support board.',
};

const hasScalar = (model: Prisma.DMMF.Model, field: string): boolean =>
  model.fields.some(f => f.name === field && f.kind === 'scalar');

const requiresMoving = Prisma.dmmf.datamodel.models
  .filter(m => hasScalar(m, 'conversationId') && hasScalar(m, 'channelId'))
  .map(m => m.name);

const readMovedModels = (): string[] => {
  const source = readFileSync(join(__dirname, 'conversationRepository.ts'), 'utf8');
  const start = source.indexOf('private async reparentChunk');
  const body = source.slice(start, source.indexOf('return movedConversations.count', start));

  return [...body.matchAll(/this\.db\.(\w+)\.updateMany/g)].map(
    ([, delegate]) => delegate.charAt(0).toUpperCase() + delegate.slice(1)
  );
};

describe('moveConversationsToChannel table coverage', () => {
  const moved = readMovedModels();

  it('reads a plausible set from both sides', () => {
    expect(requiresMoving.length).toBeGreaterThan(5);
    expect(moved.length).toBeGreaterThan(5);
  });

  it.each(requiresMoving)('%s is either moved or explicitly excluded', model => {
    expect(moved.includes(model) || model in INTENTIONALLY_NOT_MOVED).toBe(true);
  });

  it('does not move anything listed as intentionally excluded', () => {
    for (const model of Object.keys(INTENTIONALLY_NOT_MOVED)) {
      expect(moved).not.toContain(model);
    }
  });

  it('has no stale exclusions', () => {
    for (const model of Object.keys(INTENTIONALLY_NOT_MOVED)) {
      expect(requiresMoving).toContain(model);
    }
  });
});
