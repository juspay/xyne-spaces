import { logger } from '../../re-exports';
import { MIRROR_SOURCE_SUFFIX } from '../../useCases/mirror/types';
import { isPausingError } from '../errors';
import { PairRepository } from '../repositories/pairRepository';
import type {
  ProviderConfig,
  Pair,
  ProviderServices,
  SpacesMemberChange,
  SpacesMessageChange,
} from '../types';

type HookWork = (services: ProviderServices, link: Pair, config: ProviderConfig) => Promise<void>;

/** Called from Spaces side-effect handlers. Fire-and-forget: a gateway failure never breaks a Spaces write. */
export class SpacesHooks {
  private readonly links = new PairRepository(MIRROR_SOURCE_SUFFIX);

  constructor(private readonly servicesFor: (provider: string) => ProviderServices | undefined) {}

  onMessageChanged(change: SpacesMessageChange): void {
    void this.runHook(change.channelId, (services, link, config) =>
      services.outbound.sendMessageChange(link, config, change)
    );
  }

  onParticipantChanged(change: SpacesMemberChange): void {
    void this.runHook(change.channelId, (services, link, config) =>
      services.members.applySpacesMemberChange(link, config, change)
    );
  }

  private async runHook(channelId: string, work: HookWork): Promise<void> {
    try {
      const link = await this.links.findBySpacesId(channelId);
      const services = link?.status === 'ACTIVE' ? this.servicesFor(link.provider) : undefined;
      if (link && services) await this.runForLink(link, services, work);
    } catch (error) {
      logger.error('[Gateway] Hook failed', { channelId, error });
    }
  }

  private async runForLink(link: Pair, services: ProviderServices, work: HookWork): Promise<void> {
    try {
      await work(services, link, await services.config.getConfigBySource(link.connectionId));
    } catch (error) {
      if (!isPausingError(error)) throw error;
      await services.links.pauseOnError(link, error);
    }
  }
}
