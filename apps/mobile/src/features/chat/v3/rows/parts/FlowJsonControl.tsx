import { type ReactElement } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { FlowAction } from '@xyne/shared';
import {
  normalizeFlowTextToMarkdown,
  type FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';
import { parseFlowAction } from '@/src/utils/flowAction';

import { useChatRenderTokens } from '../../theme/ChatRenderProvider';
import {
  getControlOptions,
  getControlValueFromState,
  getStringProp,
  stripMarkdownSyntax,
} from './flowState';

export function FlowJsonControl({
  type,
  nodeKey,
  props,
  renderStyle,
  normalizationOptions,
  stateValues,
  flowData,
  canPressButtons,
  isSubmitting,
  bodyTextColor,
  mutedTextColor,
  updateFieldValue,
  executeAction,
}: {
  type: string;
  nodeKey: string;
  props: Record<string, unknown> | undefined;
  renderStyle: StyleProp<ViewStyle>;
  normalizationOptions: FlowTextNormalizationOptions;
  stateValues: Record<string, unknown>;
  flowData: Record<string, unknown>;
  canPressButtons: boolean;
  isSubmitting: boolean;
  bodyTextColor: string;
  mutedTextColor: string;
  updateFieldValue: (name: string, value: unknown) => void;
  executeAction: (action: FlowAction) => Promise<void>;
}): ReactElement {
  const tokens = useChatRenderTokens();
  const label = stripMarkdownSyntax(
    normalizeFlowTextToMarkdown(
      getStringProp(props, 'label') || getStringProp(props, 'name') || type,
      normalizationOptions,
    ),
  );
  const value = stripMarkdownSyntax(
    normalizeFlowTextToMarkdown(getControlValueFromState(props, stateValues), normalizationOptions),
  );
  const options = getControlOptions(props, flowData);
  const fieldName = getStringProp(props, 'name');
  const selectedValues = Array.isArray(stateValues[fieldName])
    ? (stateValues[fieldName] as unknown[]).map(String)
    : typeof stateValues[fieldName] === 'string' && stateValues[fieldName]
      ? [String(stateValues[fieldName])]
      : [];
  const liveOptions = canPressButtons && fieldName.length > 0 && options.length > 0;
  const changeAction = parseFlowAction(props);
  return (
    <View
      key={nodeKey}
      accessible
      accessibilityRole='text'
      accessibilityLabel={`${type}: ${label}${liveOptions ? '' : '. Read-only Flow content.'}`}
      style={[
        {
          alignSelf: 'stretch',
          maxWidth: '100%',
          flexShrink: 1,
          minWidth: 0,
          borderWidth: 1,
          borderColor: tokens.tableBorderColor,
          borderStyle: 'solid',
          borderRadius: 6,
          backgroundColor: 'transparent',
          paddingHorizontal: 10,
          paddingVertical: 7,
        },
        renderStyle,
      ]}
    >
      <Text style={{ color: bodyTextColor, fontWeight: '600', fontSize: 14, lineHeight: 19 }}>
        {label}
      </Text>
      {value && options.length === 0 ? (
        <Text style={{ color: mutedTextColor, fontSize: 13, lineHeight: 18, marginTop: 3 }}>
          {value}
        </Text>
      ) : null}
      {options.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {options.map(option => {
            const selected = selectedValues.includes(option.value);
            const optionLabel = stripMarkdownSyntax(
              normalizeFlowTextToMarkdown(option.label, normalizationOptions),
            );
            const optionStyle = {
              borderRadius: 4,
              borderWidth: selected ? 1 : 0,
              borderColor: bodyTextColor,
              backgroundColor: selected ? 'transparent' : tokens.tableHeaderBg,
              paddingHorizontal: 6,
              paddingVertical: 3,
            };
            const choose = (): void => {
              if (!liveOptions || isSubmitting) return;
              if (type === 'multiselect') {
                updateFieldValue(
                  fieldName,
                  selected
                    ? selectedValues.filter(item => item !== option.value)
                    : [...selectedValues, option.value],
                );
              } else {
                updateFieldValue(fieldName, option.value);
              }
              if (changeAction?.type === 'inputChange') void executeAction(changeAction);
            };
            if (!liveOptions) {
              return (
                <View key={`${nodeKey}-option-${option.value}`} style={optionStyle}>
                  <Text style={{ color: bodyTextColor, fontSize: 12 }}>{optionLabel}</Text>
                </View>
              );
            }
            return (
              <Pressable
                key={`${nodeKey}-option-${option.value}`}
                accessibilityRole='button'
                accessibilityState={{ selected, disabled: isSubmitting }}
                disabled={isSubmitting}
                onPressIn={event => event.stopPropagation()}
                onPress={event => {
                  event.stopPropagation();
                  choose();
                }}
                style={({ pressed }) => [optionStyle, pressed ? { opacity: 0.7 } : null]}
              >
                <Text
                  style={{
                    color: bodyTextColor,
                    fontSize: 12,
                    fontWeight: selected ? '700' : '400',
                  }}
                >
                  {optionLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
