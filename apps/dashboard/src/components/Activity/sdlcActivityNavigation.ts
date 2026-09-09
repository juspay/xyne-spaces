import { buildSdlcPath } from '@xyne/shared/sdlc';

interface SdlcActivityNavigationActivity {
  canvasId?: string | null;
  canvas?: { readonly id: string } | null | undefined;
  ticketId?: string | null;
  ticket?: { readonly id: string } | null | undefined;
  conversationId?: string | null;
  messageId?: string | null;
  message?:
    | {
        readonly messageId: string;
        readonly conversation?: { readonly conversationId: string } | null | undefined;
      }
    | null
    | undefined;
}

/** Maps an activity row onto the entity ids `buildSdlcPath` routes on. */
export function resolveSdlcActivityTarget(input: {
  activity: SdlcActivityNavigationActivity;
  channelType: string | null | undefined;
  channelId: string | null | undefined;
  fallbackPath: string;
}): string {
  if (input.channelType !== 'SDLC' || !input.channelId) return input.fallbackPath;
  const activity = input.activity;

  return buildSdlcPath({
    channelId: input.channelId,
    canvasId: activity.canvasId ?? activity.canvas?.id,
    ticketId: activity.ticketId ?? activity.ticket?.id,
    conversationId: activity.message?.conversation?.conversationId ?? activity.conversationId,
    messageId: activity.message?.messageId ?? activity.messageId,
  });
}
