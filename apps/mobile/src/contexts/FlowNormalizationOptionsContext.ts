import { createContext } from 'react';

import type { FlowTextNormalizationOptions } from '@/src/utils/flowJsonMarkdown';

export const EMPTY_FLOW_NORMALIZATION_OPTIONS: FlowTextNormalizationOptions = {
  userNames: new Map(),
  channelNames: new Map(),
  groupNames: new Map(),
};

export const FlowNormalizationOptionsContext = createContext<FlowTextNormalizationOptions | null>(
  null,
);
