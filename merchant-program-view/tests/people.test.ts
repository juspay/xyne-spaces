import { describe, expect, it } from 'vitest';
import { indexPeople } from '../lib/ticketPanel';

describe('indexPeople', () => {
  it('sorts by name and indexes by id and name', () => {
    const p = indexPeople([
      { id: 'b', name: 'Zed', picture: null },
      { id: 'a', name: 'Ann', picture: 'https://x/a.png' },
    ]);
    expect(p.list.map(x => x.name)).toEqual(['Ann', 'Zed']);
    expect(p.byId.get('a')?.picture).toBe('https://x/a.png');
    expect(p.byName.get('Zed')?.id).toBe('b');
  });
});
