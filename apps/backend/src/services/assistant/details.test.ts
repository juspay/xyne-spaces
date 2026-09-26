import { ACTIONS } from '@xyne/shared/assistant';
import { detailsPrompt, NO_DETAILS, parseDetailsReply } from './details';

const candidates = [...ACTIONS.values()];

describe('reading details with the language model', () => {
  it('describes every candidate action from its own field descriptions', () => {
    const [system, user] = detailsPrompt('tell Priya hi', candidates, null);
    expect(system?.content).toContain('Never guess');
    const request = JSON.parse(user?.content ?? '{}');
    expect(request.request).toBe('tell Priya hi');
    expect(request.actions.map((action: { id: string }) => action.id)).toEqual([
      'send_dm',
      'create_channel',
    ]);
    expect(request.actions[1].fields.visibility).toEqual({
      means: 'public (anyone in the workspace) or private (invited members only)',
      kind: 'choice',
      options: ['public', 'private'],
    });
  });

  it('reads the reply, including one wrapped in a code fence', () => {
    expect(
      parseDetailsReply('```json\n{"action":"send_dm","fields":{"recipient":"Priya","message":"hi"}}\n```', candidates),
    ).toEqual({ action: 'send_dm', fields: { recipient: 'Priya', message: 'hi' } });
  });

  it('gives no details for anything unexpected, and drops unknown actions', () => {
    expect(parseDetailsReply('not json', candidates)).toBe(NO_DETAILS);
    expect(parseDetailsReply('{"fields": 5}', candidates)).toBe(NO_DETAILS);
    expect(parseDetailsReply('{"action":"launch_rocket","fields":{}}', candidates)).toEqual({
      action: null,
      fields: {},
    });
  });
});
