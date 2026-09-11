/**
 * Rules for the PR "Spec Validation" check: does a ticket description carry the
 * specification /spec writes? Kept out of pullRequestValidationService, which is
 * about pull requests rather than markdown.
 */

// Sections /spec treats as required; "Implementation details" and "Out of scope"
// are optional there. Source: apps/xyne-claw/spec-skills/spec-task/SKILL.md and
// apps/xyne-claw/src/task-commands.ts.
export const REQUIRED_SPEC_SECTIONS = ['Problem statement', 'Solutioning', 'Test cases'];

const SPEC_SECTION = 'specification';

export interface SpecValidationResult {
  isValid: boolean;
  missing: string[];
  hasSpecHeading: boolean;
  /** Sections actually enforced, after the wrapper name is dropped. */
  requiredCount: number;
}

interface SpecMarker {
  name: string;
  line: number;
  hasInlineBody: boolean;
}

const normalizeHeading = (text: string): string =>
  text
    .replace(/^>+\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/[*_`]/g, '')
    .replace(/[:\-–—\s]+$/, '')
    .trim()
    .toLowerCase();

const LIST_ITEM = /^([-*+]|\d+[.)])\s+/;
const INDENTED_CODE = /^(?: {4,}|\t)/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;

const matchMarker = (
  line: string,
  sectionNames: Set<string>
): { name: string; hasInlineBody: boolean } | null => {
  if (LIST_ITEM.test(line.replace(/^>+\s*/, ''))) return null;

  const bare = line.replace(/^>+\s*/, '');
  const text = bare.replace(/^#{1,6}\s*/, '');
  const whole = normalizeHeading(text);
  if (sectionNames.has(whole)) return { name: whole, hasInlineBody: false };

  // Inline "Name: body" needs heading or bold markup. Bare prose starting with a
  // section name is ordinary text, and consuming it truncates the real section.
  if (!/^(#{1,6}\s|[*_])/.test(bare)) return null;

  const separator = text.search(/[:–—]|\s-\s/);
  if (separator > 0) {
    const name = normalizeHeading(text.slice(0, separator));
    const body = text.slice(separator + 1).replace(/[*_`]/g, '').trim();
    if (sectionNames.has(name) && body.length > 0) return { name, hasInlineBody: true };
  }
  return null;
};

const parseMarkers = (lines: string[], sectionNames: Set<string>): SpecMarker[] => {
  const markers: SpecMarker[] = [];
  let fence: { char: string; length: number } | null = null;

  lines.forEach((raw, index) => {
    // An indented line can neither open nor close a fence.
    if (INDENTED_CODE.test(raw)) return;

    const line = raw.trim().replace(/^>+\s*/, '');
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      const char = fenceMatch[1]![0]!;
      const length = fenceMatch[1]!.length;
      const info = fenceMatch[2]!.trim();
      if (!fence) fence = { char, length };
      else if (char === fence.char && length >= fence.length && info === '') fence = null;
      return;
    }
    if (fence) return;

    const marker = matchMarker(line, sectionNames);
    if (marker) markers.push({ ...marker, line: index });
  });
  return markers;
};

/**
 * Each required section must be named, with text under it. `sections` is passed
 * in so a /spec rename is a config change rather than a code change.
 */
export function validateSpecSections(
  description: string | null | undefined,
  sections: readonly string[] = REQUIRED_SPEC_SECTIONS
): SpecValidationResult {
  // The wrapper name can never be satisfied as a section: narrowing removes it.
  const required = [...sections].filter(section => normalizeHeading(section) !== SPEC_SECTION);
  // Nothing enforceable was asked for, so there is nothing to fail on.
  if (!required.length) {
    return { isValid: true, missing: [], hasSpecHeading: false, requiredCount: 0 };
  }
  if (!description || !description.trim()) {
    return { isValid: false, missing: required, hasSpecHeading: false, requiredCount: required.length };
  }

  const sectionNames = new Set<string>([
    SPEC_SECTION,
    ...required.map(section => normalizeHeading(section)),
  ]);
  const lines = description.split(/\r?\n/);
  const markers = parseMarkers(lines, sectionNames);
  const hasSpecHeading = markers.some(marker => marker.name === SPEC_SECTION);

  // A wrapper narrows scope only when every section follows it: one written
  // mid-description would otherwise discard the sections above it.
  const firstSection = markers.findIndex(marker => marker.name !== SPEC_SECTION);
  const wrapper = markers.findIndex(marker => marker.name === SPEC_SECTION);
  const scope =
    wrapper !== -1 && (firstSection === -1 || wrapper < firstSection)
      ? markers.slice(wrapper + 1)
      : markers;

  const hasBody = (index: number): boolean => {
    if (scope[index]!.hasInlineBody) return true;
    // Content runs to the next section name, or to the end of the description.
    const bodyStart = scope[index]!.line + 1;
    const bodyEnd = index + 1 < scope.length ? scope[index + 1]!.line : lines.length;
    return lines.slice(bodyStart, bodyEnd).some(line => line.trim().length > 0);
  };

  // Any occurrence with content satisfies the section: a heading duplicated by a
  // stray edit must not fail a spec whose content is under the second copy.
  const missing = required.filter(section => {
    const target = normalizeHeading(section);
    const occurrences = scope
      .map((marker, index) => (marker.name === target ? index : -1))
      .filter(index => index !== -1);
    return !occurrences.some(hasBody);
  });

  return {
    isValid: missing.length === 0,
    missing,
    hasSpecHeading,
    requiredCount: required.length,
  };
}

export const formatMissingSections = (missing: string[]): string => {
  const shown = missing.slice(0, 3).join(', ');
  return missing.length > 3 ? `${shown} +${missing.length - 3} more` : shown;
};

/** Drops the wrapper name: narrowing removes it from scope, so it can never be
 *  satisfied as a section. */
export const filterEnforceableSections = (sections: string[]): string[] =>
  sections.filter(section => normalizeHeading(section) !== SPEC_SECTION);
