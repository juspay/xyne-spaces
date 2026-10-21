import { ReactElement, useEffect, useMemo, useState } from 'react';
import { AddFilterChip } from './AddFilterChip';
import { FilterChip } from './FilterChip';
import { FilterValuePicker } from './FilterValuePicker';
import {
  buildFilterChips,
  getFilterFields,
  hasAnyFilterChip,
  removeFilterField,
  resolveDynamicFields,
  type FilterFieldDef,
} from './filterChips';
import type { TicketsHeaderProps } from './TicketsHeader.types';

type TicketFilterChipsProps = Pick<
  TicketsHeaderProps,
  | 'filters'
  | 'onFiltersChange'
  | 'pickerContext'
  | 'names'
  | 'hideAssigneeFilter'
  | 'showFlagFilters'
  | 'showOverdueOnly'
  | 'onOverdueChange'
  | 'onClearFilters'
>;

export const TicketFilterChips = ({
  filters,
  onFiltersChange,
  pickerContext,
  names,
  hideAssigneeFilter,
  showFlagFilters,
  showOverdueOnly,
  onOverdueChange,
  onClearFilters,
}: TicketFilterChipsProps): ReactElement => {
  const [addOpen, setAddOpen] = useState(false);
  const [openChipId, setOpenChipId] = useState<string | null>(null);
  const [pendingField, setPendingField] = useState<FilterFieldDef | null>(null);

  const dynamicFields = useMemo(
    () => resolveDynamicFields(pickerContext.formMappings),
    [pickerContext.formMappings],
  );
  const fields = useMemo(
    () =>
      getFilterFields(filters, pickerContext, {
        hideAssigneeFilter,
        showFlagFilters,
        dynamicFields,
      }),
    [filters, pickerContext, hideAssigneeFilter, showFlagFilters, dynamicFields],
  );
  const chips = useMemo(
    () => buildFilterChips(fields, filters, names, showOverdueOnly),
    [fields, filters, names, showOverdueOnly],
  );
  const inUse = useMemo(() => new Map(chips.map(chip => [chip.id, chip.value])), [chips]);
  const hasChips = hasAnyFilterChip(filters, showOverdueOnly);

  useEffect(() => {
    if (pendingField && inUse.has(pendingField.id)) setPendingField(null);
  }, [pendingField, inUse]);

  const handlePickField = (field: FilterFieldDef): void => {
    setAddOpen(false);
    if (field.isFlag) {
      if (field.id === 'overdue') onOverdueChange(true);
      else if (field.id === 'assigned')
        onFiltersChange({ ...filters, assigned: true, created: false });
      else if (field.id === 'created')
        onFiltersChange({ ...filters, created: true, assigned: false });
      return;
    }
    if (!inUse.has(field.id)) setPendingField(field);
    setOpenChipId(field.id);
    pickerContext.onFiltersDropdownOpenChange?.(true);
  };

  const handleChipOpenChange = (fieldId: string, open: boolean): void => {
    setOpenChipId(open ? fieldId : null);
    pickerContext.onFiltersDropdownOpenChange?.(open);
    if (fieldId === 'sourceChannels') pickerContext.onSourceChannelsOpenChange?.(open);
    if (pendingField && !(open && pendingField.id === fieldId)) setPendingField(null);
  };

  const removeChip = (field: FilterFieldDef): void => {
    if (openChipId === field.id || pendingField?.id === field.id) {
      handleChipOpenChange(field.id, false);
    }
    if (field.id === 'overdue') {
      onOverdueChange(false);
      return;
    }
    onFiltersChange(removeFilterField(field.id, filters, field.field?.id));
  };

  const renderedChips = [
    ...chips,
    ...(pendingField && !inUse.has(pendingField.id)
      ? [{ ...pendingField, operator: 'is', value: 'any' }]
      : []),
  ];

  return (
    <>
      {renderedChips.map(chip => {
        const Icon = chip.icon;
        return (
          <FilterChip
            key={chip.id}
            testId={`filter-chip-${chip.id}`}
            label={chip.label}
            icon={<Icon />}
            operator={chip.operator}
            value={chip.value}
            mono={chip.mono}
            onRemove={() => removeChip(chip)}
            {...(chip.isFlag
              ? {}
              : {
                  open: openChipId === chip.id,
                  onOpenChange: (open: boolean) => handleChipOpenChange(chip.id, open),
                  picker: (
                    <FilterValuePicker
                      field={chip}
                      filters={filters}
                      onFiltersChange={onFiltersChange}
                      ctx={pickerContext}
                      onClose={() => handleChipOpenChange(chip.id, false)}
                    />
                  ),
                })}
          />
        );
      })}
      <AddFilterChip
        fields={fields}
        inUse={inUse}
        onPick={handlePickField}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
      {hasChips && (
        <button
          type='button'
          onClick={onClearFilters}
          className='px-1 text-[12px] font-medium text-muted-foreground/80 hover:text-foreground'
          data-track-category='Tickets'
          data-track-name='ClearAllFiltersDropdown'
          data-testid='clear-filters-btn'
        >
          Clear
        </button>
      )}
    </>
  );
};
