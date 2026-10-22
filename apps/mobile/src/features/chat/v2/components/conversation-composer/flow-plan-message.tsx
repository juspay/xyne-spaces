import { memo, type ReactElement } from 'react';
import type { MarkdownStyle } from 'react-native-enriched-markdown';
import type { StyleProp, ViewStyle } from 'react-native';

import {
  getPlanComponentViewModel,
  type FlowComponentLike,
  type FlowTextNormalizationOptions,
  type PlanTodoViewModel,
} from '@/src/utils/flowJsonMarkdown';

import {
  FlowCardBody,
  FlowCardHeader,
  FlowCardProgress,
  FlowCardStepList,
  useFlowCardStepColors,
  type FlowCardStep,
} from './flow-card';
import { PARAGRAPH_LINE_HEIGHT } from './utils/markdownStyle';
import { RichInlineText } from './rich-inline-text';
import { canRenderInlineRich } from './utils/parseInlineRich';

type FlowPlanMessageProps = {
  component: FlowComponentLike;
  normalizationOptions: FlowTextNormalizationOptions;
  markdownStyle: MarkdownStyle;
  containerStyle?: StyleProp<ViewStyle>;
  renderMarkdown: (
    markdown: string,
    key: string,
    style?: StyleProp<ViewStyle>,
  ) => ReactElement | null;
  renderNestedMarkdown?: (markdown: string, key: string) => ReactElement | null;
  onLinkPress?: (url: string) => void;
  currentUserId?: string;
  isOwnMessage?: boolean;
  selectable?: boolean;
};

const toFlowCardSteps = (todos: PlanTodoViewModel[]): FlowCardStep[] =>
  todos.map(todo => ({
    id: todo.id,
    status: todo.displayStatus,
  }));

const FlowPlanMessageComponent = ({
  component,
  normalizationOptions,
  markdownStyle,
  renderMarkdown,
  renderNestedMarkdown,
  onLinkPress,
  currentUserId,
  isOwnMessage = false,
  selectable = false,
}: FlowPlanMessageProps): ReactElement | null => {
  const stepColors = useFlowCardStepColors();
  const viewModel = getPlanComponentViewModel(component, normalizationOptions);
  if (!viewModel) return null;

  const titleStyle = {
    fontSize: markdownStyle.paragraph?.fontSize ?? 16,
    lineHeight: markdownStyle.paragraph?.lineHeight ?? PARAGRAPH_LINE_HEIGHT,
  };

  const renderTodoText = (todo: PlanTodoViewModel): ReactElement | null => {
    if (canRenderInlineRich(todo.text)) {
      return (
        <RichInlineText
          markdown={todo.text}
          markdownStyle={markdownStyle}
          isOwnMessage={isOwnMessage}
          selectable={selectable}
          {...(onLinkPress ? { onLinkPress: ({ url }) => onLinkPress(url) } : {})}
          {...(currentUserId ? { currentUserId } : {})}
        />
      );
    }

    return (
      renderNestedMarkdown?.(todo.text, `plan-todo-${todo.id}`) ??
      renderMarkdown(todo.text, `plan-todo-${todo.id}`)
    );
  };

  const todoById = new Map(viewModel.todos.map(todo => [todo.id, todo]));
  const hasBodyBelowHeader = viewModel.description.trim().length > 0 || viewModel.totalCount > 0;

  return (
    <FlowCardBody>
      <FlowCardHeader
        title={viewModel.title}
        statusLabel={viewModel.statusLabel}
        statusTone={viewModel.statusTone}
        titleStyle={titleStyle}
        {...(hasBodyBelowHeader ? { containerStyle: { marginBottom: 6 } } : {})}
      />

      {viewModel.description.trim()
        ? (renderNestedMarkdown?.(viewModel.description, 'plan-description') ??
          renderMarkdown(viewModel.description, 'plan-description'))
        : null}

      <FlowCardProgress
        completedCount={viewModel.completedCount}
        totalCount={viewModel.totalCount}
      />

      <FlowCardStepList
        steps={toFlowCardSteps(viewModel.todos)}
        colors={stepColors}
        renderStepContent={step => {
          const todo = todoById.get(step.id);
          return todo ? renderTodoText(todo) : null;
        }}
      />
    </FlowCardBody>
  );
};

const FlowPlanMessage = memo(FlowPlanMessageComponent);
FlowPlanMessage.displayName = 'FlowPlanMessage';

export { FlowPlanMessage };
