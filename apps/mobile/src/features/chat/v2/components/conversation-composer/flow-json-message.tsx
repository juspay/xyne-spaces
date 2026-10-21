import type { FlowComponentStyle } from '@xyne/shared';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { memo, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { Button, normalizeButtonVariant } from '@/src/components/ui/button';
import { DASHBOARD_ORIGIN } from '@/src/config';

import { useCustomEmojis } from '@/src/hooks/useCustomEmojis';
import { ORDERED_EMOJIS } from '@/src/components/emoji-picker/emoji-picker.data';
import {
  flowComponentTextToMarkdown,
  flowComponentsToMarkdown,
  isSafeFlowLink,
  normalizeFlowTextToMarkdown,
  sanitizeFlowUrl,
  type FlowComponentLike,
  type FlowDefinitionLike,
  type FlowJsonPart,
  type FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

import {
  ConversationComposerContext,
  useConversationComposer,
} from './conversation-composer-context';
import { ConversationComposerMarkdownBody } from './conversation-composer-markdown-body';
import { FlowDiffMessage } from './flow-diff-message';
import { FlowAgentMessage } from './flow-agent-message';
import { FlowPrMessage } from './flow-pr-message';
import { FlowCallScheduleMessage } from './flow-call-schedule-message';
import { FlowChartMessage } from './flow-chart-message';
import { FlowMcpSuggestMessage } from './flow-mcp-suggest-message';
import { FlowUserQuestionMessage } from './flow-user-question-message';
import { FlowWriteApprovalMessage } from './flow-approval-message';
import { FlowPlanMessage } from './flow-plan-message';
import { htmlToMD } from './utils/htmlToMD';
import {
  implicitActionsForComponent,
  isFlowNetworkAction,
  listFlowActionButtons,
  parseFlowAction,
} from '@/src/utils/flowAction';
import { createWriteApprovalViewModel, isWriteApprovalFlow } from '@/src/utils/flowApprovalUtils';
import {
  agentLibraryPath,
  createAgentCardViewModel,
  getAgentSummaryEntries,
} from '@/src/utils/flowAgentUtils';
import { createCallScheduleViewModel } from '@/src/utils/flowCallScheduleUtils';
import { createChartViewModel } from '@/src/utils/flowChartUtils';
import { codeComponentToMarkdown } from '@/src/utils/flowCodeUtils';
import { createMcpSuggestViewModel } from '@/src/utils/flowMcpSuggestUtils';
import { createPrCardViewModel } from '@/src/utils/flowPrUtils';
import { createUserQuestionViewModel } from '@/src/utils/flowUserQuestionUtils';
import { showMessageToast } from '@/src/utils/toast';
import { useFlowMessageAction } from './utils/useFlowMessageAction';
import { useFlowNormalizationOptions } from './utils/useFlowNormalizationOptions';

type FlowJsonMessageBodyProps = {
  flow: FlowDefinitionLike;
  markdownStyle: MarkdownStyle;
  containerStyle?: StyleProp<ViewStyle>;
  onLinkPress?: (url: string) => void;
  currentUserId?: string;
  isOwnMessage?: boolean;
  selectable?: boolean;
  hydrateInlineEmoji?: boolean;
};

type FlowJsonMessagePartsProps = Omit<FlowJsonMessageBodyProps, 'flow'> & {
  parts: FlowJsonPart[];
};

const getStringProp = (props: Record<string, unknown> | undefined, key: string): string => {
  const value = props?.[key];
  return typeof value === 'string' ? value.trim() : '';
};

const stripMarkdownSyntax = (value: string): string =>
  value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_~`]/g, '');

const STANDARD_EMOJIS = new Map<string, string>(
  ORDERED_EMOJIS.flatMap(emoji => [
    [emoji.name, emoji.emoji],
    [emoji.slug, emoji.emoji],
  ]),
);

const customEmojiMapCache = new WeakMap<object, Map<string, { id: string; name: string }>>();

const getCachedCustomEmojis = (
  emojis: readonly { id: string; name: string }[],
): Map<string, { id: string; name: string }> => {
  const cached = customEmojiMapCache.get(emojis);
  if (cached) return cached;
  const map = new Map(emojis.map(emoji => [emoji.name, { id: emoji.id, name: emoji.name }]));
  customEmojiMapCache.set(emojis, map);
  return map;
};

type FlowDimension = number | `${number}%`;

const parseCssLength = (value: unknown): FlowDimension | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em|%)?$/.exec(trimmed);
  if (!match?.[1]) return undefined;
  const numericValue = Number(match[1]);
  const unit = match[2];
  if (unit === '%') return `${numericValue}%`;
  if (!unit || unit === 'px') return numericValue;
  return numericValue * 16;
};

const parseCssSpacing = (value: unknown): number[] | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (typeof value !== 'string') return undefined;

  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return undefined;
  const parsed = parts.map(part => parseCssLength(part));
  if (parsed.some(item => typeof item !== 'number')) return undefined;
  return parsed as number[];
};

const applyCssSpacing = (
  nativeStyle: ViewStyle,
  property: 'padding' | 'margin',
  value: unknown,
): void => {
  const spacing = parseCssSpacing(value);
  if (!spacing) return;

  const [first, second = first, third = first, fourth = second] = spacing;
  const top = first ?? 0;
  const right = spacing.length === 1 ? top : (second ?? top);
  const bottom = spacing.length <= 2 ? top : (third ?? top);
  const left = spacing.length <= 2 ? right : (fourth ?? right);

  if (spacing.length === 1) {
    nativeStyle[property] = top;
    return;
  }

  if (property === 'padding') {
    nativeStyle.paddingTop = top;
    nativeStyle.paddingRight = right;
    nativeStyle.paddingBottom = bottom;
    nativeStyle.paddingLeft = left;
  } else {
    nativeStyle.marginTop = top;
    nativeStyle.marginRight = right;
    nativeStyle.marginBottom = bottom;
    nativeStyle.marginLeft = left;
  }
};

const parseColorFromBorder = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const color = value
    .trim()
    .split(/\s+/)
    .find(token => token.startsWith('#') || token.startsWith('rgb') || token.startsWith('hsl'));
  return color;
};

const flowStyleToNativeStyle = (
  style: Record<string, unknown> | FlowComponentStyle | undefined,
): ViewStyle => {
  if (!style) return {};

  const styleRecord = style as Record<string, unknown>;
  const nativeStyle: ViewStyle = {};
  applyCssSpacing(nativeStyle, 'padding', styleRecord['padding']);
  applyCssSpacing(nativeStyle, 'margin', styleRecord['margin']);
  const gap = parseCssLength(styleRecord['gap']);
  const width = parseCssLength(styleRecord['width']);
  const maxWidth = parseCssLength(styleRecord['maxWidth']);
  const minWidth = parseCssLength(styleRecord['minWidth']);
  const borderRadius = parseCssLength(styleRecord['borderRadius']);

  if (gap !== undefined) nativeStyle.gap = gap;
  // Percent widths are relative to the bubble. Pixel widths are web canvas
  // sizes (often 400+) and overflow a 78% mobile bubble.
  if (typeof width === 'string') nativeStyle.width = width;
  if (maxWidth !== undefined) nativeStyle.maxWidth = maxWidth;
  if (typeof minWidth === 'string') nativeStyle.minWidth = minWidth;
  if (borderRadius !== undefined) nativeStyle.borderRadius = borderRadius;

  const align = styleRecord['align'];
  if (align === 'left') nativeStyle.alignItems = 'flex-start';
  if (align === 'center') nativeStyle.alignItems = 'center';
  if (align === 'right') nativeStyle.alignItems = 'flex-end';
  if (align === 'stretch') nativeStyle.alignItems = 'stretch';

  if (typeof styleRecord['backgroundColor'] === 'string') {
    nativeStyle.backgroundColor = styleRecord['backgroundColor'];
  }

  // Do not copy web `maxHeight` / `overflow`. Write-approval cards set
  // maxHeight: 280px + overflowY: auto so the dashboard can scroll inside the
  // card. RN has no nested scroll inside LegendList, and `overflow: hidden`
  // clips with no Read more. Tall Flow bodies use message-level collapse
  // instead. Tables keep their own overflow:hidden wrapper below.

  const border = styleRecord['border'];
  if (border) {
    nativeStyle.borderWidth = 1;
    nativeStyle.borderColor = parseColorFromBorder(border) ?? '#d1d5db';
  }

  const borderLeft = styleRecord['borderLeft'];
  if (borderLeft) {
    nativeStyle.borderLeftWidth = 3;
    nativeStyle.borderLeftColor = parseColorFromBorder(borderLeft) ?? '#d1d5db';
  }

  return nativeStyle;
};

const getStateValue = (values: Record<string, unknown>, expression: string): unknown => {
  const key = expression.trim().replace(/^values\./, '');
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, values);
};

const isVisible = (component: FlowComponentLike, values: Record<string, unknown>): boolean => {
  if (component.hidden === undefined) return true;
  if (typeof component.hidden === 'boolean') return !component.hidden;
  if (typeof component.hidden !== 'string') return true;

  const expression = component.hidden.trim();
  if (!expression) return true;
  if (expression.startsWith('!')) return !getStateValue(values, expression.slice(1));
  return !!getStateValue(values, expression);
};

const isDisabled = (component: FlowComponentLike, values: Record<string, unknown>): boolean => {
  if (component.disabled === true) return true;
  if (typeof component.disabled !== 'string') return false;
  const expression = component.disabled.trim();
  if (!expression) return false;
  if (expression.startsWith('!')) return !getStateValue(values, expression.slice(1));
  return !!getStateValue(values, expression);
};

const getControlValue = (props: Record<string, unknown> | undefined): string =>
  getStringProp(props, 'value') ||
  getStringProp(props, 'defaultValue') ||
  getStringProp(props, 'placeholder');

const getControlValueFromState = (
  props: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
): string => {
  const name = getStringProp(props, 'name');
  const stateValue = name ? values[name] : undefined;
  if (typeof stateValue === 'string') return stateValue;
  if (typeof stateValue === 'number' || typeof stateValue === 'boolean') return String(stateValue);
  if (Array.isArray(stateValue)) return stateValue.map(String).join(', ');
  return getControlValue(props);
};

const getControlOptions = (
  props: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
): { label: string; value: string }[] => {
  const configuredOptions = props?.['options'];
  const options =
    typeof configuredOptions === 'string' && configuredOptions.startsWith('$')
      ? data[configuredOptions.slice(1)]
      : configuredOptions;
  if (!Array.isArray(options)) return [];
  return options
    .filter(value => typeof value === 'object' && value !== null && !Array.isArray(value))
    .map(value => {
      const record = value as Record<string, unknown>;
      const label = getStringProp(record, 'label');
      const optionValue = getStringProp(record, 'value') || label;
      return { label: label || optionValue, value: optionValue };
    })
    .filter(option => option.label.length > 0 && option.value.length > 0);
};

type FlowJsonSubmitButtonProps = {
  label: string;
  variant: string;
  live: boolean;
  disabled: boolean;
  submitting: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
};

const FlowJsonSubmitButton = ({
  label,
  variant,
  live,
  disabled,
  submitting,
  style,
  onPress,
}: FlowJsonSubmitButtonProps): ReactElement => {
  // Sheets portal outside ConversationComposer.Root — do not throw.
  const composer = useContext(ConversationComposerContext);
  const suppressBubblePress = composer?.suppressBubblePress;
  const isInteractive = live && typeof onPress === 'function';

  return (
    <Button
      size='xs'
      label={label}
      variant={normalizeButtonVariant(variant)}
      loading={isInteractive && submitting}
      disabled={isInteractive && disabled}
      readOnly={!isInteractive}
      style={style}
      {...(isInteractive && onPress
        ? {
            onPressIn: (event): void => {
              event.stopPropagation();
              suppressBubblePress?.();
            },
            onPress: (event): void => {
              event.stopPropagation();
              if (disabled) return;
              onPress();
            },
          }
        : {})}
    />
  );
};

const FlowJsonMessageBodyComponent = ({
  flow,
  markdownStyle,
  containerStyle,
  onLinkPress,
  currentUserId,
  isOwnMessage = false,
  selectable = false,
  hydrateInlineEmoji = true,
}: FlowJsonMessageBodyProps): ReactElement => {
  const baseNormalizationOptions = useFlowNormalizationOptions();
  const customEmojiQuery = useCustomEmojis({ enabled: hydrateInlineEmoji });
  const { suppressBubblePress } = useConversationComposer();
  const { activeFlow, isSubmitting, canPressButtons, executeAction, updateFieldValue } =
    useFlowMessageAction(flow);
  const stateValues = activeFlow.state?.values ?? {};
  const flowData = activeFlow.data ?? {};

  const normalizationOptions = useMemo<FlowTextNormalizationOptions>(
    () => ({
      ...baseNormalizationOptions,
      standardEmojis: STANDARD_EMOJIS,
      customEmojis: getCachedCustomEmojis(customEmojiQuery.data),
    }),
    [baseNormalizationOptions, customEmojiQuery.data],
  );

  const markdownLinkPress = useMemo(
    () => (onLinkPress ? ({ url }: { url: string }): void => onLinkPress(url) : undefined),
    [onLinkPress],
  );
  const bodyTextColor = markdownStyle.paragraph?.color ?? '#1f2937';
  const mutedTextColor = markdownStyle.blockquote?.color ?? bodyTextColor;
  const inheritedContainerStyle = StyleSheet.flatten(containerStyle) ?? {};

  const renderMarkdown = (
    markdown: string,
    key: string,
    style?: StyleProp<ViewStyle>,
  ): ReactElement | null => {
    if (!markdown.trim()) return null;
    const componentStyle = style ? StyleSheet.flatten(style) : undefined;
    const resolvedContainerStyle: ViewStyle = {
      ...inheritedContainerStyle,
      ...(componentStyle ?? {}),
    };
    return (
      <ConversationComposerMarkdownBody
        key={key}
        markdown={markdown}
        markdownStyle={markdownStyle}
        containerStyle={resolvedContainerStyle}
        {...(markdownLinkPress ? { onLinkPress: markdownLinkPress } : {})}
        {...(currentUserId ? { currentUserId } : {})}
        isOwnMessage={isOwnMessage}
        selectable={selectable}
        hydrateInlineEmoji={hydrateInlineEmoji}
      />
    );
  };

  const renderNestedMarkdown = (markdown: string, key: string): ReactElement | null => {
    if (!markdown.trim()) return null;
    const { maxWidth: _maxWidth, ...parentStyle } = inheritedContainerStyle;
    return (
      <ConversationComposerMarkdownBody
        key={key}
        markdown={markdown}
        markdownStyle={markdownStyle}
        containerStyle={{
          ...parentStyle,
          width: '100%',
          minWidth: 0,
          flexShrink: 1,
        }}
        {...(markdownLinkPress ? { onLinkPress: markdownLinkPress } : {})}
        {...(currentUserId ? { currentUserId } : {})}
        isOwnMessage={isOwnMessage}
        selectable={selectable}
        hydrateInlineEmoji={hydrateInlineEmoji}
      />
    );
  };

  const getComponentKey = (
    parentKey: string,
    component: FlowComponentLike,
    index: number,
  ): string => {
    const id = typeof component.id === 'string' && component.id.trim() ? component.id : index;
    return `${parentKey}-${id}`;
  };

  const isFlowListTextComponent = (component: FlowComponentLike): boolean => {
    if (!isVisible(component, stateValues) || component.type !== 'text') return false;
    const props = component.props;
    if (props?.['codeBlock'] === true) return false;

    return /^(?:[ \t\u00a0\u2007\u202f]{0,3})(?:\d+[.)]|[-+*])[ \t\u00a0\u2007\u202f]+/.test(
      flowComponentTextToMarkdown(component, normalizationOptions),
    );
  };

  const haveSameFlowStyle = (first: FlowComponentLike, second: FlowComponentLike): boolean => {
    const firstStyle = (first.style ?? {}) as Record<string, unknown>;
    const secondStyle = (second.style ?? {}) as Record<string, unknown>;
    const keys = new Set([...Object.keys(firstStyle), ...Object.keys(secondStyle)]);
    return Array.from(keys).every(key => Object.is(firstStyle[key], secondStyle[key]));
  };

  const getComponentRenderStyle = (component: FlowComponentLike): ViewStyle => {
    const nativeStyle = flowStyleToNativeStyle(component.style);
    return isDisabled(component, stateValues) ? { ...nativeStyle, opacity: 0.55 } : nativeStyle;
  };

  const renderComponentChildren = (
    components: FlowComponentLike[] | undefined,
    parentKey: string,
    allowListGrouping = true,
  ): ReactNode[] => {
    if (!components) return [];

    const rendered: ReactNode[] = [];
    let index = 0;
    while (index < components.length) {
      const component = components[index];
      if (!component) {
        index += 1;
        continue;
      }

      if (allowListGrouping && isFlowListTextComponent(component)) {
        const listComponents = [component];
        let nextIndex = index + 1;
        while (nextIndex < components.length) {
          const nextComponent = components[nextIndex];
          if (
            !nextComponent ||
            !isFlowListTextComponent(nextComponent) ||
            !haveSameFlowStyle(component, nextComponent) ||
            isDisabled(component, stateValues) !== isDisabled(nextComponent, stateValues)
          ) {
            break;
          }
          listComponents.push(nextComponent);
          nextIndex += 1;
        }

        if (listComponents.length > 1) {
          const listMarkdown = flowComponentsToMarkdown(listComponents, normalizationOptions);
          const listStyle = getComponentRenderStyle(component);
          rendered.push(
            renderMarkdown(
              listMarkdown,
              `${getComponentKey(parentKey, component, index)}-list`,
              listStyle,
            ),
          );
          index = nextIndex;
          continue;
        }
      }

      rendered.push(renderComponent(component, getComponentKey(parentKey, component, index)));
      index += 1;
    }

    return rendered;
  };

  const renderComponent = (component: FlowComponentLike, key: string): ReactNode => {
    if (!isVisible(component, stateValues)) return null;

    const type = typeof component.type === 'string' ? component.type : '';
    const props = component.props;
    const nativeStyle = flowStyleToNativeStyle(component.style);
    const disabledStyle = isDisabled(component, stateValues) ? { opacity: 0.55 } : undefined;
    const renderStyle = disabledStyle ? { ...nativeStyle, ...disabledStyle } : nativeStyle;
    const children = Array.isArray(component.children)
      ? renderComponentChildren(component.children, key, type !== 'row')
      : null;

    if (type === 'text' || type === 'heading') {
      const baseMarkdown = flowComponentTextToMarkdown(component, normalizationOptions);
      const markdown =
        type === 'heading' && !props?.['codeBlock']
          ? `${'#'.repeat(
              typeof props?.['level'] === 'number' ? Math.min(4, Math.max(1, props['level'])) : 2,
            )} ${baseMarkdown.replace(/^#+\s+/, '')}`
          : baseMarkdown;
      return renderMarkdown(markdown, key, renderStyle);
    }

    if (type === 'diff') {
      return (
        <View key={key} style={[{ alignSelf: 'stretch', minWidth: 0, width: '100%' }, renderStyle]}>
          <FlowDiffMessage component={component} />
        </View>
      );
    }

    if (type === 'code') {
      const markdown = codeComponentToMarkdown(component, normalizationOptions);
      if (!markdown) return null;
      return renderMarkdown(markdown, key, renderStyle);
    }

    if (type === 'pr') {
      const viewModel = createPrCardViewModel(component);
      if (!viewModel) return null;

      return (
        <View key={key} style={[{ alignSelf: 'stretch', minWidth: 0, width: '100%' }, renderStyle]}>
          <FlowPrMessage
            component={component}
            containerStyle={inheritedContainerStyle}
            renderMarkdown={renderMarkdown}
            renderNestedMarkdown={renderNestedMarkdown}
          />
        </View>
      );
    }

    if (type === 'chart') {
      const viewModel = createChartViewModel(component);
      if (!viewModel) return null;

      return (
        <View key={key} style={[{ alignSelf: 'stretch', minWidth: 0, width: '100%' }, renderStyle]}>
          <FlowChartMessage component={component} containerStyle={inheritedContainerStyle} />
        </View>
      );
    }

    if (type === 'plan') {
      const implicitButtons = implicitActionsForComponent(component, key);
      return (
        <View key={key} style={[{ alignSelf: 'stretch', minWidth: 0, width: '100%' }, renderStyle]}>
          <FlowPlanMessage
            component={component}
            normalizationOptions={normalizationOptions}
            markdownStyle={markdownStyle}
            containerStyle={inheritedContainerStyle}
            renderMarkdown={renderMarkdown}
            renderNestedMarkdown={renderNestedMarkdown}
            {...(onLinkPress ? { onLinkPress } : {})}
            {...(currentUserId ? { currentUserId } : {})}
            isOwnMessage={isOwnMessage}
            selectable={selectable}
          />
          {implicitButtons.length > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 8,
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              {implicitButtons.map(button => (
                <FlowJsonSubmitButton
                  key={button.key}
                  label={button.label}
                  variant={button.variant}
                  live={canPressButtons}
                  disabled={isSubmitting}
                  submitting={isSubmitting}
                  {...(canPressButtons ? { onPress: () => void executeAction(button.action) } : {})}
                />
              ))}
            </View>
          ) : null}
        </View>
      );
    }

    if (type === 'agent') {
      const viewModel = createAgentCardViewModel(
        component,
        activeFlow,
        text => normalizeFlowTextToMarkdown(text, normalizationOptions),
        { ...(currentUserId ? { currentUserId } : {}) },
      );
      if (!viewModel) return null;

      const implicitButtons = viewModel.showActions
        ? implicitActionsForComponent(component, key)
        : [];
      const titleStyle = {
        fontSize: markdownStyle.paragraph?.fontSize ?? 16,
        lineHeight: markdownStyle.paragraph?.lineHeight ?? 20,
      };

      return (
        <View key={key} style={[{ alignSelf: 'stretch', minWidth: 0, width: '100%' }, renderStyle]}>
          <FlowAgentMessage
            viewModel={viewModel}
            titleStyle={titleStyle}
            containerStyle={inheritedContainerStyle}
            buttons={implicitButtons}
            isSubmitting={isSubmitting}
            onAction={button => executeAction(button.action)}
            updateFieldValue={updateFieldValue}
            renderMarkdown={renderMarkdown}
            renderNestedMarkdown={renderNestedMarkdown}
            renderButton={button => {
              const label = stripMarkdownSyntax(
                normalizeFlowTextToMarkdown(button.label, normalizationOptions),
              );
              const live = canPressButtons && isFlowNetworkAction(button.action);
              return (
                <FlowJsonSubmitButton
                  key={button.key}
                  label={label}
                  variant={button.variant}
                  live={live}
                  disabled={isSubmitting}
                  submitting={isSubmitting}
                  {...(live ? { onPress: () => void executeAction(button.action) } : {})}
                />
              );
            }}
          />
        </View>
      );
    }

    if (type === 'agent_summary') {
      const entries = getAgentSummaryEntries(props);
      if (entries.length === 0) {
        const fallback = flowComponentsToMarkdown([component], normalizationOptions);
        return renderMarkdown(fallback, key, renderStyle);
      }

      const title = getStringProp(props, 'title') || 'Agents';
      return (
        <View
          key={key}
          style={[{ alignSelf: 'stretch', minWidth: 0, width: '100%', gap: 8 }, renderStyle]}
        >
          {renderMarkdown(
            `# ${normalizeFlowTextToMarkdown(title, normalizationOptions)}`,
            `${key}-title`,
          )}
          {entries.map(entry => (
            <Pressable
              key={`${key}-${entry.slug}`}
              accessibilityRole='button'
              accessibilityLabel={`View ${entry.name}`}
              onPress={() => {
                void WebBrowser.openBrowserAsync(
                  `${DASHBOARD_ORIGIN}${agentLibraryPath(entry.slug)}`,
                ).catch(() => {});
              }}
              style={{ gap: 2, minWidth: 0 }}
            >
              <Text className='text-base font-semibold text-foreground'>{entry.name}</Text>
              <Text className='text-sm text-foreground'>@{entry.slug}</Text>
            </Pressable>
          ))}
        </View>
      );
    }

    if (type === 'user_question') {
      const viewModel = createUserQuestionViewModel(component, activeFlow, {
        ...(currentUserId ? { currentUserId } : {}),
      });
      if (!viewModel) return null;

      const answers =
        typeof stateValues['answers'] === 'object' &&
        stateValues['answers'] !== null &&
        !Array.isArray(stateValues['answers'])
          ? (stateValues['answers'] as Record<string, string | string[]>)
          : {};
      const notes =
        typeof stateValues['notes'] === 'object' &&
        stateValues['notes'] !== null &&
        !Array.isArray(stateValues['notes'])
          ? (stateValues['notes'] as Record<string, string>)
          : {};
      const titleStyle = {
        fontSize: markdownStyle.paragraph?.fontSize ?? 16,
        lineHeight: markdownStyle.paragraph?.lineHeight ?? 20,
      };

      return (
        <View key={key} style={[{ alignSelf: 'stretch', minWidth: 0, width: '100%' }, renderStyle]}>
          <FlowUserQuestionMessage
            viewModel={viewModel}
            titleStyle={titleStyle}
            containerStyle={inheritedContainerStyle}
            canInteract={canPressButtons && viewModel.showActions}
            isSubmitting={isSubmitting}
            answers={answers}
            notes={notes}
            onAnswersChange={next => updateFieldValue('answers', next)}
            onNotesChange={next => updateFieldValue('notes', next)}
            onSubmit={() => {
              if (viewModel.submitAction) {
                void executeAction(viewModel.submitAction);
              }
            }}
            onValidationError={message => showMessageToast(message, 'error')}
          />
        </View>
      );
    }

    if (type === 'call_schedule') {
      const viewModel = createCallScheduleViewModel(component);
      if (!viewModel) return null;

      return (
        <View key={key} style={[{ alignSelf: 'stretch', minWidth: 0, width: '100%' }, renderStyle]}>
          <FlowCallScheduleMessage
            component={component}
            containerStyle={inheritedContainerStyle}
            canInteract={canPressButtons}
            isSubmitting={isSubmitting}
            selectionValue={stateValues[viewModel.componentId]}
            onSelectionChange={next => updateFieldValue(viewModel.componentId, next)}
            onApprove={() => {
              void executeAction({ type: 'submit', actionId: 'schedule-approve' });
            }}
          />
        </View>
      );
    }

    if (type === 'mcp_suggest') {
      const viewModel = createMcpSuggestViewModel(component);
      if (!viewModel) return null;

      return (
        <View key={key} style={[{ alignSelf: 'stretch', minWidth: 0, width: '100%' }, renderStyle]}>
          <FlowMcpSuggestMessage component={component} containerStyle={inheritedContainerStyle} />
        </View>
      );
    }

    if (type === 'link') {
      const label = normalizeFlowTextToMarkdown(
        getStringProp(props, 'label'),
        normalizationOptions,
      );
      const href = sanitizeFlowUrl(getStringProp(props, 'href'));
      return renderMarkdown(isSafeFlowLink(href) ? `[${label}](${href})` : label, key, renderStyle);
    }

    if (type === 'image') {
      const src = sanitizeFlowUrl(getStringProp(props, 'src'));
      if (!src) return null;
      const imageStyle: ImageStyle = {
        width: parseCssLength(props?.['width']) ?? '100%',
        height: parseCssLength(props?.['height']) ?? 160,
        maxWidth: '100%',
        borderRadius: 6,
      };
      return (
        <Image
          key={key}
          source={{ uri: src }}
          style={[renderStyle as ImageStyle, imageStyle]}
          contentFit={props?.['objectFit'] === 'cover' ? 'cover' : 'contain'}
          accessibilityLabel={getStringProp(props, 'alt') || 'Flow image'}
        />
      );
    }

    if (type === 'divider') {
      return <View key={key} style={[{ height: 1, backgroundColor: '#d1d5db' }, renderStyle]} />;
    }

    if (type === 'table') {
      const rows = Array.isArray(props?.['rows']) ? props['rows'] : [];
      const hasHeader = props?.['hasHeader'] === true;
      const columnAlignments = Array.isArray(props?.['columnAlignments'])
        ? props['columnAlignments']
        : [];
      return (
        <View key={key} style={[{ width: '100%', overflow: 'hidden' }, renderStyle]}>
          {rows.map((row, rowIndex) => {
            if (!Array.isArray(row)) return null;
            return (
              <View
                key={`${key}-row-${rowIndex}`}
                style={{
                  flexDirection: 'row',
                  backgroundColor: hasHeader && rowIndex === 0 ? '#e5e7eb' : 'transparent',
                  borderBottomWidth: 1,
                  borderBottomColor: '#d1d5db',
                }}
              >
                {row.map((cell, cellIndex) => {
                  const cellText = normalizeFlowTextToMarkdown(
                    typeof cell === 'string' ? cell : String(cell),
                    normalizationOptions,
                  );
                  return (
                    <View
                      key={`${key}-cell-${rowIndex}-${cellIndex}`}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        paddingHorizontal: 8,
                        paddingVertical: 6,
                        ...(typeof columnAlignments[cellIndex] === 'string'
                          ? {
                              alignItems:
                                columnAlignments[cellIndex] === 'right'
                                  ? 'flex-end'
                                  : columnAlignments[cellIndex] === 'center'
                                    ? 'center'
                                    : 'flex-start',
                            }
                          : {}),
                      }}
                    >
                      {renderMarkdown(cellText, `${key}-cell-body-${rowIndex}-${cellIndex}`)}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      );
    }

    if (type === 'button') {
      const label = stripMarkdownSyntax(
        normalizeFlowTextToMarkdown(
          getStringProp(props, 'label') || getStringProp(props, 'name') || 'Button',
          normalizationOptions,
        ),
      );
      const action = parseFlowAction(props);
      const live = canPressButtons && action !== null;
      return (
        <FlowJsonSubmitButton
          key={key}
          label={label}
          variant={getStringProp(props, 'variant') || 'secondary'}
          live={live}
          disabled={isDisabled(component, stateValues) || isSubmitting}
          submitting={isSubmitting}
          style={renderStyle}
          {...(live && action ? { onPress: () => void executeAction(action) } : {})}
        />
      );
    }

    if (
      type === 'input' ||
      type === 'textarea' ||
      type === 'dropdown' ||
      type === 'select' ||
      type === 'multiselect' ||
      type === 'date'
    ) {
      const label = stripMarkdownSyntax(
        normalizeFlowTextToMarkdown(
          getStringProp(props, 'label') || getStringProp(props, 'name') || type,
          normalizationOptions,
        ),
      );
      const value = stripMarkdownSyntax(
        normalizeFlowTextToMarkdown(
          getControlValueFromState(props, stateValues),
          normalizationOptions,
        ),
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
          key={key}
          accessible
          accessibilityRole='text'
          accessibilityLabel={`${type}: ${label}${liveOptions ? '' : '. Read-only Flow content.'}`}
          style={[
            {
              alignSelf: 'stretch' as const,
              maxWidth: '100%' as const,
              flexShrink: 1,
              minWidth: 0,
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderStyle: 'solid' as const,
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
                const choose = (): void => {
                  if (!liveOptions || isSubmitting) return;
                  suppressBubblePress();
                  if (type === 'multiselect') {
                    const next = selected
                      ? selectedValues.filter(item => item !== option.value)
                      : [...selectedValues, option.value];
                    updateFieldValue(fieldName, next);
                    return;
                  }
                  updateFieldValue(fieldName, option.value);
                  if (changeAction?.type === 'inputChange') void executeAction(changeAction);
                };
                const optionStyle = {
                  borderRadius: 4,
                  borderWidth: selected ? 1 : 0,
                  borderColor: bodyTextColor,
                  backgroundColor: selected ? 'transparent' : '#e5e7eb',
                  paddingHorizontal: 6,
                  paddingVertical: 3,
                };
                if (!liveOptions) {
                  return (
                    <View key={`${key}-option-${option.value}`} style={optionStyle}>
                      <Text style={{ color: bodyTextColor, fontSize: 12 }}>{optionLabel}</Text>
                    </View>
                  );
                }
                return (
                  <Pressable
                    key={`${key}-option-${option.value}`}
                    accessibilityRole='button'
                    accessibilityState={{ selected, disabled: isSubmitting }}
                    disabled={isSubmitting}
                    onPressIn={event => {
                      event.stopPropagation();
                      suppressBubblePress();
                    }}
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

    if (type === 'row' || type === 'column' || type === 'card') {
      const isCard = type === 'card';
      const isRow = type === 'row';
      return (
        <View
          key={key}
          style={[
            {
              flexDirection: isRow ? 'row' : 'column',
              flexWrap: isRow ? 'wrap' : undefined,
              alignItems: isRow ? 'flex-start' : undefined,
              minWidth: 0,
              maxWidth: '100%',
              ...(isRow && nativeStyle.gap === undefined ? { gap: 8 } : {}),
              ...(isCard
                ? {
                    borderRadius: 8,
                    borderWidth: nativeStyle.borderWidth ?? 1,
                    borderColor: nativeStyle.borderColor ?? '#d1d5db',
                    padding: nativeStyle.padding ?? 10,
                  }
                : {}),
            },
            nativeStyle,
            disabledStyle,
          ]}
        >
          {children}
        </View>
      );
    }

    if (children)
      return (
        <View key={key} style={[nativeStyle, disabledStyle]}>
          {children}
        </View>
      );

    const fallback = flowComponentsToMarkdown([component], normalizationOptions);
    return renderMarkdown(fallback, key, nativeStyle);
  };

  const titleStyle = {
    fontSize: markdownStyle.paragraph?.fontSize ?? 16,
    lineHeight: markdownStyle.paragraph?.lineHeight ?? 20,
  };

  if (isWriteApprovalFlow(activeFlow)) {
    const viewModel = createWriteApprovalViewModel(activeFlow, text =>
      normalizeFlowTextToMarkdown(text, normalizationOptions),
    );

    if (viewModel) {
      return (
        <View style={[{ minWidth: 0, maxWidth: '100%', gap: 8 }, containerStyle]}>
          <FlowWriteApprovalMessage
            viewModel={viewModel}
            titleStyle={titleStyle}
            renderMarkdown={renderMarkdown}
            renderNestedMarkdown={renderNestedMarkdown}
            renderButton={button => {
              const label = stripMarkdownSyntax(
                normalizeFlowTextToMarkdown(button.label, normalizationOptions),
              );
              const live = canPressButtons && isFlowNetworkAction(button.action);
              return (
                <FlowJsonSubmitButton
                  key={button.key}
                  label={label}
                  variant={button.variant}
                  live={live}
                  disabled={isSubmitting}
                  submitting={isSubmitting}
                  {...(live ? { onPress: () => void executeAction(button.action) } : {})}
                />
              );
            }}
          />
        </View>
      );
    }
  }

  const children = renderComponentChildren(activeFlow.components, 'flow');
  const title = typeof activeFlow.title === 'string' ? activeFlow.title.trim() : '';
  const titleElement = title
    ? renderMarkdown(`# ${normalizeFlowTextToMarkdown(title, normalizationOptions)}`, 'flow-title')
    : null;

  return (
    <View style={[{ minWidth: 0, maxWidth: '100%', gap: 8 }, containerStyle]}>
      {titleElement}
      {children}
    </View>
  );
};

export const FlowJsonMessageBody = memo(FlowJsonMessageBodyComponent);
FlowJsonMessageBody.displayName = 'FlowJsonMessageBody';

const FlowJsonMessagePartsComponent = ({
  parts,
  markdownStyle,
  containerStyle,
  onLinkPress,
  currentUserId,
  isOwnMessage = false,
  selectable = false,
  hydrateInlineEmoji = true,
}: FlowJsonMessagePartsProps): ReactElement => {
  const resolvedContainerStyle = StyleSheet.flatten(containerStyle);
  const childContainerStyle: ViewStyle = {
    minWidth: 0,
    maxWidth: '100%',
    ...(resolvedContainerStyle ?? {}),
  };

  return (
    <View style={[{ minWidth: 0, maxWidth: '100%' }, containerStyle]}>
      {parts.map((part, index) => {
        if (part.type === 'flow') {
          return (
            <FlowJsonMessageBody
              key={`${part.definition.screenId}-${index}`}
              flow={part.definition}
              markdownStyle={markdownStyle}
              containerStyle={childContainerStyle}
              {...(onLinkPress ? { onLinkPress } : {})}
              {...(currentUserId ? { currentUserId } : {})}
              isOwnMessage={isOwnMessage}
              selectable={selectable}
              hydrateInlineEmoji={hydrateInlineEmoji}
            />
          );
        }

        const markdown = htmlToMD(part.html);
        if (!markdown.trim()) return null;
        return (
          <ConversationComposerMarkdownBody
            key={`flow-surrounding-${index}`}
            markdown={markdown}
            markdownStyle={markdownStyle}
            containerStyle={childContainerStyle}
            {...(onLinkPress
              ? {
                  onLinkPress: ({ url }: { url: string }): void => onLinkPress(url),
                }
              : {})}
            {...(currentUserId ? { currentUserId } : {})}
            isOwnMessage={isOwnMessage}
            selectable={selectable}
            hydrateInlineEmoji={hydrateInlineEmoji}
          />
        );
      })}
    </View>
  );
};

export const FlowJsonMessageParts = memo(FlowJsonMessagePartsComponent);
FlowJsonMessageParts.displayName = 'FlowJsonMessageParts';

type FlowJsonActionRowProps = {
  flow: FlowDefinitionLike;
  markdownStyle: MarkdownStyle;
};

const FlowJsonActionRowComponent = ({
  flow,
  markdownStyle: _markdownStyle,
}: FlowJsonActionRowProps): ReactElement | null => {
  const { isSubmitting, canPressButtons, executeAction } = useFlowMessageAction(flow);
  const buttons = listFlowActionButtons(flow);
  if (buttons.length === 0) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      {buttons.map(button => (
        <FlowJsonSubmitButton
          key={button.key}
          label={stripMarkdownSyntax(button.label)}
          variant={button.variant}
          live={canPressButtons}
          disabled={isSubmitting}
          submitting={isSubmitting}
          {...(canPressButtons ? { onPress: () => void executeAction(button.action) } : {})}
        />
      ))}
    </View>
  );
};

export const FlowJsonActionRow = memo(FlowJsonActionRowComponent);
FlowJsonActionRow.displayName = 'FlowJsonActionRow';
