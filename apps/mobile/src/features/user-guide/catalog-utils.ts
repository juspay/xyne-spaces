import { GUIDE_CATEGORIES, GUIDE_CATEGORY_BY_ID } from './categories';
import type { GuideCategory, GuideCategoryId, GuideRequirement, MobileGuide } from './types';

export interface GuideAccess {
  canReadTickets: boolean;
}

const REQUIREMENT_CHECKS: Record<GuideRequirement, (access: GuideAccess) => boolean> = {
  tickets: access => access.canReadTickets,
};

/** Drops guides whose feature the current user cannot reach. */
export function filterGuidesForAccess(
  guides: readonly MobileGuide[],
  access: GuideAccess,
): MobileGuide[] {
  return guides.filter(guide => !guide.requires || REQUIREMENT_CHECKS[guide.requires](access));
}

export function findGuideById(
  guides: readonly MobileGuide[],
  guideId: string | undefined,
): MobileGuide | null {
  if (!guideId) return null;
  return guides.find(guide => guide.id === guideId) ?? null;
}

export function isGuideCategoryId(value: string | undefined): value is GuideCategoryId {
  return value !== undefined && Object.prototype.hasOwnProperty.call(GUIDE_CATEGORY_BY_ID, value);
}

/** Guides of one topic, in catalog order — which is the order they are best read. */
export function getGuidesInCategory(
  guides: readonly MobileGuide[],
  categoryId: GuideCategoryId,
): MobileGuide[] {
  return guides.filter(guide => guide.category === categoryId);
}

/**
 * The hub's "Start here" path: the `start` topic, read top to bottom. Kept as
 * its own helper so the hub does not need to know which topic is the opener.
 */
export function getStartHereGuides(guides: readonly MobileGuide[]): MobileGuide[] {
  return getGuidesInCategory(guides, 'start');
}

export interface GuideSection {
  category: GuideCategory;
  guides: MobileGuide[];
}

/**
 * Every topic with its guides, in the fixed topic order. Empty topics are
 * dropped so a permission-gated topic never renders bare.
 */
export function groupGuidesByCategory(guides: readonly MobileGuide[]): GuideSection[] {
  return GUIDE_CATEGORIES.map(category => ({
    category,
    guides: getGuidesInCategory(guides, category.id),
  })).filter(section => section.guides.length > 0);
}

/** Topics to browse on the hub: everything except the "Start here" opener. */
export function getBrowseSections(guides: readonly MobileGuide[]): GuideSection[] {
  return groupGuidesByCategory(guides).filter(section => section.category.id !== 'start');
}

export function getRelatedGuides(
  guides: readonly MobileGuide[],
  guide: MobileGuide,
): MobileGuide[] {
  const ids = guide.related ?? [];
  return ids
    .map(id => guides.find(candidate => candidate.id === id))
    .filter((candidate): candidate is MobileGuide => candidate !== undefined);
}

/** The guide that follows `guide` inside its topic, or null at the end. */
export function getNextGuideInCategory(
  guides: readonly MobileGuide[],
  guide: MobileGuide,
): MobileGuide | null {
  const siblings = getGuidesInCategory(guides, guide.category);
  const index = siblings.findIndex(candidate => candidate.id === guide.id);
  if (index === -1) return null;
  return siblings[index + 1] ?? null;
}

/** 1-based position of `guide` within its topic, for "2 of 8" labels. */
export function getPositionInCategory(
  guides: readonly MobileGuide[],
  guide: MobileGuide,
): { index: number; total: number } {
  const siblings = getGuidesInCategory(guides, guide.category);
  const index = siblings.findIndex(candidate => candidate.id === guide.id);
  return { index: index === -1 ? 0 : index + 1, total: siblings.length };
}

export function countGuides(guides: readonly MobileGuide[]): number {
  return guides.length;
}
