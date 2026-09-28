import { describe, expect, it } from 'vitest';
import type { MutatorResultDetails } from '@rocicorp/zero';
import { requireServerMutation } from './serverMutation';

describe('waiting for a Zero mutation', () => {
  it('does not complete before the server accepts the mutation', async () => {
    let resolveServer: (result: MutatorResultDetails) => void = () => undefined;
    const server = new Promise<MutatorResultDetails>(resolve => {
      resolveServer = resolve;
    });
    let completed = false;
    const waiting = requireServerMutation({ server }, 'Could not reopen the conversation.').then(
      () => {
        completed = true;
      },
    );

    await Promise.resolve();
    expect(completed).toBe(false);

    resolveServer({ type: 'success' });
    await waiting;
    expect(completed).toBe(true);
  });

  it('retains partial-completion context when the server rejects the mutation', async () => {
    const server: Promise<MutatorResultDetails> = Promise.resolve({
      type: 'error',
      error: { type: 'app', message: 'One member could not be added.', details: undefined },
    });

    await expect(
      requireServerMutation(
        { server },
        'The channel was created, but its members could not be added.',
      ),
    ).rejects.toThrow(
      'The channel was created, but its members could not be added. One member could not be added.',
    );
  });
});
