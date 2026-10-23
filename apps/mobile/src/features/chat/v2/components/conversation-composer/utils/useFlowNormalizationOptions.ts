import { useContext } from 'react';

import type { FlowTextNormalizationOptions } from '@/src/utils/flowJsonMarkdown';
import {
  EMPTY_FLOW_NORMALIZATION_OPTIONS,
  FlowNormalizationOptionsContext,
} from './flowNormalizationOptionsContext';

export {
  getCachedChannelNames,
  getCachedGroupNames,
  getCachedUserNames,
} from '@/src/utils/flowNormalizationOptions';

/**
 * Provides `FlowTextNormalizationOptions` with live identity maps (users,
 * channels, groups) so that `flowDefinitionToMarkdown` / `normalizeFlowTextToMarkdown`
 * can resolve mention IDs to display names.
 *
 * Used by both the collapsed-preview path (`conversation-composer-content`) and
 * the rich Flow renderer (`flow-json-message`) so mention labels stay consistent
 * across collapsed and expanded states.
 */
export const useFlowNormalizationOptions = (): FlowTextNormalizationOptions => {
  return useContext(FlowNormalizationOptionsContext) ?? EMPTY_FLOW_NORMALIZATION_OPTIONS;
};
