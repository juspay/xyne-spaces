import { Check, X } from 'lucide-react-native';
import { memo, type ReactElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useChatRenderTokens } from '../../theme/ChatRenderProvider';

import type {
  ChatFlowCardQuestionColors,
  ChatFlowCardStepColors,
} from '@/src/theme/chatRenderTokens';
import type { FlowCardStatusTone } from '@/src/utils/flowCardTypes';

export type { FlowCardStatusTone } from '@/src/utils/flowCardTypes';
export type FlowCardStepStatus = 'done' | 'running' | 'queued' | 'failed' | 'included';

export type FlowCardStep = {
  id: string;
  status: FlowCardStepStatus;
};

export type FlowCardStepIndicatorColors = ChatFlowCardStepColors;

export type FlowCardQuestionOptionColors = ChatFlowCardQuestionColors;

const STATUS_PILL_BG_CLASS: Record<FlowCardStatusTone, string> = {
  completed: 'bg-flow-card-status-completed-bg',
  pending: 'bg-flow-card-status-pending-bg',
  ['in_progress']: 'bg-flow-card-status-completed-bg',
  failed: 'bg-flow-card-status-failed-bg',
};

const STATUS_PILL_TEXT_CLASS: Record<FlowCardStatusTone, string> = {
  completed: 'text-flow-card-status-completed-text',
  pending: 'text-flow-card-status-pending-text',
  ['in_progress']: 'text-flow-card-status-completed-text',
  failed: 'text-flow-card-status-failed-text',
};

export const FlowCardBody = memo(function FlowCardBody({
  children,
  containerStyle,
  gap = 6,
}: {
  children: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  gap?: number;
}): ReactElement {
  return (
    <View style={[{ alignSelf: 'stretch', width: '100%', minWidth: 0, gap }, containerStyle]}>
      {children}
    </View>
  );
});
FlowCardBody.displayName = 'FlowCardBody';

export const FlowCardHeader = memo(function FlowCardHeader({
  title,
  statusLabel,
  statusTone,
  titleStyle,
  containerStyle,
}: {
  title: string;
  statusLabel?: string;
  statusTone?: FlowCardStatusTone;
  titleStyle: TextStyle;
  containerStyle?: StyleProp<ViewStyle>;
}): ReactElement {
  const showStatusPill = Boolean(statusLabel?.trim()) && statusTone !== undefined;
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }, containerStyle]}
    >
      <Text
        className='font-bold text-flow-card-header-title'
        style={{ fontSize: titleStyle.fontSize, lineHeight: titleStyle.lineHeight }}
      >
        {title}
      </Text>
      {showStatusPill && statusTone ? (
        <View className={`ml-2 rounded-md px-2 py-0.5 ${STATUS_PILL_BG_CLASS[statusTone]}`}>
          <Text
            className={`text-[13px] font-bold leading-[17px] ${STATUS_PILL_TEXT_CLASS[statusTone]}`}
          >
            {statusLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
});
FlowCardHeader.displayName = 'FlowCardHeader';

const defaultProgressLabel = (completedCount: number, totalCount: number): string =>
  `${completedCount} of ${totalCount} completed`;

export const FlowCardProgress = memo(function FlowCardProgress({
  completedCount,
  totalCount,
  label,
  containerStyle,
}: {
  completedCount: number;
  totalCount: number;
  label?: string;
  containerStyle?: StyleProp<ViewStyle>;
}): ReactElement | null {
  if (totalCount <= 0) return null;
  return (
    <View style={containerStyle}>
      <Text className='mb-1 text-sm font-medium leading-[18px] text-flow-card-progress-text'>
        {label ?? defaultProgressLabel(completedCount, totalCount)}
      </Text>
    </View>
  );
});
FlowCardProgress.displayName = 'FlowCardProgress';

const stepIndicator = (
  status: FlowCardStepStatus,
  colors: FlowCardStepIndicatorColors,
): ReactElement => {
  if (status === 'done' || status === 'included') {
    return (
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: colors.checkedFill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Check size={10} color={colors.checkIcon} strokeWidth={2.5} />
      </View>
    );
  }
  if (status === 'running') {
    return (
      <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size='small' color={colors.spinner} />
      </View>
    );
  }
  if (status === 'failed') {
    return (
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: colors.failedFill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={10} color={colors.failedIcon} strokeWidth={2.5} />
      </View>
    );
  }
  return (
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1.6,
        borderColor: colors.emptyBorder,
      }}
    />
  );
};

export const FlowCardStepList = memo(function FlowCardStepList({
  steps,
  colors,
  renderStepContent,
  containerStyle,
  stepGap = 8,
}: {
  steps: readonly FlowCardStep[];
  colors: FlowCardStepIndicatorColors;
  renderStepContent: (step: FlowCardStep) => ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  stepGap?: number;
}): ReactElement | null {
  if (steps.length === 0) return null;
  return (
    <View style={[{ gap: stepGap, width: '100%', minWidth: 0 }, containerStyle]}>
      {steps.map(step => (
        <View
          key={step.id}
          style={{ flexDirection: 'row', alignItems: 'flex-start', width: '100%', minWidth: 0 }}
        >
          <View
            style={{
              width: 24,
              alignItems: 'center',
              paddingTop: 1,
              marginRight: 7,
              flexShrink: 0,
            }}
          >
            {stepIndicator(step.status, colors)}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>{renderStepContent(step)}</View>
        </View>
      ))}
    </View>
  );
});
FlowCardStepList.displayName = 'FlowCardStepList';

export const useFlowCardStepColors = (): FlowCardStepIndicatorColors => {
  const tokens = useChatRenderTokens();
  return tokens.flowCardStepColors;
};

export const useFlowCardQuestionOptionColors = (): FlowCardQuestionOptionColors => {
  const tokens = useChatRenderTokens();
  return tokens.flowCardQuestionColors;
};
