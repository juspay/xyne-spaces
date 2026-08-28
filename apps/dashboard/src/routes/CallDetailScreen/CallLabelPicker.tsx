import { type ReactElement } from 'react';
import { LabelPicker } from '../../components/Labels/LabelPicker';
import { useCallLabelSuggestions } from '../../hooks/useCallLabelSuggestions';

export interface CallLabelPickerProps {
  labels: string[];
  canEdit: boolean;
  onChange: (labels: string[]) => void;
}

/** Calls binding for {@link LabelPicker}: call-wide suggestions and analytics namespace. */
export function CallLabelPicker({
  labels,
  canEdit,
  onChange,
}: CallLabelPickerProps): ReactElement | null {
  const suggestions = useCallLabelSuggestions(canEdit);

  return (
    <LabelPicker
      labels={labels}
      canEdit={canEdit}
      suggestions={suggestions}
      trackCategory='CallDetail'
      onChange={onChange}
    />
  );
}
