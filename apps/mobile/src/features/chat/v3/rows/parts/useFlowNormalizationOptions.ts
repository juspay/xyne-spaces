import { useContext } from 'react';

import {
  EMPTY_FLOW_NORMALIZATION_OPTIONS,
  FlowNormalizationOptionsContext,
} from '@/src/contexts/FlowNormalizationOptionsContext';
import type { FlowTextNormalizationOptions } from '@/src/utils/flowJsonMarkdown';

/** Reads the app-level maps so recycled Flow rows do not subscribe to directories. */
export const useFlowNormalizationOptions = (): FlowTextNormalizationOptions =>
  useContext(FlowNormalizationOptionsContext) ?? EMPTY_FLOW_NORMALIZATION_OPTIONS;
