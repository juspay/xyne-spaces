import http from 'node:http';
import type { AddressInfo } from 'node:net';

let allowed = true;
jest.mock('@/services/orgLLMCredentialService', () => ({
  isAllowedLiteLLMBaseUrl: () => allowed,
}));
jest.mock('@/utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { LLMClient, createUserMessage } from './litellmClient';

type Handler = (body: Record<string, unknown>, res: http.ServerResponse) => void;

describe('LLMClient', () => {
  let server: http.Server;
  let baseUrl: string;
  let handler: Handler;
  let requests: Array<{ body: Record<string, unknown>; auth?: string }>;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        requests.push({ body, auth: req.headers.authorization });
        handler(body, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    allowed = true;
    requests = [];
  });

  const client = (extra: Partial<ConstructorParameters<typeof LLMClient>[0]> = {}) =>
    new LLMClient({
      provider: { type: 'litellm', config: { apiKey: 'k', baseUrl, timeout: 2_000 } },
      defaultModel: 'm',
      retry: { baseDelay: 1 },
      ...extra,
    });

  it('sends the prompt and returns content, usage and finish reason', async () => {
    handler = (_body, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'r1',
          model: 'm',
          choices: [{ message: { content: 'hello', reasoning_content: 'hmm' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        }),
      );
    };
    const response = await client({ temperature: 0.1 }).generate({
      systemPrompt: 'sys',
      messages: [createUserMessage('hi')],
      parameters: { temperature: 0.9, maxTokens: 10 },
      extraBody: { chat_template_kwargs: { enable_thinking: false } },
    });

    expect(response.content).toBe('hello');
    expect(response.thinking).toBe('hmm');
    expect(response.usage).toEqual({ promptTokens: 3, completionTokens: 1, totalTokens: 4 });
    expect(response.finishReason).toBe('stop');
    expect(requests[0].auth).toBe('Bearer k');
    expect(requests[0].body).toMatchObject({
      model: 'm',
      temperature: 0.1,
      max_tokens: 10,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    });
  });

  it('retries a 503 and then succeeds', async () => {
    let calls = 0;
    handler = (_body, res) => {
      calls += 1;
      if (calls === 1) {
        res.statusCode = 503;
        res.end('busy');
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
    };
    const response = await client().generate({ messages: [createUserMessage('hi')] });
    expect(response.content).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not retry a 400', async () => {
    handler = (_body, res) => {
      res.statusCode = 400;
      res.end('bad');
    };
    await expect(client().generate({ messages: [createUserMessage('hi')] })).rejects.toThrow('HTTP 400');
    expect(requests).toHaveLength(1);
  });

  it('streams content and thinking chunks and resolves the final message', async () => {
    handler = (body, res) => {
      expect(body.stream).toBe(true);
      res.setHeader('Content-Type', 'text/event-stream');
      const events = [
        { choices: [{ delta: { reasoning_content: 'think' } }] },
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
      ];
      for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end('data: [DONE]\n\n');
    };
    const result = await client().generateStream({ messages: [createUserMessage('hi')] });
    const types: string[] = [];
    let text = '';
    for await (const chunk of result.stream) {
      types.push(chunk.type);
      if (chunk.type === 'content') text += chunk.content;
    }
    expect(text).toBe('Hello');
    expect(types).toEqual(['thinking', 'content', 'content', 'metadata', 'done']);
    const final = await result.finalMessage;
    expect(final.content).toBe('Hello');
    expect(final.thinking).toBe('think');
  });

  it('refuses a base URL other than LITELLM_BASE_URL', () => {
    allowed = false;
    expect(() => client()).toThrow('LITELLM_BASE_URL');
  });
});
