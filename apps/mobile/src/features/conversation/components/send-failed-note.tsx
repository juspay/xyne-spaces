import { memo, type ReactElement } from 'react';
import { Text } from 'react-native';
import { usePendingStatusByMessageId } from '@xyne/shared/messages';

type SendFailedNoteProps = {
  messageId: string | null | undefined;
  /** Space above, so it sits like the row's other extras. */
  marginTop: number;
};

/**
 * Says a message of yours did not go, under its words. The red mark by the
 * time alone read as nothing; tapping the row already retries (the classic
 * row's press), so the note names that.
 */
export const SendFailedNote = memo(function SendFailedNote({
  messageId,
  marginTop,
}: SendFailedNoteProps): ReactElement | null {
  const status = usePendingStatusByMessageId(messageId ?? '');
  if (status !== 'failed') return null;
  return (
    <Text
      className='text-[12px] leading-4 font-medium text-spaces-negative'
      style={{ marginTop }}
      accessibilityRole='alert'
    >
      Not sent · Tap to retry
    </Text>
  );
});
