import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { HostAgentStep } from '@xyne/workflow-sdk/agents/host';
import { db } from '@/database/client';
import { isRepositoryInChannel } from '@/sdlc/sdlcChannelMembership';
import { optionsQuery, sdlcHubOptions } from '../connectors/xyne-spaces/options';
import { sdlcHubIssues, type Checked, type ConfigIssue } from '../connectors/xyne-spaces/validation';
import type { XyneCtx } from '../types';

type Options = FieldOptionsContext<Record<string, unknown>, Record<string, unknown>, XyneCtx>;

/** An SDLC step whose `channelId` is picked by hub name. */
export class SdlcHubAgentStep extends HostAgentStep {
  override getOptions(ctx: Options): Promise<FieldOptionsPage> {
    return ctx.field === 'channelId' ? sdlcHubOptions(optionsQuery(ctx)) : super.getOptions(ctx);
  }

  async validateConfig(ctx: Checked<{ channelId?: string; repoId?: string }>): Promise<ConfigIssue[]> {
    const issues = await sdlcHubIssues(ctx, 'channelId', ctx.known.channelId);
    const { channelId, repoId } = ctx.known;
    if (issues.length || !channelId || !repoId || (await isRepositoryInChannel(db, repoId, channelId))) return issues;
    return [{ path: 'repoId', message: `Repository ${repoId} is not in SDLC hub ${channelId}` }];
  }
}

/** RUN_AGENT: activation refuses an agent the picker would not offer the author. */
export class ClawAgentStep extends HostAgentStep {
  async validateConfig(ctx: Checked<{ agentSlug?: string }>): Promise<ConfigIssue[]> {
    const slug = ctx.known.agentSlug?.trim();
    if (!slug) return [];
    const page = await this.getOptions({ ...ctx, field: 'agentSlug', literal: ctx.known, values: [slug] } as unknown as Options);
    return page.items.some((option) => option.value === slug)
      ? []
      : [{ path: 'agentSlug', message: `Agent ${slug} was not found in this workspace` }];
  }
}
