import { type ReactElement } from 'react';
import { LabelFilter } from '../../components/Labels/LabelFilter';

interface CallLabelFilterProps {
  labels: string[];
  selectedLabels: string[];
  onSelectedLabelsChange: (labels: string[]) => void;
  /** Resolves a label value (Tag id) to its display text. Defaults to identity. */
  resolveLabel?: (label: string) => string;
  /** Search rows carry no labels, so the filter is turned off while a search is active. */
  isDisabled?: boolean;
}

/** Sized to sit level with the Recents dropdown beside it. */
const TRIGGER_CLASS_NAME =
  'h-7 gap-1 rounded-lg border-border px-2.5 text-sm font-medium shadow-none';

/** Calls binding for {@link LabelFilter}: calls copy, analytics namespace and trigger sizing. */
export function CallLabelFilter({
  labels,
  selectedLabels,
  onSelectedLabelsChange,
  resolveLabel,
  isDisabled = false,
}: CallLabelFilterProps): ReactElement {
  return (
    <LabelFilter
      labels={labels}
      selectedLabels={selectedLabels}
      onSelectedLabelsChange={onSelectedLabelsChange}
      resolveLabel={resolveLabel}
      isDisabled={isDisabled}
      triggerClassName={TRIGGER_CLASS_NAME}
      trackCategory='CallHistory'
      triggerAriaLabel='Filter calls by label'
      disabledAriaLabel={
        isDisabled
          ? 'Label filter unavailable while searching'
          : 'Label filter unavailable because no calls are labelled'
      }
    />
  );
}
