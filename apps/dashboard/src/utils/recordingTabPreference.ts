/**
 * Remembers which pane the user last had open in the Recording V2 views, so the
 * NoteTakerOverlay and the RecordingDetailV2Screen land in the same place.
 *
 * Both views are two-pane — notes plus one other — but that other pane differs
 * between them (transcript while live, summary once ended). Storing the choice
 * between the two panes rather than a concrete tab id keeps the preference
 * meaningful in whichever view reads it next; a stored 'summary' would have no
 * counterpart in the overlay.
 *
 * Distinct from the "Recording tab view" setting in Preferences
 * (`xyne:recording-default-layout`), which is an explicit V1-only choice — this
 * is implicit, written whenever the user switches tabs.
 */

export type RecordingV2Tab = 'notes' | 'secondary';

const RECORDING_V2_TAB_KEY = 'xyne:recording-v2-tab';

/** Notes is the primary pane, so it is where a user with no stored choice lands. */
export const DEFAULT_RECORDING_V2_TAB: RecordingV2Tab = 'notes';

export const getRecordingV2Tab = (): RecordingV2Tab =>
  localStorage.getItem(RECORDING_V2_TAB_KEY) === 'secondary'
    ? 'secondary'
    : DEFAULT_RECORDING_V2_TAB;

export const setRecordingV2Tab = (tab: RecordingV2Tab): void => {
  localStorage.setItem(RECORDING_V2_TAB_KEY, tab);
};
