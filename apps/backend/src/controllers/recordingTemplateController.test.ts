const verify = jest.fn();
const findByExternalId = jest.fn();
const findActiveByCallId = jest.fn();
const recorderKey = jest.fn();

jest.mock('livekit-server-sdk', () => ({ TokenVerifier: jest.fn(() => ({ verify })) }));
jest.mock('@/config/env', () => ({ config: { livekit: { apiKey: 'key', apiSecret: 'secret' } } }));
jest.mock('@/database/repositories', () => ({
  repositories: { calls: { findByExternalId }, callRecordings: { findActiveByCallId } },
}));
jest.mock('@/services/callEncryptionService', () => ({ callEncryptionService: { recorderKey } }));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

import type { Request, Response } from 'express';
import { recordingTemplateController } from './recordingTemplateController';

const call = { id: 'call-1', externalId: 'room-1' };

function respond(
  body: unknown
): Promise<{ status: number; json: unknown; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    const out = { status: 200, json: undefined as unknown, headers: {} as Record<string, string> };
    const res = {
      set: (k: string, v: string) => {
        out.headers[k] = v;
        return res;
      },
      status: (code: number) => {
        out.status = code;
        return res;
      },
      json: (value: unknown) => {
        out.json = value;
        resolve(out);
        return res;
      },
    } as unknown as Response;
    void recordingTemplateController.callKey({ body } as Request, res);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  verify.mockResolvedValue({ video: { room: 'room-1', recorder: true, roomJoin: true } });
  findByExternalId.mockResolvedValue(call);
  findActiveByCallId.mockResolvedValue({ id: 'rec-1' });
  recorderKey.mockReturnValue('the-call-key');
});

describe('recording template call key', () => {
  it("releases the call key to egress's recorder token while the call is recording", async () => {
    const res = await respond({ token: 'egress-token' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      success: true,
      roomName: 'room-1',
      credentials: { key: 'the-call-key' },
    });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(verify).toHaveBeenCalledWith('egress-token');
    expect(findByExternalId).toHaveBeenCalledWith('room-1');
  });

  it('refuses a participant token (no recorder grant) and any token that does not verify', async () => {
    verify.mockResolvedValueOnce({ video: { room: 'room-1', roomJoin: true } });
    expect((await respond({ token: 'participant' })).status).toBe(403);
    verify.mockRejectedValueOnce(new Error('signature verification failed'));
    expect((await respond({ token: 'forged' })).status).toBe(403);
    verify.mockResolvedValueOnce({ video: { recorder: true } });
    expect((await respond({ token: 'no-room' })).status).toBe(403);
    expect(recorderKey).not.toHaveBeenCalled();
  });

  it('releases nothing when the call is not recording, unknown, or keyed only by the encryption service', async () => {
    findActiveByCallId.mockResolvedValueOnce(null);
    expect((await respond({ token: 't' })).status).toBe(404);
    findByExternalId.mockResolvedValueOnce(null);
    expect((await respond({ token: 't' })).status).toBe(404);
    recorderKey.mockReturnValueOnce(null);
    expect((await respond({ token: 't' })).status).toBe(404);
  });

  it('rejects a request without a token', async () => {
    expect((await respond({})).status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });
});
