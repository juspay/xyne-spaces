import { type ReactElement } from 'react';
import { LabelFilter } from '../../../components/Labels/LabelFilter';

interface RecordingLabelFilterProps {
  labels: string[];
  selectedLabels: string[];
  onSelectedLabelsChange: (labels: string[]) => void;
  /** Resolves a label value (Tag id) to its display text. Defaults to identity. */
  resolveLabel?: (label: string) => string;
}

/** Recordings binding for {@link LabelFilter}: recordings copy and analytics namespace. */
export function RecordingLabelFilter({
  labels,
  selectedLabels,
  onSelectedLabelsChange,
  resolveLabel,
}: RecordingLabelFilterProps): ReactElement {
  return (
    <LabelFilter
      labels={labels}
      selectedLabels={selectedLabels}
      onSelectedLabelsChange={onSelectedLabelsChange}
      resolveLabel={resolveLabel}
      trackCategory='RecordingsV2'
      triggerAriaLabel='Filter recordings by label'
      disabledAriaLabel='Label filter unavailable because no recordings are labelled'
    />
  );
}
