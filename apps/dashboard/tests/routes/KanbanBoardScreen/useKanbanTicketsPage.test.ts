import assert from 'node:assert/strict';
import test from 'node:test';
import { withTicketChannelScope } from '../../../src/routes/KanbanBoardScreen/ticketChannelScope.ts';

void test('keeps the current channel in ticket query arguments', () => {
  const args = withTicketChannelScope(
    { viewMode: 'project' as const, projectId: 'project-1' },
    'channel-1',
  );

  assert.equal(args.channelId, 'channel-1');
});

void test('leaves workspace-wide ticket query arguments unscoped', () => {
  const args = withTicketChannelScope({ viewMode: 'my-tickets' as const });

  assert.equal('channelId' in args, false);
});
