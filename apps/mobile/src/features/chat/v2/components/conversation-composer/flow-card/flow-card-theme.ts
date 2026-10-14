import { useMemo } from 'react';
import { useCSSVariable } from 'uniwind';

import type { FlowCardQuestionOptionColors, FlowCardStepIndicatorColors } from './flow-card.types';

export const useFlowCardStepColors = (): FlowCardStepIndicatorColors => {
  const checkedFill = useCSSVariable('--color-flow-card-step-checked-fill') as string;
  const checkIcon = useCSSVariable('--color-flow-card-step-check-icon') as string;
  const emptyBorder = useCSSVariable('--color-flow-card-step-empty-border') as string;
  const spinner = useCSSVariable('--color-flow-card-step-spinner') as string;
  const failedFill = useCSSVariable('--color-flow-card-step-failed-fill') as string;
  const failedIcon = useCSSVariable('--color-flow-card-step-failed-icon') as string;

  return useMemo(
    () => ({
      checkedFill,
      checkIcon,
      emptyBorder,
      spinner,
      failedFill,
      failedIcon,
    }),
    [checkedFill, checkIcon, emptyBorder, failedFill, failedIcon, spinner],
  );
};

export const useFlowCardQuestionOptionColors = (): FlowCardQuestionOptionColors => {
  const borderDefault = useCSSVariable('--color-border') as string;
  const borderSelected = useCSSVariable('--color-foreground') as string;
  const rowBackground = useCSSVariable('--color-chat-card-muted') as string;
  const indicatorFill = useCSSVariable('--color-flow-card-step-checked-fill') as string;
  const indicatorCheck = useCSSVariable('--color-flow-card-step-check-icon') as string;
  const indicatorEmpty = useCSSVariable('--color-flow-card-step-empty-border') as string;
  const plusIcon = useCSSVariable('--color-muted-foreground') as string;
  const inputBorder = useCSSVariable('--color-border') as string;
  const inputText = useCSSVariable('--color-foreground') as string;
  const inputBackground = useCSSVariable('--color-background') as string;
  const inputPlaceholder = useCSSVariable('--color-muted-foreground') as string;

  return useMemo(
    () => ({
      borderDefault,
      borderSelected,
      rowBackground,
      indicatorFill,
      indicatorCheck,
      indicatorEmpty,
      plusIcon,
      inputBorder,
      inputText,
      inputBackground,
      inputPlaceholder,
    }),
    [
      borderDefault,
      borderSelected,
      indicatorCheck,
      indicatorEmpty,
      indicatorFill,
      inputBackground,
      inputBorder,
      inputPlaceholder,
      inputText,
      plusIcon,
      rowBackground,
    ],
  );
};
