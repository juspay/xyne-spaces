import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { MessageType } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { PERF_REPORT_CHANNEL_ID } from '../../config';
import { diagnosticsStore } from './store';
import { buildChannelReportHtml } from './report';
import { logger, Event } from '../../utils/logger';

/**
 * Posts the current diagnostics summary into the configured channel, which is
 * what an automation watches to hand the report to an agent.
 *
 * Returns null when no channel is configured, so the panel can hide the button
 * rather than offering an action that would silently go nowhere.
 */
export function useRequestPerformanceHelp(): (() => Promise<void>) | null {
  const zero = useZero();

  const request = useCallback(async (): Promise<void> => {
    const snapshot = diagnosticsStore.getSnapshot();
    const result = zero.mutate(
      mutators.conversations.send({
        channelId: PERF_REPORT_CHANNEL_ID,
        content: buildChannelReportHtml(snapshot),
        conversationId: uuidv4(),
        messageId: uuidv4(),
        timestamp: Date.now(),
        type: MessageType.USER,
      }),
    );
    // Wait for the server ack, not the optimistic local write: the automation
    // only fires once the message actually lands, so "Sent" must mean that.
    await result.server;
    logger.info(Event.DIAGNOSTICS_HELP_REQUESTED, {
      overall: snapshot.overall,
      channelId: PERF_REPORT_CHANNEL_ID,
    });
  }, [zero]);

  return PERF_REPORT_CHANNEL_ID ? request : null;
}
