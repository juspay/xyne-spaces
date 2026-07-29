import { logger } from '@/utils/logger';
import { config as envConfig } from '@/config/env';

const CLASSIFIER_URL = envConfig.messageClassifier.url;
const CLASSIFIER_TIMEOUT_MS = envConfig.messageClassifier.timeoutMs;

export interface ClassificationResult {
  label: 'HEAVY' | 'OTHER';
  confidence: number;
}

interface ClassifierHealthResponse {
  status: string;
  model_loaded: boolean;
  model_path: string;
}

const isClassifierHealthResponse = (value: unknown): value is ClassifierHealthResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.status === 'string' &&
    typeof record.model_loaded === 'boolean' &&
    typeof record.model_path === 'string'
  );
};

const isClassificationResult = (value: unknown): value is ClassificationResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.label === 'HEAVY' || record.label === 'OTHER') &&
    typeof record.confidence === 'number'
  );
};

class MessageClassifierService {
  private baseUrl: string;
  private timeoutMs: number;
  private isAvailable: boolean | null = null;
  private lastHealthCheck: number = 0;
  private healthCheckIntervalMs = 60000; // Re-check availability every 60s

  constructor() {
    this.baseUrl = CLASSIFIER_URL;
    this.timeoutMs = CLASSIFIER_TIMEOUT_MS;
  }

  private async checkAvailability(): Promise<boolean> {
    const now = Date.now();

    // Use cached result if recent
    if (this.isAvailable !== null && now - this.lastHealthCheck < this.healthCheckIntervalMs) {
      return this.isAvailable;
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (response.ok) {
        const payload = await response.json();
        if (!isClassifierHealthResponse(payload)) {
          logger.warn('Message classifier health response invalid', {
            url: this.baseUrl,
            payload,
          });
          this.isAvailable = false;
          this.lastHealthCheck = now;
          return false;
        }
        const health = payload;
        this.isAvailable = health.model_loaded;
        this.lastHealthCheck = now;

        if (this.isAvailable) {
          logger.info('Message classifier service available', {
            url: this.baseUrl,
            modelPath: health.model_path,
          });
        } else {
          logger.warn('Message classifier service running but model not loaded', {
            url: this.baseUrl,
            status: health.status,
          });
        }

        return this.isAvailable;
      }

      this.isAvailable = false;
      this.lastHealthCheck = now;
      return false;
    } catch (error) {
      if (this.isAvailable !== false) {
        // Only log on first failure or state change
        logger.warn('Message classifier service unavailable', {
          url: this.baseUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.isAvailable = false;
      this.lastHealthCheck = now;
      return false;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private normalize(text: string): string {
    return text
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .toLowerCase()
      .replace(/@\S+/g, '@user')
      .replace(/([.!?,;:/()"'])/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async classify(text: string): Promise<ClassificationResult> {
    const available = await this.checkAvailability();
    if (!available) {
      return { label: 'OTHER', confidence: 0 };
    }

    const normalized = this.normalize(text);
    if (!normalized) {
      return { label: 'OTHER', confidence: 1 };
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.baseUrl}/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: normalized }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Message classifier returned error', {
          status: response.status,
          error: errorText,
        });
        return { label: 'OTHER', confidence: 0 };
      }

      const payload = await response.json();
      if (!isClassificationResult(payload)) {
        logger.error('Message classifier response invalid', { payload });
        return { label: 'OTHER', confidence: 0 };
      }
      const result = payload;
      return {
        label: result.label === 'HEAVY' ? 'HEAVY' : 'OTHER',
        confidence: result.confidence,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn('Message classification timed out', { timeoutMs: this.timeoutMs });
      } else {
        logger.error('Message classification failed', error);
      }
      return { label: 'OTHER', confidence: 0 };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async isHeavy(text: string, minConfidence: number = 0.5): Promise<boolean> {
    const result = await this.classify(text);
    return result.label === 'HEAVY' && result.confidence >= minConfidence;
  }

  getStatus(): { available: boolean; url: string } {
    return {
      available: this.isAvailable ?? false,
      url: this.baseUrl,
    };
  }
}

export const messageClassifierService = new MessageClassifierService();
