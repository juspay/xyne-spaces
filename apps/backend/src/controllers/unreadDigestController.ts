import { Request, Response } from 'express';
import {
  summarizeThread,
  type ThreadSummaryInput,
  type SummarizerContext,
  type SummaryOutput,
} from '@/agents/summariser';
import { AgentsConfig } from '@/agents/config';
import { logger } from '@/utils/logger';
import { unreadDigestService, type DigestChannelSnapshot } from '@/services/unreadDigestService';

/**
 * Controller for the on-demand Unread Digest.
 *
 * POST /api/unread-digest/generate
 *
 * Streams Server-Sent Events as each channel is summarised so the UI can render
 * progressively rather than blocking on the whole batch. Generation is strictly
 * read-only — it never marks anything as read.
 *
 * Event contract (all lines are `data: <json>\n\n`):
 *   { type: 'snapshot', snapshotAt, totalChannels, omittedChannelCount, caps }
 *   { type: 'progress', channelId, channelName, index, total }
 *   { type: 'channel', channelId, channelName, output, includedCount, omittedCount,
 *     messageIdMapping, conversationIdMapping }
 *   { type: 'complete', channelCount }
 *   { type: 'error', error }
 *   { type: 'end' }
 */
export class UnreadDigestController {
  generate = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    const workspaceId = (req as any).user?.workspaceId;
    const email = (req as any).user?.email;

    if (!userId || !workspaceId) {
      res.status(401).json({ error: 'Unauthorized: missing user or workspace context' });
      return;
    }

    // Concurrency limit for per-channel summarisation so a large inbox does not
    // fan out unbounded LLM calls.
    const CONCURRENCY = 3;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    const write = (payload: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    };

    // Abort per-channel work if the client disconnects mid-stream.
    let clientGone = false;
    req.on('close', () => {
      clientGone = true;
    });

    try {
      const agentsConfig = await AgentsConfig.fetch({ email });
      const snapshot = await unreadDigestService.createSnapshot(userId, workspaceId);

      write({
        type: 'snapshot',
        snapshotAt: snapshot.snapshotAt.toISOString(),
        totalChannels: snapshot.channels.length,
        omittedChannelCount: snapshot.omittedChannelCount,
        caps: snapshot.caps,
      });

      if (snapshot.channels.length === 0) {
        write({ type: 'complete', channelCount: 0 });
        write({ type: 'end' });
        res.end();
        return;
      }

      const summarizeOne = async (
        channel: DigestChannelSnapshot,
        index: number
      ): Promise<void> => {
        if (clientGone) return;
        write({
          type: 'progress',
          channelId: channel.channelId,
          channelName: channel.channelName,
          index: index + 1,
          total: snapshot.channels.length,
        });

        const input: ThreadSummaryInput = {
          messages: channel.messages,
          messageIdMapping: channel.messageIdMapping,
          conversationIdMapping: channel.conversationIdMapping,
        };
        const context: SummarizerContext = {
          userId,
          conversationId: '',
          channelId: channel.channelId,
          summarizationType: 'channel',
          modelName: agentsConfig.summariserModelName,
        };

        let output: SummaryOutput | null = null;
        try {
          output = await summarizeThread(input, context);
        } catch (err) {
          logger.warn(
            `[UnreadDigest] channel ${channel.channelId} summarisation failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
        if (clientGone) return;

        write({
          type: 'channel',
          channelId: channel.channelId,
          channelName: channel.channelName,
          includedCount: channel.includedCount,
          omittedCount: channel.omittedCount,
          messageIdMapping: Object.fromEntries(channel.messageIdMapping),
          conversationIdMapping: Object.fromEntries(channel.conversationIdMapping),
          output,
          failed: output === null,
        });
      };

      // Bounded concurrency, preserving the ranked channel order for progress.
      let cursor = 0;
      const workers: Promise<void>[] = [];
      const runNext = async (): Promise<void> => {
        while (cursor < snapshot.channels.length && !clientGone) {
          const current = cursor++;
          await summarizeOne(snapshot.channels[current], current);
        }
      };
      for (let i = 0; i < Math.min(CONCURRENCY, snapshot.channels.length); i++) {
        workers.push(runNext());
      }
      await Promise.all(workers);

      if (!clientGone) {
        write({ type: 'complete', channelCount: snapshot.channels.length });
        write({ type: 'end' });
      }
      res.end();
    } catch (error) {
      logger.error('[UnreadDigest] generation error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        });
      } else {
        write({ type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
        res.end();
      }
    }
  };
}
