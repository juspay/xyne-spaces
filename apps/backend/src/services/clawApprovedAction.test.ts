import { approvedActionInstructions } from './clawApprovedAction';

describe('approvedActionInstructions', () => {
  it('hands the agent the approved result and tells it to finish without tools', () => {
    const text = approvedActionInstructions({
      tool: 'spaces-create-ticket',
      result: 'Created ticket XYNE-101 "Fix login"',
    });
    expect(text).toContain('- Tool: spaces-create-ticket');
    expect(text).toContain('Approved result:\nCreated ticket XYNE-101 "Fix login"');
    expect(text).toContain('Do not call tools');
  });

  it('marks an empty result instead of leaving a blank', () => {
    expect(approvedActionInstructions({ tool: 'spaces-send-message', result: '  ' })).toContain(
      'Approved result:\n(empty output)'
    );
  });

  it('caps a long result', () => {
    const text = approvedActionInstructions({ tool: 'x', result: 'a'.repeat(8_000) });
    expect(text).toContain('... (truncated)');
    expect(text.length).toBeLessThan(6_000);
  });

  it('asks the agent to explain a failed action', () => {
    const text = approvedActionInstructions({
      tool: 'spaces-create-ticket',
      error: 'boardId is required',
    });
    expect(text).toContain('it failed');
    expect(text).toContain('- Error: boardId is required');
    expect(text).not.toContain('Approved result');
  });

  it('prefers the error when both are present', () => {
    const text = approvedActionInstructions({ tool: 'x', result: 'ok', error: 'boom' });
    expect(text).toContain('- Error: boom');
  });
});
