import { type ReactElement } from 'react';
import { LabelPicker } from '../../components/Labels/LabelPicker';

export interface CallLabelPickerProps {
  labels: string[];
  canEdit: boolean;
  /** Labels the history screen had loaded, offered in the list before anything is typed. */
  suggestions: string[];
  onChange: (labels: string[]) => void;
}

/** Calls binding for {@link LabelPicker}: analytics namespace only. */
export function CallLabelPicker({
  labels,
  canEdit,
  suggestions,
  onChange,
}: CallLabelPickerProps): ReactElement | null {
  return (
    <LabelPicker
      labels={labels}
      canEdit={canEdit}
      suggestions={canEdit ? suggestions : []}
      trackCategory='CallDetail'
      onChange={onChange}
    />
  );
}
