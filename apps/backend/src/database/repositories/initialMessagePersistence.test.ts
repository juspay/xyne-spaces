import { readFileSync } from 'fs';
import { join } from 'path';

describe('initial DM message persistence boundary', () => {
  const source = readFileSync(
    join(__dirname, '../../controllers/channelController.ts'),
    'utf8',
  );
  const start = source.indexOf('private async sendInitialMessage');
  const end = source.indexOf('// Helper method to send a forwarded message', start);
  const method = source.slice(start, end);

  it('creates the conversation and initial message in one transaction', () => {
    expect(method).toContain('db.$transaction');
    expect(method).toContain('conversationRepository.createInTransaction');
    expect(method).toContain('messageRepository.createInTransaction');
  });

  it('does not turn a post-commit side-effect failure into a send failure', () => {
    const postCommit = method.slice(method.indexOf('const runPostCommitStep'));
    expect(postCommit).not.toContain('return null');
    expect(postCommit).toContain('Initial message persisted but');
  });
});
