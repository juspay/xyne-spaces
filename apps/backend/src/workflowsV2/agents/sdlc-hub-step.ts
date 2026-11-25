import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { HostAgentStep } from '@xyne/workflow-sdk/agents/host';
import { db } from '@/database/client';
import { isRepositoryInChannel } from '@/sdlc/sdlcChannelMembership';
import type { Checked, ConfigIssue } from '../connectors/xyne-spaces/validation';
import type { XyneCtx } from '../types';

type Options = FieldOptionsContext<Record<string, unknown>>;

/** SDLC hubs the editor can read, as `requireSdlcHubReader` allows, found by name or by id. */
export async function sdlcHubOptions(ctx: Options): Promise<FieldOptionsPage> {
  const { userId, workspaceId } = ctx.caller as XyneCtx;
  const search = ctx.search?.trim();
  const hubs = await db.channel.findMany({
    where: {
      workspaceId,
      type: 'SDLC',
      OR: [{ visibility: 'PUBLIC' }, { participants: { some: { userId } } }],
      ...(ctx.values ? { id: { in: [...ctx.values] } } : {}),
      ...(search && !ctx.values ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 50,
  });
  return { items: hubs.map((hub) => ({ value: hub.id, label: hub.name ?? hub.id })) };
}

/** Activation refuses an id the field's picker would not offer this author; foreign and missing ids read the same. */
export async function unpickable(
  step: { getOptions(ctx: Options): Promise<FieldOptionsPage> },
  ctx: Checked<Record<string, unknown>>,
  field: string,
  what: string,
): Promise<ConfigIssue[]> {
  const value = ctx.known[field];
  if (typeof value !== 'string' || !value.trim()) return [];
  const page = await step.getOptions({ ...ctx, field, literal: ctx.known, values: [value.trim()] } as unknown as Options);
  return page.items.some((option) => option.value === value.trim())
    ? []
    : [{ path: field, message: `${what} ${value} was not found in this workspace` }];
}

/** An SDLC step whose `channelId` is picked by hub name. */
export class SdlcHubAgentStep extends HostAgentStep {
  override getOptions(ctx: Options): Promise<FieldOptionsPage> {
    return ctx.field === 'channelId' ? sdlcHubOptions(ctx) : super.getOptions(ctx);
  }

  async validateConfig(ctx: Checked<{ channelId?: string; repoId?: string }>): Promise<ConfigIssue[]> {
    const issues = await unpickable(this, ctx, 'channelId', 'SDLC hub');
    const { channelId, repoId } = ctx.known;
    if (issues.length || !channelId || !repoId || (await isRepositoryInChannel(db, repoId, channelId))) return issues;
    return [{ path: 'repoId', message: `Repository ${repoId} is not in SDLC hub ${channelId}` }];
  }
}

/** RUN_AGENT: activation refuses an agent the author cannot reach. */
export class ClawAgentStep extends HostAgentStep {
  validateConfig(ctx: Checked<{ agentSlug?: string }>): Promise<ConfigIssue[]> {
    return unpickable(this, ctx, 'agentSlug', 'Agent');
  }
}
