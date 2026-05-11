import {
  YqlBuilder,
  contains,
  type ILogger,
  type VespaConfig,
  type VespaDependencies,
} from '@xyne/vespa-ts';
import type vespaClient from '../client';
import { channelSchema, type VespaSearchResponse } from '../types';
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

  getChannelParticipants = async (channelId: string, userId: string): Promise<string[]> => {
    try {
      const yql = YqlBuilder.create({
        userId,
        requirePermissions: true,
        sources: [channelSchema],
      })
        .select('permissions')
        .from(channelSchema)
        .where(contains('docId', channelId))
        .build();
      const payload = {
        yql,
        hits: 1,
        'ranking.profile': 'unranked',
      };

      const response = await this.vespa.search<VespaSearchResponse>(payload);
      const fields = response.root?.children?.[0]?.fields as { permissions?: string[] } | undefined;
      return fields?.permissions ?? [];
    } catch (error) {
      this.logger.error(
        `Error fetching channel participants for ${channelId}: ${getErrorMessage(error)}`,
      );
      return [];
    }
  };

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
