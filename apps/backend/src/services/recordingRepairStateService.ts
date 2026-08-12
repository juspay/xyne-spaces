import { redisService } from '@/services/redisService';

export type RecordingRepairStatus = 'OPEN' | 'FINALIZED' | 'PROCESSING' | 'MERGED' | 'FAILED';
export type RecordingRepairReason = 'browser_offline' | 'livekit_disconnected' | 'reconnect_timeout' | 'agent_left' | 'stt_failed';

export interface RecordingRepairOutage {
  startedAt: number;
  endedAt: number;
  reasons: RecordingRepairReason[];
}

export interface RecordingRepairCaptureState {
  status: RecordingRepairStatus;
  outages: RecordingRepairOutage[];
  finalizedAt: number | null;
  processingError: string | null;
  mergedAt: number | null;
  retryable: boolean;
}

const MERGED_RETENTION_SECONDS = 30 * 24 * 60 * 60;

class RecordingRepairStateService {
  key(callId: string, captureId: string): string {
    return `recording-repair:${callId}:${captureId}`;
  }

  async get(callId: string, captureId: string): Promise<RecordingRepairCaptureState | null> {
    const fields = await redisService.getClient().hgetall(this.key(callId, captureId));
    if (!fields.status) return null;
    return {
      status: fields.status as RecordingRepairStatus,
      outages: JSON.parse(fields.outages || '[]') as RecordingRepairOutage[],
      finalizedAt: fields.finalizedAt ? Number(fields.finalizedAt) : null,
      processingError: fields.processingError || null,
      mergedAt: fields.mergedAt ? Number(fields.mergedAt) : null,
      retryable: fields.retryable !== 'false',
    };
  }

  async finalize(callId: string, captureId: string, outages: RecordingRepairOutage[]): Promise<RecordingRepairCaptureState> {
    const key = this.key(callId, captureId);
    const now = Date.now();
    const result = await redisService.getClient().eval(`
      local current = redis.call('HGET', KEYS[1], 'status')
      if not current then
        redis.call('HSET', KEYS[1], 'status', 'FINALIZED', 'outages', ARGV[1], 'finalizedAt', ARGV[2], 'processingError', '', 'mergedAt', '', 'retryable', 'true')
        return 'FINALIZED'
      end
      return current
    `, 1, key, JSON.stringify(outages), String(now)) as string;
    const state = await this.get(callId, captureId);
    if (!state) throw new Error(`Recording repair state disappeared: ${result}`);
    return state;
  }

  async claim(callId: string, captureId: string): Promise<RecordingRepairCaptureState | null> {
    const key = this.key(callId, captureId);
    const claimed = await redisService.getClient().eval(`
      local status = redis.call('HGET', KEYS[1], 'status')
      local retryable = redis.call('HGET', KEYS[1], 'retryable')
      if status == 'FINALIZED' or status == 'PROCESSING' or (status == 'FAILED' and retryable ~= 'false') then
        redis.call('HSET', KEYS[1], 'status', 'PROCESSING', 'processingError', '')
        return 1
      end
      return 0
    `, 1, key);
    return Number(claimed) === 1 ? this.get(callId, captureId) : null;
  }

  async markMerged(callId: string, captureId: string): Promise<void> {
    const client = redisService.getClient();
    const key = this.key(callId, captureId);
    await client.multi()
      .hset(key, 'status', 'MERGED', 'processingError', '', 'mergedAt', String(Date.now()))
      .expire(key, MERGED_RETENTION_SECONDS)
      .exec();
  }

  async markFailed(callId: string, captureId: string, error: string, retryable = true): Promise<void> {
    await redisService.getClient().hset(
      this.key(callId, captureId),
      'status', 'FAILED',
      'processingError', error.slice(0, 1000),
      'retryable', String(retryable),
    );
  }

  async findPending(): Promise<Array<{ callId: string; captureId: string }>> {
    const client = redisService.getClient();
    let cursor = '0';
    const pending: Array<{ callId: string; captureId: string }> = [];
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'recording-repair:*', 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        const [status, retryable] = await client.hmget(key, 'status', 'retryable');
        if (status !== 'FINALIZED' && status !== 'PROCESSING' && (status !== 'FAILED' || retryable === 'false')) continue;
        const [, callId, ...captureParts] = key.split(':');
        const captureId = captureParts.join(':');
        if (callId && captureId) pending.push({ callId, captureId });
      }
    } while (cursor !== '0');
    return pending;
  }
}

export const recordingRepairStateService = new RecordingRepairStateService();
