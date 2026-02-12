import React, { useMemo } from 'react';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';

interface StatusItem {
  id: string;
  name: string;
  sequenceNumber?: number;
}

interface SelectorProps {
  items: StatusItem[];
  selectedValue: string | null;
  onValueChange: (name: string) => void;
  placeholder?: string;
  isLoading?: boolean;
  icon?: React.ReactElement;
  noBorder?: boolean;
  isItemDisabled?: (item: StatusItem) => boolean;
}

/**
 * A reusable selector for Statuses or Stages
 */
export const Selector: React.FC<SelectorProps> = ({
  items,
  selectedValue,
  onValueChange,
  placeholder = 'Select...',
  isLoading = false,
  icon,
  noBorder,
  isItemDisabled,
}) => {
  const options: SelectorOption[] = useMemo(() => {
    return items.map(item => ({
      value: item.name, // Using name as value to match your handleStageChange logic
      label: item.name,
      icon: icon,
      disabled: isItemDisabled?.(item) ?? false,
    }));
  }, [items, icon, isItemDisabled]);

  return (
    <EntitySelector
      options={options}
      selectedValue={selectedValue}
      onSelect={val => val && onValueChange(val)}
      placeholder={placeholder}
      searchPlaceholder='Search...'
      isLoading={isLoading}
      isStatusSelector={true} // Triggers the border and divider styling
      width='auto'
      noBorder={noBorder || false}
    />
  );
};
