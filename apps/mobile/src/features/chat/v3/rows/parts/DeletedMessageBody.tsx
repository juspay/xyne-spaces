import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

const DELETED_MESSAGE_PLACEHOLDER = 'This message was deleted';

/** V2-compatible tombstone content; deleted rows keep the normal timestamp row. */
export const DeletedMessageBody = memo(function DeletedMessageBody(): ReactElement {
  return (
    <View className='mb-2.5'>
      <Text className='text-base italic leading-5 text-secondary-foreground'>
        {DELETED_MESSAGE_PLACEHOLDER}
      </Text>
    </View>
  );
});
