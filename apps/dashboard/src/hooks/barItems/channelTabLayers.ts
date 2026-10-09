import { appItemId, isAppItemId } from './appItemId';

/**
 * A channel's tabs are two layers: the apps a channel admin published
 * (channel_published_tabs, shared) and each member's own changes on top of it
 * (localStorage, per device). These two functions convert between the three
 * local lists and the single list the member actually sees.
 *
 * All ids here are bar item ids — built-ins (`files`) and `app:<id>` entries —
 * except `published`, which arrives from the server as bare app ids.
 */
export interface ChannelTabLayers {
  /** Display order of everything the member has placed. */
  order: readonly string[];
  /** Apps the member added themselves. Survive an unpublish. */
  added: readonly string[];
  /** Published apps the member removed. Stay removed across a republish. */
  hidden: readonly string[];
}

/** What the member sees: their order, minus hidden/unpublished apps, plus new published ones. */
export function mergeChannelTabs(
  layers: ChannelTabLayers,
  publishedAppIds: readonly string[],
): string[] {
  const published = publishedAppIds.map(appItemId);
  const hidden = new Set(layers.hidden);
  const allowed = new Set([...published.filter(id => !hidden.has(id)), ...layers.added]);

  const out = layers.order.filter(id => !isAppItemId(id) || allowed.has(id));
  const placed = new Set(out);
  // Published apps the member hasn't placed yet go last, in the admin's order;
  // then any self-added app missing from `order` (only after a hand edit).
  for (const id of [...published, ...layers.added]) {
    if (allowed.has(id) && !placed.has(id)) {
      out.push(id);
      placed.add(id);
    }
  }
  return out;
}

/**
 * The inverse: the list the member wants to see, back into the three layers.
 * `previous` matters for two things only — a self-added app that was later
 * published keeps its "self-added" origin, and an app hidden while unpublished
 * stays hidden if it is published again.
 */
export function splitChannelTabs(
  effective: readonly string[],
  publishedAppIds: readonly string[],
  previous: Pick<ChannelTabLayers, 'added' | 'hidden'>,
): ChannelTabLayers {
  const published = new Set(publishedAppIds.map(appItemId));
  const shown = new Set(effective);
  const wasAdded = new Set(previous.added);

  const added = effective.filter(id => isAppItemId(id) && (!published.has(id) || wasAdded.has(id)));
  const hidden = [
    ...previous.hidden.filter(id => !shown.has(id)),
    ...[...published].filter(id => !shown.has(id) && !previous.hidden.includes(id)),
  ];
  return { order: [...effective], added, hidden };
}
