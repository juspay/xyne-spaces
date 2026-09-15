import { type ReactElement } from 'react';
import { LabelPicker } from '../../../components/Labels/LabelPicker';

export { LabelChip, SuggestedLabelChip } from '../../../components/Labels/LabelPicker';

export interface RecordingLabelPickerProps {
  labels: string[];
  canEdit: boolean;
  /** Labels the recordings list had loaded, offered in the list before anything is typed. */
  suggestions: string[];
  onChange: (labels: string[]) => void;
}

/** Recordings binding for {@link LabelPicker}: analytics namespace only. */
export function RecordingLabelPicker({
  labels,
  canEdit,
  suggestions,
  onChange,
}: RecordingLabelPickerProps): ReactElement | null {
  return (
    <LabelPicker
      labels={labels}
      canEdit={canEdit}
      suggestions={canEdit ? suggestions : []}
      trackCategory='RecordingDetailV2'
      onChange={onChange}
    />
  );
}
