import { ComponentDataError } from '../../../services/DynamicDashboard/componentDataService';
import type { PreviewResponse } from '../../../services/DynamicDashboard/previewService';

export interface PreviewStatus {
  result: PreviewResponse | null;
  error: ComponentDataError | null;
  isPreviewing: boolean;
  isSaving: boolean;
}

export type PreviewStatusAction =
  | { type: 'reset' }
  | { type: 'setError'; error: ComponentDataError }
  | { type: 'previewStart' }
  | { type: 'previewSuccess'; result: PreviewResponse }
  | { type: 'previewFailure'; error: ComponentDataError }
  | { type: 'previewSettled' }
  | { type: 'saveStart' }
  | { type: 'saveDone' };

export const initialPreviewStatus: PreviewStatus = {
  result: null,
  error: null,
  isPreviewing: false,
  isSaving: false,
};

export function previewStatusReducer(
  state: PreviewStatus,
  action: PreviewStatusAction,
): PreviewStatus {
  switch (action.type) {
    case 'reset':
      return { ...state, result: null, error: null };
    case 'setError':
      return { ...state, error: action.error };
    case 'previewStart':
      return { ...state, isPreviewing: true, error: null };
    case 'previewSuccess':
      return { ...state, result: action.result };
    case 'previewFailure':
      return { ...state, error: action.error, result: null };
    case 'previewSettled':
      return { ...state, isPreviewing: false };
    case 'saveStart':
      return { ...state, isSaving: true };
    case 'saveDone':
      return { ...state, isSaving: false };
    default: {
      action satisfies never;
      return state;
    }
  }
}
