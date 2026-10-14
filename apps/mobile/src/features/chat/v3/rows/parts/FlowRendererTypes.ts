import type { FlowAction } from '@xyne/shared';
import type { ReactElement } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type RenderMarkdown = (
  markdown: string,
  key: string,
  style?: StyleProp<ViewStyle>,
) => ReactElement | null;

export type FlowActionContext = {
  canPressButtons: boolean;
  isSubmitting: boolean;
  bodyTextColor: string;
  executeAction: (action: FlowAction) => Promise<void>;
  normalizeText: (text: string) => string;
};
