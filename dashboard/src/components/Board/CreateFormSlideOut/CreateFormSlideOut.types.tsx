import { FormFieldType } from '@xyne/shared';

export interface FormField {
  id: string;
  fieldName: string;
  fieldType: FormFieldType;
  isOptional: boolean;
  fieldEnum?: string[];
}

export interface CreateFormSlideOutProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: { formName: string; formDescription: string; fields: FormField[] }) => void;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
}
