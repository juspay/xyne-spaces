import { Check, Plus } from 'lucide-react-native';
import { type ComponentProps, type ReactElement, type RefObject } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { FlowCardQuestionOptionColors } from './FlowCard';
import type { UserQuestionItem, UserQuestionOption } from '@/src/utils/flowUserQuestionUtils';

export const FLOW_QUESTION_SELECTION_INDICATOR_SIZE = 18;

export type FlowQuestionSelectionMode = 'single' | 'multiple';

const SelectionIndicator = ({
  selected,
  mode,
  colors,
}: {
  selected: boolean;
  mode: FlowQuestionSelectionMode;
  colors: FlowCardQuestionOptionColors;
}): ReactElement => {
  const borderColor = selected ? colors.indicatorFill : colors.indicatorEmpty;
  if (mode === 'single') {
    return (
      <View
        style={{
          width: FLOW_QUESTION_SELECTION_INDICATOR_SIZE,
          height: FLOW_QUESTION_SELECTION_INDICATOR_SIZE,
          borderRadius: FLOW_QUESTION_SELECTION_INDICATOR_SIZE / 2,
          borderWidth: 1.5,
          borderColor,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {selected ? (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.indicatorFill,
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={{
        width: FLOW_QUESTION_SELECTION_INDICATOR_SIZE,
        height: FLOW_QUESTION_SELECTION_INDICATOR_SIZE,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor,
        backgroundColor: selected ? colors.indicatorFill : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 1,
      }}
    >
      {selected ? <Check size={12} color={colors.indicatorCheck} strokeWidth={2.5} /> : null}
    </View>
  );
};

const optionRowStyle = (selected: boolean, colors: FlowCardQuestionOptionColors): ViewStyle => ({
  borderWidth: 1,
  borderColor: selected ? colors.borderSelected : colors.borderDefault,
  borderRadius: 8,
  paddingHorizontal: 10,
  paddingVertical: 8,
  backgroundColor: selected ? 'transparent' : colors.rowBackground,
  minWidth: 0,
});

const optionContent = (
  option: UserQuestionOption,
  selected: boolean,
  selectionMode: FlowQuestionSelectionMode,
  colors: FlowCardQuestionOptionColors,
): ReactElement => (
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
    <SelectionIndicator selected={selected} mode={selectionMode} colors={colors} />
    <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
      <Text className='text-sm font-medium text-foreground'>{option.label}</Text>
      {option.description ? (
        <Text className='text-xs text-foreground'>{option.description}</Text>
      ) : null}
    </View>
  </View>
);

export const FlowQuestionOptionRow = ({
  questionId,
  option,
  selected,
  selectionMode,
  live,
  isSubmitting,
  colors,
  onPress,
}: {
  questionId: string;
  option: UserQuestionOption;
  selected: boolean;
  selectionMode: FlowQuestionSelectionMode;
  live: boolean;
  isSubmitting: boolean;
  colors: FlowCardQuestionOptionColors;
  onPress: () => void;
}): ReactElement => {
  const style = optionRowStyle(selected, colors);
  const content = optionContent(option, selected, selectionMode, colors);
  const key = `${questionId}-${option.label}`;
  if (!live)
    return (
      <View key={key} style={style}>
        {content}
      </View>
    );

  return (
    <Pressable
      key={key}
      accessibilityRole={selectionMode === 'single' ? 'radio' : 'checkbox'}
      accessibilityState={{ selected, checked: selected, disabled: isSubmitting }}
      disabled={isSubmitting}
      onPressIn={(event: GestureResponderEvent) => event.stopPropagation()}
      onPress={(event: GestureResponderEvent) => {
        event.stopPropagation();
        onPress();
      }}
      style={({ pressed }) => [style, pressed ? { opacity: 0.75 } : null]}
    >
      {content}
    </Pressable>
  );
};

const inlineTextInputStyle = (
  colors: FlowCardQuestionOptionColors,
  minHeight: number,
): TextStyle => ({
  minHeight,
  borderWidth: 1,
  borderColor: colors.inputBorder,
  borderRadius: 8,
  paddingHorizontal: 10,
  paddingVertical: 8,
  textAlignVertical: 'top',
  color: colors.inputText,
  backgroundColor: colors.inputBackground,
});

export const flowQuestionTextInputStyle = inlineTextInputStyle;

export const focusFlowQuestionInput = (inputRef: RefObject<TextInput | null>): void => {
  requestAnimationFrame(() => inputRef.current?.focus());
};

export const FlowQuestionTextInput = ({
  inputRef,
  inputProps,
  colors,
  onPrepareFocus,
}: {
  inputRef: RefObject<TextInput | null>;
  inputProps: ComponentProps<typeof TextInput>;
  colors: FlowCardQuestionOptionColors;
  onPrepareFocus: () => void;
}): ReactElement => {
  const handlePressIn = (event: GestureResponderEvent): void => {
    event.stopPropagation();
    onPrepareFocus();
    focusFlowQuestionInput(inputRef);
  };

  return (
    <View
      onStartShouldSetResponderCapture={() => {
        onPrepareFocus();
        return false;
      }}
    >
      <TextInput
        {...inputProps}
        ref={inputRef}
        showSoftInputOnFocus
        placeholderTextColor={colors.inputPlaceholder}
        onPressIn={handlePressIn}
        onFocus={onPrepareFocus}
      />
    </View>
  );
};

export const FlowQuestionCustomOption = ({
  question,
  selectionMode,
  isActive,
  note,
  live,
  isSubmitting,
  colors,
  inputRef,
  onPrepareFocus,
  onOpen,
  onChangeText,
}: {
  question: UserQuestionItem;
  selectionMode: FlowQuestionSelectionMode;
  isActive: boolean;
  note: string;
  live: boolean;
  isSubmitting: boolean;
  colors: FlowCardQuestionOptionColors;
  inputRef: RefObject<TextInput | null>;
  onPrepareFocus: () => void;
  onOpen: () => void;
  onChangeText: (text: string) => void;
}): ReactElement | null => {
  if (question.type === 'open_ended') return null;

  const customActive = isActive || note.trim().length > 0;
  const style = optionRowStyle(customActive, colors);
  const rowContent = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
      {customActive ? (
        <SelectionIndicator selected mode={selectionMode} colors={colors} />
      ) : (
        <View
          style={{
            width: FLOW_QUESTION_SELECTION_INDICATOR_SIZE,
            height: FLOW_QUESTION_SELECTION_INDICATOR_SIZE,
            borderRadius:
              selectionMode === 'single' ? FLOW_QUESTION_SELECTION_INDICATOR_SIZE / 2 : 4,
            borderWidth: 1.5,
            borderColor: colors.indicatorEmpty,
            borderStyle: 'dashed',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 1,
          }}
        >
          <Plus size={11} color={colors.plusIcon} strokeWidth={2.5} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text className='text-sm font-medium text-foreground'>Something else...</Text>
        <Text className='text-xs text-foreground'>
          {customActive ? 'Add a custom answer below' : 'Tap to add a custom answer'}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={{ gap: 8 }}>
      {live ? (
        <Pressable
          accessibilityRole='button'
          accessibilityHint='Opens a field to type a custom answer'
          onPressIn={(event: GestureResponderEvent) => {
            event.stopPropagation();
            onPrepareFocus();
          }}
          onPress={(event: GestureResponderEvent) => {
            event.stopPropagation();
            onOpen();
          }}
          style={({ pressed }) => [style, pressed ? { opacity: 0.75 } : null]}
        >
          {rowContent}
        </Pressable>
      ) : note ? (
        <View style={style}>{rowContent}</View>
      ) : null}
      {customActive ? (
        <FlowQuestionTextInput
          inputRef={inputRef}
          colors={colors}
          onPrepareFocus={onPrepareFocus}
          inputProps={{
            value: note,
            editable: live && !isSubmitting,
            multiline: true,
            placeholder: 'Add a custom answer',
            onChangeText,
            style: inlineTextInputStyle(colors, 72),
          }}
        />
      ) : null}
    </View>
  );
};
