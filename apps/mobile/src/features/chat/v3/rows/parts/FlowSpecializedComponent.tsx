import { type ReactElement, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { implicitActionsForComponent, parseFlowAction } from '@/src/utils/flowAction';
import { createAgentCardViewModel } from '@/src/utils/flowAgentUtils';
import { codeComponentToMarkdown } from '@/src/utils/flowCodeUtils';
import { createMcpSuggestViewModel } from '@/src/utils/flowMcpSuggestUtils';
import { createCallScheduleViewModel } from '@/src/utils/flowCallScheduleUtils';
import { createPrCardViewModel } from '@/src/utils/flowPrUtils';
import { createUserQuestionViewModel } from '@/src/utils/flowUserQuestionUtils';
import { showMessageToast } from '@/src/utils/toast';
import {
  type FlowComponentLike,
  type FlowDefinitionLike,
  type FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

import type { MessageRowModel } from '../../model/chatRow.types';
import { renderFlowActionButton } from './FlowActionButtonRenderer';
import { FlowAgentCard } from './FlowAgentCard';
import { FlowCallScheduleCard } from './FlowCallScheduleCard';
import { FlowChartCard } from './FlowChartCard';
import { FlowDiffCard } from './FlowDiffCard';
import { FlowJsonControl } from './FlowJsonControl';
import { FlowJsonActionButtonRow, FlowJsonSubmitButton } from './FlowJsonSubmitButton';
import { FlowMcpSuggestCard } from './FlowMcpSuggestCard';
import { FlowPlanCard } from './FlowPlanCard';
import { FlowPrCard } from './FlowPrCard';
import { FlowUserQuestionCard } from './FlowUserQuestionCard';
import type { FlowActionContext, RenderMarkdown } from './FlowRendererTypes';
import { getStringProp, isDisabled, stripMarkdownSyntax } from './flowState';

type SpecializedComponentContext = FlowActionContext & {
  component: FlowComponentLike;
  componentKey: string;
  componentType: string;
  activeFlow: FlowDefinitionLike;
  model: MessageRowModel;
  normalizationOptions: FlowTextNormalizationOptions;
  markdownStyle: MarkdownStyle;
  inheritedContainerStyle: StyleProp<ViewStyle>;
  renderStyle: StyleProp<ViewStyle>;
  renderMarkdown: RenderMarkdown;
  stateValues: Record<string, unknown>;
  flowData: Record<string, unknown>;
  mutedTextColor: string;
  updateFieldValue: (name: string, value: unknown) => void;
};

const CARD_WRAPPER_STYLE: ViewStyle = {
  alignSelf: 'stretch',
  minWidth: 0,
  width: '100%',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const renderImplicitActions = (
  component: FlowComponentLike,
  componentKey: string,
  context: FlowActionContext,
): ReactElement | null => {
  const buttons = implicitActionsForComponent(component, componentKey);
  if (buttons.length === 0) return null;
  return (
    <FlowJsonActionButtonRow
      buttons={buttons}
      canPressButtons={context.canPressButtons}
      isSubmitting={context.isSubmitting}
      bodyTextColor={context.bodyTextColor}
      executeAction={context.executeAction}
    />
  );
};

export const renderFlowSpecializedComponent = (
  context: SpecializedComponentContext,
): ReactNode | undefined => {
  const {
    component,
    componentKey,
    componentType,
    activeFlow,
    model,
    normalizationOptions,
    markdownStyle,
    inheritedContainerStyle,
    renderStyle,
    renderMarkdown,
    stateValues,
    flowData,
    mutedTextColor,
    updateFieldValue,
  } = context;

  if (componentType === 'diff') {
    return (
      <View key={componentKey} style={[CARD_WRAPPER_STYLE, renderStyle]}>
        <FlowDiffCard
          component={component}
          containerStyle={inheritedContainerStyle}
          recyclingKey={`${model.conversationId}:${componentKey}`}
        />
      </View>
    );
  }

  if (componentType === 'code') {
    const markdown = codeComponentToMarkdown(component, normalizationOptions);
    return markdown ? renderMarkdown(markdown, componentKey, renderStyle) : null;
  }

  if (componentType === 'pr') {
    return createPrCardViewModel(component) ? (
      <View key={componentKey} style={[CARD_WRAPPER_STYLE, renderStyle]}>
        <FlowPrCard
          component={component}
          containerStyle={inheritedContainerStyle}
          recyclingKey={`${model.conversationId}:${componentKey}`}
          renderMarkdown={(markdown, childKey) => renderMarkdown(markdown, childKey)}
        />
      </View>
    ) : null;
  }

  if (componentType === 'plan') {
    return (
      <View key={componentKey} style={[CARD_WRAPPER_STYLE, renderStyle]}>
        <FlowPlanCard
          component={component}
          normalizationOptions={normalizationOptions}
          markdownStyle={markdownStyle}
          containerStyle={inheritedContainerStyle}
          renderMarkdown={renderMarkdown}
        />
        {renderImplicitActions(component, componentKey, context)}
      </View>
    );
  }

  if (componentType === 'agent') {
    const viewModel = createAgentCardViewModel(component, activeFlow, context.normalizeText, {
      currentUserId: model.viewerId,
    });
    if (!viewModel) return null;
    const buttons = viewModel.showActions
      ? implicitActionsForComponent(component, componentKey)
      : [];
    return (
      <View key={componentKey} style={[CARD_WRAPPER_STYLE, renderStyle]}>
        <FlowAgentCard
          viewModel={viewModel}
          titleStyle={{
            fontSize: markdownStyle.paragraph?.fontSize,
            lineHeight: markdownStyle.paragraph?.lineHeight,
          }}
          containerStyle={inheritedContainerStyle}
          buttons={buttons}
          renderMarkdown={(markdown, childKey) => renderMarkdown(markdown, childKey)}
          renderButton={button => renderFlowActionButton(button, context)}
        />
      </View>
    );
  }

  if (componentType === 'mcp_suggest') {
    return createMcpSuggestViewModel(component) ? (
      <View key={componentKey} style={[CARD_WRAPPER_STYLE, renderStyle]}>
        <FlowMcpSuggestCard
          component={component}
          containerStyle={inheritedContainerStyle}
          recyclingKey={`${model.conversationId}:${componentKey}`}
        />
      </View>
    ) : null;
  }

  if (componentType === 'chart') {
    return (
      <View key={componentKey} style={[CARD_WRAPPER_STYLE, renderStyle]}>
        <FlowChartCard
          component={component}
          containerStyle={inheritedContainerStyle}
          recyclingKey={`${model.conversationId}:${componentKey}`}
        />
      </View>
    );
  }

  if (componentType === 'call_schedule') {
    const viewModel = createCallScheduleViewModel(component);
    if (!viewModel) return null;
    return (
      <View key={componentKey} style={[CARD_WRAPPER_STYLE, renderStyle]}>
        <FlowCallScheduleCard
          component={component}
          containerStyle={inheritedContainerStyle}
          canInteract={context.canPressButtons}
          isSubmitting={context.isSubmitting}
          selectionValue={stateValues[viewModel.componentId]}
          onSelectionChange={selection => updateFieldValue(viewModel.componentId, selection)}
          onApprove={selection => {
            updateFieldValue(viewModel.componentId, selection);
            void context.executeAction({ type: 'submit', actionId: 'schedule-approve' });
          }}
        />
      </View>
    );
  }

  if (componentType === 'user_question') {
    const viewModel = createUserQuestionViewModel(component, activeFlow, {
      currentUserId: model.viewerId,
    });
    if (!viewModel) return null;

    const answers = isRecord(stateValues['answers'])
      ? (stateValues['answers'] as Record<string, string | string[]>)
      : {};
    const notes = isRecord(stateValues['notes'])
      ? Object.fromEntries(
          Object.entries(stateValues['notes']).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
    return (
      <View key={componentKey} style={[CARD_WRAPPER_STYLE, renderStyle]}>
        <FlowUserQuestionCard
          viewModel={viewModel}
          titleStyle={{
            fontSize: markdownStyle.paragraph?.fontSize,
            lineHeight: markdownStyle.paragraph?.lineHeight,
          }}
          containerStyle={inheritedContainerStyle}
          recyclingKey={`${model.conversationId}:${componentKey}`}
          canInteract={context.canPressButtons && viewModel.showActions}
          isSubmitting={context.isSubmitting}
          answers={answers}
          notes={notes}
          onAnswersChange={next => updateFieldValue('answers', next)}
          onNotesChange={next => updateFieldValue('notes', next)}
          onSubmit={() => {
            if (viewModel.submitAction) void context.executeAction(viewModel.submitAction);
          }}
          onValidationError={message => showMessageToast(message, 'error')}
        />
      </View>
    );
  }

  if (componentType === 'button') {
    const label = stripMarkdownSyntax(
      context.normalizeText(
        getStringProp(component.props, 'label') ||
          getStringProp(component.props, 'name') ||
          'Button',
      ),
    );
    const action = parseFlowAction(component.props);
    const live = context.canPressButtons && action !== null;
    return (
      <FlowJsonSubmitButton
        key={componentKey}
        label={label}
        variant={getStringProp(component.props, 'variant') || 'secondary'}
        live={live}
        disabled={isDisabled(component, stateValues) || context.isSubmitting}
        submitting={context.isSubmitting}
        bodyTextColor={context.bodyTextColor}
        style={renderStyle}
        {...(live && action ? { onPress: () => void context.executeAction(action) } : {})}
      />
    );
  }

  if (
    componentType === 'input' ||
    componentType === 'textarea' ||
    componentType === 'dropdown' ||
    componentType === 'select' ||
    componentType === 'multiselect' ||
    componentType === 'date'
  ) {
    return (
      <FlowJsonControl
        type={componentType}
        nodeKey={componentKey}
        props={component.props}
        renderStyle={renderStyle}
        normalizationOptions={normalizationOptions}
        stateValues={stateValues}
        flowData={flowData}
        canPressButtons={context.canPressButtons}
        isSubmitting={context.isSubmitting}
        bodyTextColor={context.bodyTextColor}
        mutedTextColor={mutedTextColor}
        updateFieldValue={updateFieldValue}
        executeAction={context.executeAction}
      />
    );
  }

  return undefined;
};
