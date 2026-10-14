import type { SearchFilterChip, SearchInTargetItem, SearchPersonItem } from '../types';

export function fromChip(person: SearchPersonItem): SearchFilterChip {
  return { id: person.id, label: person.title, prefix: 'from:', entityType: 'user' };
}

export function inChip(target: SearchInTargetItem): SearchFilterChip {
  return {
    id: target.id,
    label: target.title.replace(/^#/, ''),
    prefix: 'in:',
    entityType: 'channel',
    // The In sheet rebuilds a row from the chip alone, and would otherwise redraw a DM
    // as a channel.
    targetKind: target.kind,
    ...(target.visibility ? { visibility: target.visibility } : {}),
  };
}
