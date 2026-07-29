import { useCallback, useRef } from 'react';
import { slashCommandMetricsService } from '../services/slashCommandMetricsService';
import type {
  SlashImpressionStage,
  SlashClickStage,
  SlashSelectionType,
  SlashReachedStage,
  SlashSessionEndReason,
} from '../types/slashCommandEvents';

/**
 * Owns the slash-command usage-funnel session for the Cmd+K box, mirroring the
 * lifecycle of `useSearchMetrics` but slimmer (logs-only). A session spans one
 * entry into command mode (typing `/`) until a command executes or the box
 * leaves command mode. The parent drives it imperatively:
 *   onSessionStart → onImpression(s) → onClick(s) → onSessionEnd(reason)
 */

interface UseSlashCommandMetricsParams {
  /** Current user id (the actor); logged as `user_id`. */
  userId: string;
}

interface SlashClickPayload {
  stage: SlashClickStage;
  command: string;
  selectionType: SlashSelectionType;
  terminal: boolean;
  targetType?: 'user' | 'channel';
  destination?: string;
}

export interface UseSlashCommandMetricsReturn {
  onSessionStart: () => void;
  onImpression: (
    stage: SlashImpressionStage,
    command: string | null,
    optionsCount: number,
    typedText: string,
  ) => void;
  onClick: (payload: SlashClickPayload) => void;
  onSessionEnd: (reason: SlashSessionEndReason) => void;
}

// Furthest-stage ordering so `reached_stage` reports how far the user got.
const STAGE_ORDER: SlashReachedStage[] = ['opened', 'discovery', 'picker', 'command', 'target'];

export function useSlashCommandMetrics({
  userId,
}: UseSlashCommandMetricsParams): UseSlashCommandMetricsReturn {
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartTimeRef = useRef<number>(0);
  const lastImpressionTimeRef = useRef<number>(0);
  const impressionCountRef = useRef<number>(0);
  const reachedStageIndexRef = useRef<number>(0);
  const lastCommandRef = useRef<string | null>(null);

  const bumpStage = useCallback((stage: SlashReachedStage): void => {
    const index = STAGE_ORDER.indexOf(stage);
    if (index > reachedStageIndexRef.current) reachedStageIndexRef.current = index;
  }, []);

  const onSessionStart = useCallback((): void => {
    const sessionId = `slash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionIdRef.current = sessionId;
    sessionStartTimeRef.current = Date.now();
    lastImpressionTimeRef.current = 0;
    impressionCountRef.current = 0;
    reachedStageIndexRef.current = 0; // 'opened'
    lastCommandRef.current = null;

    slashCommandMetricsService.trackSessionStart(sessionId, userId);
  }, [userId]);

  const onImpression = useCallback(
    (
      stage: SlashImpressionStage,
      command: string | null,
      optionsCount: number,
      typedText: string,
    ): void => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      slashCommandMetricsService.trackImpression({
        slashSessionId: sessionId,
        userId,
        stage,
        command,
        optionsCount,
        typedText,
      });

      lastImpressionTimeRef.current = Date.now();
      impressionCountRef.current += 1;
      bumpStage(stage);
      if (command) lastCommandRef.current = command;
    },
    [userId, bumpStage],
  );

  const onClick = useCallback(
    (payload: SlashClickPayload): void => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      slashCommandMetricsService.trackClick({
        slashSessionId: sessionId,
        userId,
        stage: payload.stage,
        command: payload.command,
        selectionType: payload.selectionType,
        terminal: payload.terminal,
        ...(payload.targetType && { targetType: payload.targetType }),
        ...(payload.destination && { destination: payload.destination }),
      });

      bumpStage(payload.stage);
      lastCommandRef.current = payload.command;
    },
    [userId, bumpStage],
  );

  const onSessionEnd = useCallback(
    (reason: SlashSessionEndReason): void => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      const now = Date.now();
      const dwellTimeMs =
        lastImpressionTimeRef.current > 0 ? now - lastImpressionTimeRef.current : 0;
      const totalSessionDurationMs =
        sessionStartTimeRef.current > 0 ? now - sessionStartTimeRef.current : 0;

      slashCommandMetricsService.trackSessionEnd({
        slashSessionId: sessionId,
        userId,
        endReason: reason,
        command: lastCommandRef.current,
        reachedStage: STAGE_ORDER[reachedStageIndexRef.current] ?? 'opened',
        totalImpressions: impressionCountRef.current,
        dwellTimeMs,
        totalSessionDurationMs,
      });

      // Reset for the next session.
      sessionIdRef.current = null;
      sessionStartTimeRef.current = 0;
      lastImpressionTimeRef.current = 0;
      impressionCountRef.current = 0;
      reachedStageIndexRef.current = 0;
      lastCommandRef.current = null;
    },
    [userId],
  );

  return { onSessionStart, onImpression, onClick, onSessionEnd };
}
