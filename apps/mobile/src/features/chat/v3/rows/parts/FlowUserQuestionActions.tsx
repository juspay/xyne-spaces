import { type ReactElement } from 'react';
import { View } from 'react-native';

import { Button } from '@/src/components/ui/button';

export const FlowUserQuestionActions = ({
  currentIndex,
  totalQuestions,
  isSubmitting,
  onSkip,
  onBack,
  onNext,
}: {
  currentIndex: number;
  totalQuestions: number;
  isSubmitting: boolean;
  onSkip: () => void;
  onBack: () => void;
  onNext: () => void;
}): ReactElement => (
  <View
    style={{
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 2,
      minWidth: 0,
      maxWidth: '100%',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}
  >
    <Button
      size='xs'
      label='Skip'
      variant='secondary'
      disabled={isSubmitting}
      loading={isSubmitting}
      onPressIn={event => event.stopPropagation()}
      onPress={event => {
        event.stopPropagation();
        onSkip();
      }}
    />
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {currentIndex > 0 ? (
        <Button
          size='xs'
          label='Back'
          variant='secondary'
          disabled={isSubmitting}
          onPressIn={event => event.stopPropagation()}
          onPress={event => {
            event.stopPropagation();
            onBack();
          }}
        />
      ) : null}
      <Button
        size='xs'
        label={currentIndex >= totalQuestions - 1 ? 'Submit' : 'Next'}
        variant='primary'
        disabled={isSubmitting}
        loading={isSubmitting}
        onPressIn={event => event.stopPropagation()}
        onPress={event => {
          event.stopPropagation();
          onNext();
        }}
      />
    </View>
  </View>
);
