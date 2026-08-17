import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

const requests: CapturedRequest[] = [];

afterEach(() => {
  requests.length = 0;
  vi.unstubAllGlobals();
});

describe('direct API operations', () => {
  it('sends channel creation as authenticated JSON', async () => {
    stubFetch({ id: 'channel-1', channelId: 'channel-1' });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com', token: 'token-1' });

    await expect(
      sdk.channels.create({
        scopeType: 'DEFAULT',
        projectId: 'project-1',
        name: 'SDK channel',
      })
    ).resolves.toEqual({ id: 'channel-1' });

    const request = requests[0];
    expect(request?.url).toBe('https://spaces.example.com/api/sdk/channels');
    expect(request?.init.method).toBe('POST');
    expect(request?.init.headers).toMatchObject({
      Authorization: 'Bearer token-1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(request?.init.body))).toMatchObject({
      scopeType: 'DEFAULT',
      projectId: 'project-1',
      name: 'SDK channel',
    });
  });

  it('preserves ticket arrays in the JSON variant', async () => {
    stubFetch({ id: 'ticket-1', conversationId: 'conversation-1', xyneId: 'SDK-1' });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com' });

    await sdk.tickets.create({
      title: 'Fix upload',
      description: 'Multipart support',
      projectId: 'project-1',
      boardId: 'board-1',
      channelId: 'channel-1',
      tags: ['sdk', 'upload'],
      draftAttachmentIds: ['attachment-1'],
    });

    const body = JSON.parse(String(requests[0]?.init.body)) as Record<string, unknown>;
    expect(body['tags']).toEqual(['sdk', 'upload']);
    expect(body['draftAttachmentIds']).toEqual(['attachment-1']);
  });

  it('uses multipart without overriding its boundary for conversation files', async () => {
    stubFetch({
      conversationId: 'conversation-1',
      initialMessage: { messageId: 'message-1' },
    });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com' });

    await expect(
      sdk.conversations.createWithAttachments({
        channelId: 'channel/1',
        content: 'See attached',
        files: [
          {
            file: new Blob(['hello'], { type: 'text/plain' }),
            filename: 'hello.txt',
            width: 10,
          },
        ],
      })
    ).resolves.toEqual({ conversationId: 'conversation-1', messageId: 'message-1' });

    const request = requests[0];
    expect(request?.url).toBe(
      'https://spaces.example.com/api/sdk/channels/channel%2F1/conversations'
    );
    const headers = request?.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(request?.init.body).toBeInstanceOf(FormData);
    const form = request?.init.body as FormData;
    expect(form.get('content')).toBe('See attached');
    expect((form.get('files') as File).name).toBe('hello.txt');
    expect(JSON.parse(String(form.get('fileMetadata')))).toEqual([
      { fileIndex: 0, hasThumbnail: false, width: 10 },
    ]);
  });

  it('generates hidden ids for draft uploads', async () => {
    stubFetch({
      success: true,
      uploadedAttachments: [],
      totalCount: 0,
      successCount: 0,
      failureCount: 0,
    });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com' });

    await sdk.attachments.uploadDraft({
      channelId: 'channel-1',
      files: [new Blob(['one']), new Blob(['two'])],
    });

    const form = requests[0]?.init.body as FormData;
    const attachmentIds = JSON.parse(String(form.get('attachmentIds'))) as string[];
    expect(attachmentIds).toHaveLength(2);
    expect(new Set(attachmentIds).size).toBe(2);
    expect(String(form.get('draftMessageId'))).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('OAuth catalog operations', () => {
  it('routes reads through the v1 catalog with the bearer token', async () => {
    stubFetch({ data: [{ id: 'status-1', channel: { id: 'channel-1', name: 'general' } }] });
    const sdk = createClient({ baseUrl: 'http://localhost:3001', token: 'sdk-access-token' });

    await expect(sdk.channels.list()).resolves.toHaveLength(1);

    const request = requests[0];
    expect(request?.url).toBe('http://localhost:3001/api/sdk/catalog/query');
    expect(request?.init.headers).toMatchObject({ Authorization: 'Bearer sdk-access-token' });
    expect(JSON.parse(String(request?.init.body))).toEqual({ name: 'userVisibleChannelsV3' });
  });

  it('routes writes through the v1 catalog', async () => {
    stubFetch({ success: true });
    const sdk = createClient({ baseUrl: 'http://localhost:3001', token: 'sdk-access-token' });

    await sdk.channels.rename('channel-1', 'General');

    const request = requests[0];
    expect(request?.url).toBe('http://localhost:3001/api/sdk/catalog/mutate');
    expect(JSON.parse(String(request?.init.body))).toMatchObject({
      name: 'channel.renameChannel',
      args: { channelId: 'channel-1', name: 'General' },
    });
  });
});

function stubFetch(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}
