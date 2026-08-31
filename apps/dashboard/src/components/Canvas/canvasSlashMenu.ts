import type { DefaultReactSuggestionItem } from '@blocknote/react';

const HEADING_TITLE = /^Heading (\d)$/;

const headingLevel = (item: DefaultReactSuggestionItem): number =>
  Number(HEADING_TITLE.exec(item.title)?.[1] ?? 0);

/**
 * Puts every heading under Headings.
 *
 * BlockNote files 4, 5 and 6 under Subheadings, beside the toggle headings, so
 * the six levels of one thing were split across two groups a scroll apart. The
 * group is read off Heading 1 rather than named here, so it survives however the
 * dictionary labels it.
 */
export function withHeadingsTogether(
  items: DefaultReactSuggestionItem[],
): DefaultReactSuggestionItem[] {
  const group = items.find(item => item.title === 'Heading 1')?.group;
  if (!group) return items;

  const strays = items.filter(item => HEADING_TITLE.test(item.title) && item.group !== group);
  if (strays.length === 0) return items;

  const rest = items.filter(item => !strays.includes(item));
  const lastInGroup = rest.reduce((last, item, index) => (item.group === group ? index : last), -1);
  const moved = [...strays]
    .sort((a, b) => headingLevel(a) - headingLevel(b))
    .map(item => ({ ...item, group }));

  return [...rest.slice(0, lastInGroup + 1), ...moved, ...rest.slice(lastInGroup + 1)];
}
