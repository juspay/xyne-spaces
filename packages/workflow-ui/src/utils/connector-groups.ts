/**
 * Groups step and trigger summaries by the connector that provides them, for
 * the connector-first palettes.
 */

/** What grouping reads from a step or trigger summary. Both summaries satisfy it. */
export interface ConnectorItem {
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly icon?: string | undefined;
  readonly connectorId?: string | undefined;
  readonly connectorName?: string | undefined;
  readonly connectorIcon?: string | undefined;
}

export interface ConnectorGroup<T extends ConnectorItem> {
  readonly connectorId: string;
  readonly connectorName: string;
  readonly connectorIcon?: string | undefined;
  readonly items: readonly T[];
}

export const BUILTIN_CONNECTOR_ID = 'builtin';

/** Items no connector claims. Empty, so it can never collide with a real connector id. */
const UNOWNED_CONNECTOR_ID = '';

/**
 * One group per connector: Built-in first, the rest by name, unowned items last
 * under "Other". Items keep the order they came in, which is the order their
 * connector declared them.
 */
export function groupByConnector<T extends ConnectorItem>(items: readonly T[]): ConnectorGroup<T>[] {
  const groups = new Map<string, { group: ConnectorGroup<T>; items: T[] }>();
  for (const item of items) {
    const connectorId = item.connectorId ?? UNOWNED_CONNECTOR_ID;
    let entry = groups.get(connectorId);
    if (!entry) {
      const members: T[] = [];
      entry = {
        items: members,
        group: {
          connectorId,
          connectorName: item.connectorName ?? (item.connectorId || 'Other'),
          ...(item.connectorIcon !== undefined ? { connectorIcon: item.connectorIcon } : {}),
          items: members,
        },
      };
      groups.set(connectorId, entry);
    }
    entry.items.push(item);
  }
  return Array.from(groups.values(), (entry) => entry.group).sort(compareGroups);
}

function rank(group: ConnectorGroup<ConnectorItem>): number {
  if (group.connectorId === BUILTIN_CONNECTOR_ID) return 0;
  if (group.connectorId === UNOWNED_CONNECTOR_ID) return 2;
  return 1;
}

function compareGroups(a: ConnectorGroup<ConnectorItem>, b: ConnectorGroup<ConnectorItem>): number {
  return rank(a) - rank(b) || a.connectorName.localeCompare(b.connectorName);
}
