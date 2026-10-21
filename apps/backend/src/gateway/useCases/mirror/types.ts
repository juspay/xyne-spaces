import type { Pair } from '../../core/types';

/** Mirror's links are PAIR rows with sourceType `<provider id><suffix>`, e.g. `slack-mirror`. */
export const MIRROR_SOURCE_SUFFIX = '-mirror';

/** A Mirror link: one provider channel (`externalId`) ⇄ one Spaces channel (`spacesId`). */
export type MirrorLink = Pair;
