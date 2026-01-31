/**
 * Represents a single option in the multi-select dropdown
 */
export interface MultiSelectOption {
  /** Unique identifier for the option */
  value: string;
  /** Display label for the option */
  label: string;
  /** Optional icon/avatar element to display */
  icon?: React.ReactNode;
  /** Optional subtitle text (e.g., email) to display */
  subtitle?: string;
}

/**
 * Props for the MultiSelect component
 */
export interface MultiSelectProps {
  /** Array of available options to select from */
  options: MultiSelectOption[];
  /** Currently selected values */
  selectedValues: string[];
  /** Callback fired when selected values change */
  onChange: (values: string[]) => void;
  /** Placeholder text displayed when no values are selected */
  placeholder?: string;
  /** Label displayed above the component */
  label?: string;
  /** Additional CSS classes to apply to the component wrapper */
  className?: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Maximum height of the dropdown menu in pixels */
  dropdownMaxHeight?: number;
  /** Error message to display */
  error?: string;
  /** Optional helper text displayed below the component */
  helperText?: string;
}
