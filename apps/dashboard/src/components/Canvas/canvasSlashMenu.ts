import { en } from '@blocknote/core/locales';
import type { DefaultReactSuggestionItem } from '@blocknote/react';

const HEADING_TITLE = /^Heading (\d)$/;

/**
 * One Upload item in place of Image, Video, Audio and File: the file item is
 * relabelled and the other three dropped. CanvasFilePanel picks the real type.
 */
export function withUnifiedUpload(
  items: DefaultReactSuggestionItem[],
): DefaultReactSuggestionItem[] {
  const droppedTitles = new Set(
    [en.slash_menu.image, en.slash_menu.video, en.slash_menu.audio].map(entry => entry.title),
  );

  return items.flatMap(item => {
    if (droppedTitles.has(item.title)) return [];
    if (item.title !== en.slash_menu.file.title) return [item];

    return [
      {
        ...item,
        title: 'Upload',
        subtext: 'Image, video, audio or any other file',
        // Replacing rather than extending the defaults: those still carry 'embed'
        // and 'url' from the embed-by-url flow, which this item cannot do.
        aliases: [
          'upload',
          'file',
          'attachment',
          'image',
          'img',
          'photo',
          'picture',
          'video',
          'audio',
          'sound',
          'media',
        ],
      },
    ];
  });
}

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
