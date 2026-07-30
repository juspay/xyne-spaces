import {
  YqlBuilder,
  and,
  contains,
  lessThan,
  type ILogger,
  type VespaConfig,
  type VespaDependencies,
} from '@xyne/vespa-ts';
import type vespaClient from '../client';
import {
  channelSchema,
  mailSchema,
  messageSchema,
  ticketSchema,
  type VespaSearchResponse,
} from '../types';
import VespaClient from '../client/vespaClient';
import { getErrorMessage } from '../utils';
import { ErrorPerformingSearch } from '../error';

export interface ChannelThreadMessage {
  id: string;
  text: string;
  threadId: string;
  userId: string;
  createdAtTimestamp: number;
}

export interface ChannelTicket {
  id: string;
  title: string;
  description: string;
  /** The ticket's conversation thread, so its full discussion can be fetched. */
  threadId: string;
}

export interface ChannelThreadMail {
  id: string;
  subject: string;
  body: string;
  /** Epoch millis, so mails sort chronologically with chat messages. */
  timestamp: number;
}

/** A channel's approved type, as claw writes it into chat_container.entityTypeDefs. */
export interface ChannelEntityType {
  name: string;
  rule: string;
  examples: string[];
}

/** Messages per page when walking a channel's threads. */
const MESSAGE_PAGE = 400;

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

  /**
   * The channel's approved entity type DEFINITIONS, read from the channel doc's
   * `chat_container.entityTypeDefs` — a JSON blob of `[{name, rule, examples}]`
   * that claw writes on approval. This is the sole source of types for mention
   * extraction (names + rules + few-shot), so no Postgres round-trip is needed.
   * Empty means the channel is not entity-enabled (the gate).
   */
  getChannelTypeDefs = async (channelId: string): Promise<ChannelEntityType[]> => {
    try {
      const yql = YqlBuilder.create({
        requirePermissions: false,
        sources: [channelSchema],
      })
        .select('entityTypeDefs')
        .from(channelSchema)
        .where(contains('docId', channelId))
        .build();

      const res = await this.vespa.search<VespaSearchResponse>({
        yql,
        hits: 1,
        'ranking.profile': 'unranked',
      });
      const fields = res.root?.children?.[0]?.fields as { entityTypeDefs?: unknown } | undefined;
      const raw = fields?.entityTypeDefs;
      if (typeof raw !== 'string' || !raw) return [];

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (t): t is ChannelEntityType =>
          !!t &&
          typeof (t as ChannelEntityType).name === 'string' &&
          typeof (t as ChannelEntityType).rule === 'string' &&
          Array.isArray((t as ChannelEntityType).examples),
      );
    } catch (error) {
      this.logger.error(
        `Error fetching entity type defs for channel ${channelId}: ${getErrorMessage(error)}`,
      );
      return [];
    }
  };

  /**
   * Every USER message of one thread, oldest first. Paged by timestamp cursor
   * so a long thread comes back complete, never truncated at a hit cap.
   */
  getThreadMessages = async (threadId: string): Promise<ChannelThreadMessage[]> => {
    const messages: ChannelThreadMessage[] = [];
    let before = Number.MAX_SAFE_INTEGER;

    try {
      for (;;) {
        const yql = YqlBuilder.create({
          requirePermissions: false,
          sources: [messageSchema],
        })
          .select(['docId', 'text', 'threadId', 'userId', 'createdAtTimestamp'])
          .from(messageSchema)
          .where(
            and([
              contains('threadId', threadId),
              contains('messageType', 'USER'),
              lessThan('createdAtTimestamp', before),
            ]),
          )
          .orderBy('createdAtTimestamp', 'desc')
          .build();

        const res = await this.vespa.search<VespaSearchResponse>({
          yql,
          hits: MESSAGE_PAGE,
          'ranking.profile': 'unranked',
        });

        const hits = res.root?.children ?? [];
        if (hits.length === 0) break;

        for (const hit of hits) {
          const f = hit.fields as unknown as Record<string, unknown>;
          const ts =
            typeof f['createdAtTimestamp'] === 'number' ? f['createdAtTimestamp'] : 0;
          if (ts && ts < before) before = ts;

          const text = typeof f['text'] === 'string' ? f['text'] : '';
          const docId = typeof f['docId'] === 'string' ? f['docId'] : '';
          if (!text || !docId) continue;
          messages.push({
            id: docId,
            text,
            threadId,
            userId: typeof f['userId'] === 'string' ? f['userId'] : '',
            createdAtTimestamp: ts,
          });
        }

        if (hits.length < MESSAGE_PAGE) break;
      }
    } catch (error) {
      this.logger.error(
        `Error fetching messages for thread ${threadId}: ${getErrorMessage(error)}`,
      );
    }
    return messages;
  };

  /**
   * The ticket for a single thread, if the thread is a ticket thread. Used by
   * the per-thread live worker, which is handed one threadId and must decide
   * whether to pull in the ticket header and its mails.
   */
  getThreadTicket = async (threadId: string): Promise<ChannelTicket | null> => {
    try {
      const yql = YqlBuilder.create({
        requirePermissions: false,
        sources: [ticketSchema],
      })
        .select(['docId', 'title', 'description_clean', 'description', 'threadId'])
        .from(ticketSchema)
        .where(contains('threadId', threadId))
        .build();

      const res = await this.vespa.search<VespaSearchResponse>({
        yql,
        hits: 1,
        'ranking.profile': 'unranked',
      });
      const hit = res.root?.children?.[0];
      if (!hit) return null;
      const f = hit.fields as unknown as Record<string, unknown>;
      const id = typeof f['docId'] === 'string' ? f['docId'] : '';
      if (!id) return null;
      const description =
        (typeof f['description_clean'] === 'string' && f['description_clean']) ||
        (typeof f['description'] === 'string' ? f['description'] : '') ||
        '';
      return {
        id,
        title: typeof f['title'] === 'string' ? f['title'] : '',
        description,
        threadId,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching ticket for thread ${threadId}: ${getErrorMessage(error)}`,
      );
      return null;
    }
  };

  /**
   * Every mail on a thread, by threadId. Mail-originated tickets carry their
   * real content in the emails (subject + body), not in the chat replies — so a
   * ticket thread must pull these in or its substance is missing entirely.
   */
  getThreadMails = async (threadId: string): Promise<ChannelThreadMail[]> => {
    try {
      const yql = YqlBuilder.create({
        requirePermissions: false,
        sources: [mailSchema],
      })
        .select(['docId', 'subject', 'chunks', 'timestamp'])
        .from(mailSchema)
        .where(contains('threadId', threadId))
        .build();

      const res = await this.vespa.search<VespaSearchResponse>({
        yql,
        hits: 400,
        'ranking.profile': 'unranked',
      });

      const out: ChannelThreadMail[] = [];
      for (const hit of res.root?.children ?? []) {
        const f = hit.fields as unknown as Record<string, unknown>;
        const id = typeof f['docId'] === 'string' ? f['docId'] : '';
        const subject = typeof f['subject'] === 'string' ? f['subject'] : '';
        const chunks = Array.isArray(f['chunks']) ? (f['chunks'] as unknown[]) : [];
        const body = chunks.filter((c): c is string => typeof c === 'string').join('\n');
        const timestamp = typeof f['timestamp'] === 'number' ? f['timestamp'] : 0;
        if (!id || (!subject && !body)) continue;
        out.push({ id, subject, body, timestamp });
      }
      return out;
    } catch (error) {
      this.logger.error(
        `Error fetching mails for thread ${threadId}: ${getErrorMessage(error)}`,
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
