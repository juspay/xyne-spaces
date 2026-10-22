export type PickerOption = { value: string; label: string };

type NamedRow = { name?: string | null | undefined };

/** Board stages → Status picker options (unique by stage name). */
export function buildStageStatusOptions(
  stages: ReadonlyArray<NamedRow> | null | undefined,
): PickerOption[] {
  const seen = new Set<string>();
  const options: PickerOption[] = [];
  for (const stage of stages ?? []) {
    const name = (stage.name ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    options.push({ value: name, label: name });
  }
  return options;
}

type ValueRow = { value?: string | null | undefined };

/** Lookup rows → Type picker options; keeps an unknown current value visible. */
export function buildTicketTypeOptions(
  lookups: ReadonlyArray<ValueRow> | null | undefined,
  selectedTicketType: string | null,
): PickerOption[] {
  const seen = new Set<string>();
  const options: PickerOption[] = [];
  for (const row of lookups ?? []) {
    const value = (row.value ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: value });
  }
  if (selectedTicketType && !seen.has(selectedTicketType)) {
    options.unshift({ value: selectedTicketType, label: selectedTicketType });
  }
  return options;
}

type BoardRow = { id?: string | null | undefined; name?: string | null | undefined };

export function buildBoardOptions(boards: ReadonlyArray<BoardRow>): PickerOption[] {
  return boards
    .map(board => {
      const value = (board.id ?? '').trim();
      const label = (board.name ?? '').trim();
      if (!value || !label) return null;
      return { value, label };
    })
    .filter((option): option is PickerOption => option !== null);
}

type TagRow = { name?: string | null | undefined };

/** Project tags + already-applied labels, case-insensitive, sorted. */
export function buildLabelOptions(
  projectTags: ReadonlyArray<TagRow> | null | undefined,
  appliedNames: readonly string[],
): PickerOption[] {
  const seen = new Set<string>();
  const options: PickerOption[] = [];
  for (const tag of projectTags ?? []) {
    const name = (tag.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ value: name, label: name });
  }
  for (const name of appliedNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ value: trimmed, label: trimmed });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

type UserGroupRow = {
  id?: string | null | undefined;
  name?: string | null | undefined;
  isActive?: boolean | null | undefined;
};

export function buildUserGroupOptions(
  groups: ReadonlyArray<UserGroupRow> | null | undefined,
): PickerOption[] {
  return (groups ?? [])
    .filter(group => group.isActive !== false)
    .map(group => {
      const value = (group.id ?? '').trim();
      const label = (group.name ?? '').trim();
      if (!value || !label) return null;
      return { value, label };
    })
    .filter((option): option is PickerOption => option !== null);
}
