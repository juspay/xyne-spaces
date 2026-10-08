import { LIMITS } from './constants';

export interface GroupableControl {
  id: string;
  label: string;
  text: string;
  href?: string;
}

export interface ControlGroup<C extends GroupableControl> {
  id: string;
  description: string;
  members: [C, ...C[]];
}

/** Links to the same place do the same thing. */
const keyOf = ({ id, href }: GroupableControl): string => (href ? `href:${href}` : `id:${id}`);

function describe([first, ...rest]: [GroupableControl, ...GroupableControl[]]): string {
  const others = [...new Set(rest.map(c => c.text))].filter(text => text && text !== first.text);
  if (others.length === 0) return first.label;
  const same = others.map(text => `"${text}"`).join(', ');
  return `${first.label} (same as ${same})`.slice(0, LIMITS.labelLength);
}

/** One option per group of controls that do the same thing, so Jev's vote does not split. */
export function groupControls<C extends GroupableControl>(controls: C[]): ControlGroup<C>[] {
  const groups = new Map<string, [C, ...C[]]>();
  for (const control of controls) {
    const key = keyOf(control);
    const members = groups.get(key);
    if (members) members.push(control);
    else groups.set(key, [control]);
  }
  return [...groups.values()].map(members => ({
    id: members[0].id,
    description: describe(members),
    members,
  }));
}
