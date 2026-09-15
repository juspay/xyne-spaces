import React, { useMemo, useState } from 'react';
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
  getItemIcon?: (item: StatusItem) => React.ReactElement;
  noBorder?: boolean;
  isItemDisabled?: (item: StatusItem) => boolean;
  onOpenChange?: (isOpen: boolean) => void;
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
  getItemIcon,
  noBorder,
  isItemDisabled,
  onOpenChange,
}) => {
  const options: SelectorOption[] = useMemo(() => {
    return items.map(item => ({
      value: item.name, // Using name as value to match your handleStageChange logic
      label: item.name,
      icon: getItemIcon ? getItemIcon(item) : icon,
      disabled: isItemDisabled?.(item) ?? false,
    }));
  }, [items, icon, getItemIcon, isItemDisabled]);

  const [isOpen, setIsOpen] = useState(false);

  const handleOpenChange = (open: boolean): void => {
    setIsOpen(open);
    onOpenChange?.(open);
  };

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
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
    />
  );
};
