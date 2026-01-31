import { createDefaultConfig, type VespaDependencies } from '@xyne/vespa-ts';
import { ChannelService } from './services/channelService';
import { CRUDService } from './services/crudService';
import { SearchService } from './services/searchService';
import VespaClient from './client/vespaClient';

export interface VespaService {
  channelService: ChannelService;
  crudService: CRUDService;
  searchService: SearchService;
}

export function createVespaService(dependencies: VespaDependencies): VespaService {
  const vespaClient = new VespaClient(dependencies.logger, dependencies.config);
  return {
    channelService: new ChannelService(vespaClient, dependencies),
    crudService: new CRUDService(vespaClient, dependencies),
    searchService: new SearchService(vespaClient, dependencies),
  };
}

export type { VespaDependencies };
export { createDefaultConfig };
