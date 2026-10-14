import { memo, type ReactElement, type ReactNode } from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { cn } from '@/src/utils/cn';

import type { FlowCardStatusTone } from './flow-card.types';

const STATUS_PILL_BG_CLASS: Record<FlowCardStatusTone, string> = {
  completed: 'bg-flow-card-status-completed-bg',
  pending: 'bg-flow-card-status-pending-bg',
  in_progress: 'bg-flow-card-status-completed-bg',
  failed: 'bg-flow-card-status-failed-bg',
};

const STATUS_PILL_TEXT_CLASS: Record<FlowCardStatusTone, string> = {
  completed: 'text-flow-card-status-completed-text',
  pending: 'text-flow-card-status-pending-text',
  in_progress: 'text-flow-card-status-completed-text',
  failed: 'text-flow-card-status-failed-text',
};

type FlowCardHeaderProps = {
  title: string;
  statusLabel?: string;
  statusTone?: FlowCardStatusTone;
  titleStyle: TextStyle;
  containerStyle?: StyleProp<ViewStyle>;
  end?: ReactNode;
};

const FlowCardHeaderComponent = ({
  title,
  statusLabel,
  statusTone,
  titleStyle,
  containerStyle,
  end,
}: FlowCardHeaderProps): ReactElement => {
  const showStatusPill =
    typeof statusLabel === 'string' && statusLabel.trim().length > 0 && statusTone !== undefined;

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
        },
        containerStyle,
      ]}
    >
      <Text
        className='font-bold text-flow-card-header-title'
        style={{
          fontSize: titleStyle.fontSize,
          lineHeight: titleStyle.lineHeight,
        }}
      >
        {title}
      </Text>
      {showStatusPill ? (
        <View className={cn('ml-2 rounded-md px-2 py-0.5', STATUS_PILL_BG_CLASS[statusTone])}>
          <Text
            className={cn(
              'text-[13px] font-bold leading-[17px]',
              STATUS_PILL_TEXT_CLASS[statusTone],
            )}
          >
            {statusLabel}
          </Text>
        </View>
      ) : null}
      {end ? <View style={{ marginLeft: 'auto', paddingLeft: 8 }}>{end}</View> : null}
    </View>
  );
};

const FlowCardHeader = memo(FlowCardHeaderComponent);
FlowCardHeader.displayName = 'FlowCardHeader';

export { FlowCardHeader };
