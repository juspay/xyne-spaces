import { logger } from '../../re-exports';
import type { GatewayHandler, SpacesMemberChange, SpacesMessageChange } from '../types';

/** Called from Spaces side-effect handlers. Fire-and-forget: a gateway failure never breaks a Spaces write. */
export class SpacesHooks {
  constructor(private readonly handlers: GatewayHandler[]) {}

  onMessageChanged(change: SpacesMessageChange): void {
    this.runHook(change.channelId, (handler) => handler.onSpacesMessageChanged(change));
  }

  onParticipantChanged(change: SpacesMemberChange): void {
    this.runHook(change.channelId, (handler) => handler.onSpacesMemberChanged(change));
  }

  private runHook(channelId: string, work: (handler: GatewayHandler) => Promise<void>): void {
    for (const handler of this.handlers) {
      void work(handler).catch((error) =>
        logger.error('[Gateway] Hook failed', { channelId, error })
      );
    }
  }
}
