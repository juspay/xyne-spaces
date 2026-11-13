import { describe, expect, it } from 'vitest';
import { groupByConnector } from './connector-groups.js';
import type { ConnectorItem } from './connector-groups.js';

interface Owner {
  id: string;
  name?: string;
  icon?: string;
}

const item = (type: string, owner?: Owner): ConnectorItem => ({
  type,
  name: type,
  description: '',
  ...(owner
    ? {
        connectorId: owner.id,
        ...(owner.name !== undefined ? { connectorName: owner.name } : {}),
        ...(owner.icon !== undefined ? { connectorIcon: owner.icon } : {}),
      }
    : {}),
});

const builtin: Owner = { id: 'builtin', name: 'Built-in', icon: 'blocks' };
const github: Owner = { id: 'github', name: 'GitHub', icon: 'git-branch' };
const acme: Owner = { id: 'acme', name: 'Acme' };

describe('groupByConnector', () => {
  it('puts Built-in first, the rest by name, and unowned items last under Other', () => {
    const groups = groupByConnector([
      item('github.issues', github),
      item('ORPHAN'),
      item('acme.start', acme),
      item('MANUAL', builtin),
    ]);

    expect(groups.map((group) => group.connectorName)).toEqual(['Built-in', 'Acme', 'GitHub', 'Other']);
  });

  it("keeps each connector's items in the order given, with the connector's icon", () => {
    const first = item('github.pull_request', github);
    const second = item('github.issues', github);

    const groups = groupByConnector([first, item('MANUAL', builtin), second]);

    expect(groups[1]).toEqual({
      connectorId: 'github',
      connectorName: 'GitHub',
      connectorIcon: 'git-branch',
      items: [first, second],
    });
  });

  it('names a connector by its id when the summary carries no name', () => {
    expect(groupByConnector([item('x.start', { id: 'x' })])[0]?.connectorName).toBe('x');
  });
});
