export type DropdownListItemType = {
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  label: string;
  description?: string;
  value: string;
  tooltip?: React.ReactNode;
};

export type ComboboxProps = {
  queryString: string;
  label?: string;
  placeholder?: string;
  onInputValueChange: (queryString: string) => void;
  onValueChange?: (value: string | null) => void;
  items: DropdownListItemType[]; //- items to show in the dropdown
  value: DropdownListItemType | null; //- controlled selected value
  hintText?: string; //- hint text displayed below the input box
  onBlur?: () => void; //- callback when the input loses focus
  open?: boolean; //- controlled open state for the dropdown
  onOpenChange?: (open: boolean) => void; //- callback when the dropdown open state changes
  autoHighlight?: boolean; //- auto-highlight first item in the dropdown
};
