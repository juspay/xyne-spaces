import { FormFieldType } from '@xyne/shared';

export interface FormField {
  id: string;
  persistedFieldId?: string;
  fieldName: string;
  fieldType: FormFieldType;
  isOptional: boolean;
  fieldEnum?: string[];
}

export interface CreateFormSlideOutProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: { formName: string; formDescription: string; fields: FormField[] }) => void;
  /** Called when updating an existing form (provides formId along with data) */
  onUpdate?: (formData: {
    formId: string;
    formName: string;
    formDescription: string;
    fields: FormField[];
  }) => void;
  /** The form ID when editing an existing form */
  formId?: string;
  /** Pre-populate the form builder with existing data (for editing an existing form) */
  initialData?: {
    formName: string;
    formDescription: string;
    fields: FormField[];
  };
  /** Override the panel title (default: "Create Form") */
  title?: string;
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
