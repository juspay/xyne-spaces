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
} from './FlowCard';

type RenderMarkdown = (
  markdown: string,
  key: string,
  style?: StyleProp<ViewStyle>,
) => ReactElement | null;

const toSteps = (todos: readonly PlanTodoViewModel[]): FlowCardStep[] =>
  todos.map(todo => ({ id: todo.id, status: todo.displayStatus }));

export const FlowPlanCard = memo(function FlowPlanCard({
  component,
  normalizationOptions,
  markdownStyle,
  renderMarkdown,
  containerStyle,
}: {
  component: FlowComponentLike;
  normalizationOptions: FlowTextNormalizationOptions;
  markdownStyle: MarkdownStyle;
  renderMarkdown: RenderMarkdown;
  containerStyle?: StyleProp<ViewStyle>;
}): ReactElement | null {
  const stepColors = useFlowCardStepColors();
  const viewModel = getPlanComponentViewModel(component, normalizationOptions);
  if (!viewModel) return null;

  const titleStyle = {
    fontSize: markdownStyle.paragraph?.fontSize ?? 16,
    lineHeight: markdownStyle.paragraph?.lineHeight ?? 20,
  };
  const todoById = new Map(viewModel.todos.map(todo => [todo.id, todo]));
  const hasBodyBelowHeader = viewModel.description.trim().length > 0 || viewModel.totalCount > 0;

  return (
    <FlowCardBody containerStyle={containerStyle}>
      <FlowCardHeader
        title={viewModel.title}
        statusLabel={viewModel.statusLabel}
        statusTone={viewModel.statusTone}
        titleStyle={titleStyle}
        {...(hasBodyBelowHeader ? { containerStyle: { marginBottom: 6 } } : {})}
      />
      {viewModel.description.trim()
        ? renderMarkdown(viewModel.description, 'plan-description')
        : null}
      <FlowCardProgress
        completedCount={viewModel.completedCount}
        totalCount={viewModel.totalCount}
      />
      <FlowCardStepList
        steps={toSteps(viewModel.todos)}
        colors={stepColors}
        renderStepContent={step => {
          const todo = todoById.get(step.id);
          return todo ? renderMarkdown(todo.text, `plan-todo-${todo.id}`) : null;
        }}
      />
    </FlowCardBody>
  );
});
FlowPlanCard.displayName = 'FlowPlanCard';
