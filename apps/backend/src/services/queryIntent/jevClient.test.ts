import { askJev, type JevChoiceQuestion, type JevConnection } from './jevClient';

const connection: JevConnection = {
  url: 'https://jev.test/v1',
  apiKey: 'test-key',
  model: 'jev-test',
};

function choiceQuestion(optionCount: number): JevChoiceQuestion {
  return {
    type: 'choice',
    instructions: 'Pick the matching option.',
    criteria: Object.fromEntries(
      Array.from({ length: optionCount }, (_, index) => [`option-${index}`, `Option ${index}`])
    ),
  };
}

function jevResponse(): Response {
  return {
    ok: true,
    json: async () => ({
      answers: {
        intent: {
          type: 'choice',
          choice: 'option-0',
          confidence: 1,
          probabilities: {},
        },
      },
    }),
  } as Response;
}

describe('Jev choice option limits', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends a choice with the maximum supported 255 options', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jevResponse());

    const result = await askJev('request', { intent: choiceQuestion(255) }, 1_000, connection);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result?.intent).toMatchObject({ type: 'choice', choice: 'option-0' });
  });

  it('rejects a choice over the provider limit before making a request', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');

    const result = await askJev('request', { intent: choiceQuestion(256) }, 1_000, connection);

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
