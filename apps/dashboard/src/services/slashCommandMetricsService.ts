/**
 * Slash Command Metrics Service
 *
 * Logs the Cmd+K slash-command usage funnel (session_start → impression →
 * click → session_end). Mirrors the *logging* half of `searchMetricsService`
 * but is logs-only: no OpenTelemetry metrics and no sudoQuery. Each funnel
 * stage emits one structured bridge log whose fields become top-level
 * queryable fields in VictoriaLogs.
 */

import { logger, Event } from '../utils/logger';
import type {
  SlashCommandSessionStartEvent,
  SlashCommandImpressionEvent,
  SlashCommandClickEvent,
  SlashCommandSessionEndEvent,
  SlashImpressionStage,
  SlashClickStage,
  SlashSelectionType,
  SlashReachedStage,
  SlashSessionEndReason,
} from '../types/slashCommandEvents';

class SlashCommandMetricsService {
  /** Track the start of a slash-command session (command mode entered). */
  trackSessionStart(slashSessionId: string, userId: string): void {
    const event: SlashCommandSessionStartEvent = {
      slash_session_id: slashSessionId,
      user_id: userId,
    };
    logger.info(Event.SLASH_COMMAND_SESSION_START, event as unknown as Record<string, unknown>);
  }

  /** Track that the palette displayed a set of options. */
  trackImpression(params: {
    slashSessionId: string;
    userId: string;
    stage: SlashImpressionStage;
    command: string | null;
    optionsCount: number;
    typedText: string;
  }): void {
    const event: SlashCommandImpressionEvent = {
      slash_session_id: params.slashSessionId,
      user_id: params.userId,
      stage: params.stage,
      command: params.command,
      options_count: params.optionsCount,
      typed_text: params.typedText,
    };
    logger.info(Event.SLASH_COMMAND_IMPRESSION, event as unknown as Record<string, unknown>);
  }

  /** Track a command-row apply or a target-row pick, with the selection gesture. */
  trackClick(params: {
    slashSessionId: string;
    userId: string;
    stage: SlashClickStage;
    command: string;
    selectionType: SlashSelectionType;
    terminal: boolean;
    targetType?: 'user' | 'channel';
    destination?: string;
  }): void {
    const event: SlashCommandClickEvent = {
      slash_session_id: params.slashSessionId,
      user_id: params.userId,
      stage: params.stage,
      command: params.command,
      selection_type: params.selectionType,
      terminal: params.terminal,
      // exactOptionalPropertyTypes: only attach the optional keys when present.
      ...(params.targetType && { target_type: params.targetType }),
      ...(params.destination && { destination: params.destination }),
    };
    logger.info(Event.SLASH_COMMAND_CLICK, event as unknown as Record<string, unknown>);
  }

  /** Track the end of a slash-command session. */
  trackSessionEnd(params: {
    slashSessionId: string;
    userId: string;
    endReason: SlashSessionEndReason;
    command: string | null;
    reachedStage: SlashReachedStage;
    totalImpressions: number;
    dwellTimeMs: number;
    totalSessionDurationMs: number;
  }): void {
    const event: SlashCommandSessionEndEvent = {
      slash_session_id: params.slashSessionId,
      user_id: params.userId,
      end_reason: params.endReason,
      command: params.command,
      reached_stage: params.reachedStage,
      total_impressions: params.totalImpressions,
      dwell_time_ms: params.dwellTimeMs,
      total_session_duration_ms: params.totalSessionDurationMs,
    };
    logger.info(Event.SLASH_COMMAND_SESSION_END, event as unknown as Record<string, unknown>);
  }
}

// Singleton instance
export const slashCommandMetricsService = new SlashCommandMetricsService();
