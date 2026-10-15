import { memo, useMemo, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { useCustomEmojis } from '@/src/hooks/useCustomEmojis';
import {
  flowComponentTextToMarkdown,
  flowComponentsToMarkdown,
  isSafeFlowLink,
  normalizeFlowTextToMarkdown,
  sanitizeFlowUrl,
  type FlowComponentLike,
  type FlowDefinitionLike,
  type FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

import type { MessageRowModel } from '../../model/chatRow.types';
import {
  flowComponentKey,
  flowComponentRenderStyle,
  haveSameFlowStyle,
  isFlowListTextComponent,
} from './flowComponentRender';
import { getStringProp, isDisabled, isVisible } from './flowState';
import { flowStyleToNativeStyle } from './flowStyle';
import { FlowJsonTable } from './FlowJsonTable';
import { FlowImage } from './FlowImage';
import { FlowMarkdown } from './FlowMarkdown';
import type { BlockMarkdownVariant } from '../blockMarkdownStyle';
import { getCachedCustomEmojis, STANDARD_FLOW_EMOJIS } from './flowJsonEmoji';
import { renderFlowSpecializedComponent } from './FlowSpecializedComponent';
import { renderFlowWriteApproval } from './FlowWriteApprovalRenderer';
import { useFlowMessageAction } from './useFlowMessageAction';
import { useFlowNormalizationOptions } from './useFlowNormalizationOptions';
import { useChatRenderTokens } from '../../theme/ChatRenderProvider';

export type FlowJsonMessageBodyProps = {
  model: MessageRowModel;
  flow: FlowDefinitionLike;
  markdownStyle: MarkdownStyle;
  mine: boolean;
  onOpenUrl: (url: string) => void;
  containerStyle?: StyleProp<ViewStyle>;
  markdownVariant?: BlockMarkdownVariant;
};

const FlowJsonMessageBodyComponent = ({
  flow,
  model,
  markdownStyle,
  mine,
  onOpenUrl,
  containerStyle,
  markdownVariant,
}: FlowJsonMessageBodyProps): ReactElement => {
  const baseNormalizationOptions = useFlowNormalizationOptions();
  const tokens = useChatRenderTokens();
  const customEmojiQuery = useCustomEmojis({ enabled: true });
  const { activeFlow, isSubmitting, canPressButtons, executeAction, updateFieldValue } =
    useFlowMessageAction(flow, model);
  const stateValues = (activeFlow.state?.values ?? {}) as Record<string, unknown>;
  const flowData = (activeFlow.data ?? {}) as Record<string, unknown>;

  const normalizationOptions = useMemo<FlowTextNormalizationOptions>(
    () => ({
      ...baseNormalizationOptions,
      standardEmojis: STANDARD_FLOW_EMOJIS,
      customEmojis: getCachedCustomEmojis(customEmojiQuery.data),
    }),
    [baseNormalizationOptions, customEmojiQuery.data],
  );
  const fallbackTextColor =
    markdownVariant === 'system'
      ? tokens.systemText
      : mine
        ? tokens.rootTextUser
        : tokens.rootTextOther;
  const bodyTextColor = markdownStyle.paragraph?.color ?? fallbackTextColor;
  const mutedTextColor = markdownStyle.blockquote?.color ?? bodyTextColor;
  const inheritedContainerStyle = StyleSheet.flatten(containerStyle) ?? {};

  const renderMarkdown = (
    markdown: string,
    key: string,
    style?: StyleProp<ViewStyle>,
  ): ReactElement | null => (
    <FlowMarkdown
      key={key}
      markdown={markdown}
      inheritedContainerStyle={inheritedContainerStyle}
      style={style}
      mine={mine}
      viewerId={model.viewerId}
      onOpenUrl={onOpenUrl}
      {...(markdownVariant ? { variant: markdownVariant } : {})}
    />
  );

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
      if (
        allowListGrouping &&
        isFlowListTextComponent(component, stateValues, normalizationOptions)
      ) {
        const listComponents = [component];
        let nextIndex = index + 1;
        while (nextIndex < components.length) {
          const nextComponent = components[nextIndex];
          if (
            !nextComponent ||
            !isFlowListTextComponent(nextComponent, stateValues, normalizationOptions) ||
            !haveSameFlowStyle(component, nextComponent) ||
            isDisabled(component, stateValues) !== isDisabled(nextComponent, stateValues)
          ) {
            break;
          }
          listComponents.push(nextComponent);
          nextIndex += 1;
        }
        if (listComponents.length > 1) {
          rendered.push(
            renderMarkdown(
              flowComponentsToMarkdown(listComponents, normalizationOptions),
              `${flowComponentKey(parentKey, component, index)}-list`,
              flowComponentRenderStyle(component, stateValues),
            ),
          );
          index = nextIndex;
          continue;
        }
      }
      rendered.push(renderComponent(component, flowComponentKey(parentKey, component, index)));
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

    const specialized = renderFlowSpecializedComponent({
      component,
      componentKey: key,
      componentType: type,
      activeFlow,
      model,
      normalizationOptions,
      markdownStyle,
      inheritedContainerStyle,
      renderStyle,
      renderMarkdown,
      canPressButtons,
      isSubmitting,
      bodyTextColor,
      executeAction,
      normalizeText: text => normalizeFlowTextToMarkdown(text, normalizationOptions),
      stateValues,
      flowData,
      mutedTextColor,
      updateFieldValue,
    });
    if (specialized !== undefined) return specialized;

    if (type === 'text' || type === 'heading') {
      const baseMarkdown = flowComponentTextToMarkdown(component, normalizationOptions);
      const markdown =
        type === 'heading' && !props?.['codeBlock']
          ? `${'#'.repeat(typeof props?.['level'] === 'number' ? Math.min(4, Math.max(1, props['level'])) : 2)} ${baseMarkdown.replace(/^#+\s+/, '')}`
          : baseMarkdown;
      return renderMarkdown(markdown, key, renderStyle);
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
      return <FlowImage key={key} props={props} renderStyle={renderStyle} />;
    }

    if (type === 'divider') {
      return (
        <View
          key={key}
          style={[{ height: 1, backgroundColor: tokens.tableBorderColor }, renderStyle]}
        />
      );
    }

    if (type === 'table') {
      return (
        <FlowJsonTable
          nodeKey={key}
          props={props}
          renderStyle={renderStyle}
          normalizationOptions={normalizationOptions}
          renderMarkdown={renderMarkdown}
        />
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
                    borderColor: nativeStyle.borderColor ?? tokens.tableBorderColor,
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
    return renderMarkdown(
      flowComponentsToMarkdown([component], normalizationOptions),
      key,
      nativeStyle,
    );
  };

  const writeApproval = renderFlowWriteApproval({
    activeFlow,
    containerStyle,
    markdownStyle,
    renderMarkdown,
    canPressButtons,
    isSubmitting,
    bodyTextColor,
    executeAction,
    normalizeText: text => normalizeFlowTextToMarkdown(text, normalizationOptions),
  });
  if (writeApproval) return writeApproval;

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
