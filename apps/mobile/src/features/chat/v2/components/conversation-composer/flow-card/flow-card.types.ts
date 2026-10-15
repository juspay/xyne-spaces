export type { FlowCardStatusTone } from '@/src/utils/flowCardTypes';

export type FlowCardStepStatus = 'done' | 'running' | 'queued' | 'failed' | 'included';

export type FlowCardStep = {
  id: string;
  status: FlowCardStepStatus;
};

export type FlowCardStepIndicatorColors = {
  checkedFill: string;
  checkIcon: string;
  emptyBorder: string;
  spinner: string;
  failedFill: string;
  failedIcon: string;
};

export type FlowCardQuestionOptionColors = {
  borderDefault: string;
  borderSelected: string;
  rowBackground: string;
  indicatorFill: string;
  indicatorCheck: string;
  indicatorEmpty: string;
  plusIcon: string;
  inputBorder: string;
  inputText: string;
  inputBackground: string;
  inputPlaceholder: string;
};
