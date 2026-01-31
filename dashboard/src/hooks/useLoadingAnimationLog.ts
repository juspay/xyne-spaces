import { useEffect } from 'react';
import { logger, type EventType } from '../utils/logger';
import { loadingAnimationDuration, safeRecordMetric } from '../services/otel';

interface UseLoadingAnimationLogParams {
  event: EventType;
  source: string;
  message: string;
  url?: string;
}

export const useLoadingAnimationLog = ({
  event,
  source,
  message,
  url,
}: UseLoadingAnimationLogParams): void => {
  useEffect(() => {
    const startTime = Date.now();

    return () => {
      const endTime = Date.now();
      const duration = endTime - startTime;

      logger.info(event, {
        source,
        message,
        durationMs: duration,
        url,
      });

      safeRecordMetric(() => {
        loadingAnimationDuration.record(duration, {
          source,
          event,
          platform: logger.platformName,
        });
      });
    };
  }, [event, source, message, url]);
};
