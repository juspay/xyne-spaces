import React, { useMemo } from 'react';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';

interface StatusItem {
  id: string;
  name: string;
}

interface SelectorProps {
  items: StatusItem[];
  selectedValue: string | null;
  onValueChange: (name: string) => void;
  placeholder?: string;
  isLoading?: boolean;
  icon?: React.ReactElement;
  noBorder?: boolean;
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
}) => {
  const options: SelectorOption[] = useMemo(() => {
    return items.map(item => ({
      value: item.name, // Using name as value to match your handleStageChange logic
      label: item.name,
      icon: icon,
    }));
  }, [items, icon]);

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
