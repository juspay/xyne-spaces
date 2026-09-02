import { type ReactElement } from 'react';
import { LabelPicker } from '../../../components/Labels/LabelPicker';
import { useRecordingLabelSuggestions } from '../../../hooks/useRecordingLabelSuggestions';

export { LabelChip, SuggestedLabelChip } from '../../../components/Labels/LabelPicker';

export interface RecordingLabelPickerProps {
  labels: string[];
  canEdit: boolean;
  onChange: (labels: string[]) => void;
}

/** Recordings binding for {@link LabelPicker}: recording-wide suggestions and analytics namespace. */
export function RecordingLabelPicker({
  labels,
  canEdit,
  onChange,
}: RecordingLabelPickerProps): ReactElement | null {
  const suggestions = useRecordingLabelSuggestions(canEdit);

  return (
    <LabelPicker
      labels={labels}
      canEdit={canEdit}
      suggestions={suggestions}
      trackCategory='RecordingDetailV2'
      onChange={onChange}
    />
  );
}
