import { useEffect } from 'react';
import { logger, type EventType } from '../utils/logger';
import { loadingAnimationDuration, safeRecordMetric } from '../services/otel';
import { wasInterrupted } from '@xyne/shared/hooks';

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
    const startTime = performance.now();

    return () => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      const skewed = wasInterrupted(startTime, endTime);

      logger.info(event, {
        source,
        message,
        durationMs: duration,
        url,
        skewed,
      });

      if (!skewed) {
        safeRecordMetric(() => {
          loadingAnimationDuration.record(duration, {
            source,
            event,
            platform: logger.platformName,
          });
        });
      }
    };
  }, [event, source, message, url]);
};
