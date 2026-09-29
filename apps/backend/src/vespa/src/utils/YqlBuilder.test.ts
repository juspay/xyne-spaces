import { messageSchema } from '../types';
import { YqlBuilder } from './YqlBuilder';

describe('chat participant filter mode', () => {
  const build = (participantsMode?: 'any' | 'all'): string =>
    new YqlBuilder().buildYql(
      'mobile performance',
      [messageSchema],
      10,
      ['chat'],
      '',
      {
        participants: ['u-current', 'u-deepanshu'],
        ...(participantsMode ? { participantsMode } : {}),
      },
      {},
      {},
      {},
      'u-current'
    ).yql;

  it('requires every person for an assistant search that says "A and B"', () => {
    const yql = build('all');
    const firstPerson = yql.indexOf('userId contains @participant_0');
    const secondPerson = yql.indexOf('userId contains @participant_1');

    expect(firstPerson).toBeGreaterThanOrEqual(0);
    expect(secondPerson).toBeGreaterThan(firstPerson);
    expect(yql.slice(firstPerson, secondPerson)).toContain(') and (');
  });

  it('keeps existing searches on their any-person default', () => {
    const yql = build();
    const firstPerson = yql.indexOf('userId contains @participant_0');
    const secondPerson = yql.indexOf('userId contains @participant_1');

    expect(yql.slice(firstPerson, secondPerson)).toContain(') or (');
  });
});
