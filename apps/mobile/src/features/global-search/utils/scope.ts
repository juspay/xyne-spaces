import type { SearchFilterChip, SearchScope } from '../types';

/** Keeps a long conversation name from pushing the caret off the field. */
const MAX_PLACEHOLDER_LABEL = 28;

export function scopeToChip(scope: SearchScope): SearchFilterChip {
  return { id: scope.channelId, label: scope.label, prefix: 'in:', entityType: 'channel' };
}

/**
 * Merges a locked conversation scope into the user's chips for the request.
 *
 * The scope REPLACES any `in:` chip rather than joining it: the backend ORs the
 * comma-joined `in` ids, so appending would let someone type `in:other-channel` and
 * escape the conversation they opened search from.
 */
export function effectiveChipsForScope(
  chips: readonly SearchFilterChip[],
  scope: SearchScope | null,
): SearchFilterChip[] {
  if (!scope) return chips as SearchFilterChip[];
  return [...chips.filter(chip => chip.prefix !== 'in:'), scopeToChip(scope)];
}

export type ScopedInputs = {
  chips: SearchFilterChip[];
  onlyMyChannels: boolean;
};

/**
 * Everything a locked scope does to the request, in one place. A scope also hides the
 * filter row, so a modifier left over from an earlier unscoped session must not
 * silently reshape a locked query either.
 */
export function effectiveInputsForScope(
  inputs: { chips: readonly SearchFilterChip[]; onlyMyChannels: boolean },
  scope: SearchScope | null,
): ScopedInputs {
  return {
    chips: effectiveChipsForScope(inputs.chips, scope),
    onlyMyChannels: scope ? false : inputs.onlyMyChannels,
  };
}

export function scopedPlaceholder(scope: SearchScope): string {
  const label =
    scope.label.length > MAX_PLACEHOLDER_LABEL
      ? `${scope.label.slice(0, MAX_PLACEHOLDER_LABEL - 1).trimEnd()}…`
      : scope.label;
  return `Search in ${label}`;
}
