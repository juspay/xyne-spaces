import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { channelOptions, noOptions, optionsQuery } from '../options';
import type { XyneCtx } from '@/workflowsV2/types';
import { z } from 'zod';
import { requireScopeFilter } from '../scope-filter';
import { CallType } from '@xyne/shared';
import { EventTrigger, TriggerCategory, withOptions } from '@xyne/workflow-sdk';
import type { HydrateResult, TriggerEvent } from '@xyne/workflow-sdk';
import {
  CALL_STARTED,
  CALL_ENDED,
  CallEventOutputSchema,
  hydrateCallEventPayload,
} from '@/automations/triggers/call.trigger';

export const CALL_EVENT = 'CALL_EVENT';
export { CALL_STARTED, CALL_ENDED };

const CallEventConfigSchema = z
  .object({
    callEventType: z
      .enum([CALL_STARTED, CALL_ENDED])
      .describe('When to fire: when a call starts or when a call ends.'),
    channelIds: withOptions(z
      .array(z.string()))
      .optional()
      .describe('Limit to calls in these channels. Empty matches every channel.'),
    // `participantUserIds` is deliberately absent — see `accepts`.
  })
  .superRefine(requireScopeFilter(['channelIds']));

type CallEventConfig = z.infer<typeof CallEventConfigSchema>;
type CallEventPayload = z.infer<typeof CallEventOutputSchema>;
type Raw = {
  callEventType: typeof CALL_STARTED | typeof CALL_ENDED;
  callId: string;
  externalId: string;
  channelId: string | null;
  title: string | null;
  callType: CallType;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  aiSummary: string | null;
  transcript: string | null;
  conversationId: string | null;
} & Record<string, unknown>;

export class CallTrigger extends EventTrigger<
  typeof CallEventConfigSchema,
  typeof CallEventOutputSchema,
  Raw
> {
  readonly type = CALL_EVENT;
  readonly configSchema = CallEventConfigSchema;
  readonly outputSchema = CallEventOutputSchema;
  readonly name = 'When a call event occurs';
  readonly description =
    "Fires when a call starts or ends. aiSummary and transcript are generated asynchronously after the call ends — if you need them in downstream steps, add a 'Scheduled' delay (e.g. 60–90s) so the AI pipeline has time to populate the fields. Filter by channel.";
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'Phone';
  readonly requiresScopeFilter = true;
  readonly scopeFilterFields = ['channelIds'] as const;


  /** The one picker this trigger has; `callEventType` is an enum the editor renders itself. */
  override getOptions(
    ctx: FieldOptionsContext<CallEventConfig, Record<string, unknown>, XyneCtx>,
  ): Promise<FieldOptionsPage> {
    return ctx.field === 'channelIds'
      ? channelOptions(optionsQuery(ctx))
      : Promise.resolve(noOptions);
  }

  override accepts(event: TriggerEvent<Raw>, config: CallEventConfig): boolean {
    const { callEventType, channelId } = event.payload;

    if (config.callEventType !== callEventType) return false;

    const channelIds = (config.channelIds ?? [])
      .map((id) => id?.trim())
      .filter((id): id is string => !!id);
    if (channelIds.length > 0) {
      if (!channelId || !channelIds.includes(channelId)) return false;
    }

    return true;
  }

  /** Fresh aiSummary/transcript plus the participant list — unchanged. */
  override async hydrate(event: TriggerEvent<Raw>): Promise<HydrateResult<CallEventPayload>> {
    const hydrated = await hydrateCallEventPayload(event.payload);
    return { kind: 'payload', payload: hydrated as unknown as CallEventPayload };
  }

  override hydrationKey(event: TriggerEvent<Raw>): string | undefined {
    return `${event.payload.callEventType}:${event.payload.callId}`;
  }
}
