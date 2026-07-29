import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import {
  SignalType,
  SignalCategory,
  SignalConfig,
  SIGNAL_CONFIGS,
  ChannelSignalPayload,
  UserSignalPayload,
  SignalCaptureResult,
  SignalPayload
} from './types';

export class PersonalizationSignalService {
  async captureChannelSignal(
    payload: ChannelSignalPayload
  ): Promise<SignalCaptureResult> {
    const { userId, channelId, signalType, metadata } = payload;
    try {
      // Get signal configuration
      const config = this.getSignalConfig(signalType);

      // Validate category
      if (config.category !== SignalCategory.CHANNEL) {
        throw new Error(
          `Signal type ${signalType} is not a channel signal (category: ${config.category})`
        );
      }

      // Use provided weight or default
      const finalWeight = config.defaultWeight;

      // Generate Redis key
      const key = config.redisKeyPattern.replace('{userId}', userId);
      const member = `channel:${channelId}`;

      // Capture signal using ZINCRBY (atomic increment)
      const redis = redisService.getClient();
      await redis.zincrby(key, finalWeight, member);

      logger.debug('[PERSONALIZATION] Channel signal captured', {
        userId,
        channelId,
        signalType,
        weight: finalWeight,
        metadata
      });

      return { success: true, signalType };

    } catch (error) {
      logger.error('[PERSONALIZATION] Failed to capture channel signal', {
        userId,
        channelId,
        signalType,
        error: error instanceof Error ? error.message : error
      });

      return {
        success: false,
        signalType,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Capture a user-to-user interaction signal
   * 
   * This method is non-blocking and will not throw errors.
   */
  async captureUserSignal(
    payload: UserSignalPayload
  ): Promise<SignalCaptureResult> {
    const { fromUserId, toUserId, signalType, metadata } = payload;

    try {
      // Get signal configuration
      const config = this.getSignalConfig(signalType);

      // Validate category
      if (config.category !== SignalCategory.USER) {
        throw new Error(
          `Signal type ${signalType} is not a user signal (category: ${config.category})`
        );
      }

      // Use provided weight or default
      const finalWeight = config.defaultWeight;

      // Generate Redis key
      const key = config.redisKeyPattern.replace('{userId}', fromUserId);
      const member = `user:${toUserId}`;

      // Capture signal using ZINCRBY (atomic increment)
      const redis = redisService.getClient();
      await redis.zincrby(key, finalWeight, member);

      logger.debug('[PERSONALIZATION] User signal captured', {
        fromUserId,
        toUserId,
        signalType,
        weight: finalWeight,
        metadata
      });

      return { success: true, signalType };

    } catch (error) {
      logger.error('[PERSONALIZATION] Failed to capture user signal', {
        fromUserId,
        toUserId,
        signalType,
        error: error instanceof Error ? error.message : error
      });

      return {
        success: false,
        signalType,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Batch capture multiple signals at once
   * 
   * Useful when multiple signals are generated from a single action.
   * All signals are captured in parallel for efficiency.
   */
  async captureBatch(
    signals: SignalPayload[]
  ): Promise<SignalCaptureResult[]> {
    const results = await Promise.allSettled(
      signals.map(signal => {
        if ('channelId' in signal) {
          return this.captureChannelSignal(signal);
        } else {
          return this.captureUserSignal(signal);
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const signal = signals[index];
        const signalType = signal.signalType;
        return {
          success: false,
          signalType,
          error: new Error(result.reason)
        };
      }
    });
  }


  captureChannelSignalInBackground(payload: ChannelSignalPayload): void {
    this.captureChannelSignal(payload).catch(err => {
      logger.error('[PERSONALIZATION] InBackground channel signal capture failed', {
        payload,
        error: err
      });
    });
  }
  
  captureUserSignalInBackground(payload: UserSignalPayload): void {
    this.captureUserSignal(payload).catch(err => {
      logger.error('[PERSONALIZATION] InBackground user signal capture failed', {
        payload,
        error: err
      });
    });
  }


  captureBatchInBackground(signals: SignalPayload[]): void {
    this.captureBatch(signals).catch(err => {
      logger.error('[PERSONALIZATION] InBackground batch signal capture failed', {
        signalCount: signals.length,
        error: err
      });
    });
  }

  /**
   * Get signal configuration
   */
  private getSignalConfig(signalType: SignalType): SignalConfig {
    const config = SIGNAL_CONFIGS[signalType];
    if (!config) {
      throw new Error(`Unknown signal type: ${signalType}`);
    }
    return config;
  }
}

// Export singleton instance
export const personalizationSignalService = new PersonalizationSignalService();
