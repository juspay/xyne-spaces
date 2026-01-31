import { YqlBuilder, type ILogger, type VespaConfig, type VespaDependencies } from '@xyne/vespa-ts';
import type vespaClient from '../client';
import { type VespaSearchResponse } from '../types';
import VespaClient from '../client/vespaClient';
import { getErrorMessage } from '../utils';
import { ErrorPerformingSearch } from '../error';

export class ChannelService {
  private logger: ILogger;
  private config: VespaConfig;
  private vespa: vespaClient;
  constructor(vespaClient: VespaClient, dependencies: VespaDependencies) {
    this.logger = dependencies.logger.child({ module: 'vespa' });
    this.config = dependencies.config;
    // Initialize Vespa clients
    this.vespa = vespaClient;
  }

  searchChannels = async (query: string) => {
    try {
      const yql = YqlBuilder.create({
        userId: 'user-003',
        requirePermissions: true,
        sources: ['chat_container'],
        targetHits: this.config.page || 10,
      })
        .whereTrue()
        .from('chat_container')
        .build();
      const payload = {
        yql,
        hits: 10,
        'ranking.profile': 'unranked',
      };

      return this.vespa.search<VespaSearchResponse>(payload).catch((error) => {
        throw new ErrorPerformingSearch({
          cause: error as Error,
          sources: 'chat_container',
        });
      });
    } catch (error) {
      this.logger.error(
        `Error searching channels with query "${query}": ${getErrorMessage(error)}`,
      );
      throw error;
    }
  };
}
