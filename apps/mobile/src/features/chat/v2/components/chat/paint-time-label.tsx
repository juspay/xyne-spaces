import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { AlertCircle, Clock } from 'lucide-react-native';

import { usePendingStatusByMessageId } from '@xyne/shared/messages';

type PaintTimeLabelProps = {
  messageId: string | null | undefined;
  timeLabel: string;
  textClass?: string;
  color?: string;
};

export const PaintTimeLabel = memo(
  ({ messageId, timeLabel, textClass, color }: PaintTimeLabelProps): ReactElement => {
    const status = usePendingStatusByMessageId(messageId ?? '');
    const iconColor = color ?? '#999';

    return (
      <View className='flex-row items-center gap-1'>
        {status === 'connecting' && <Clock size={12} color={iconColor} />}
        {status === 'failed' && <AlertCircle size={12} color='#e53935' />}
        <Text
          {...(textClass ? { className: textClass } : {})}
          {...(color ? { style: { color } } : {})}
        >
          {timeLabel}
        </Text>
      </View>
    );
  },
);
PaintTimeLabel.displayName = 'PaintTimeLabel';
