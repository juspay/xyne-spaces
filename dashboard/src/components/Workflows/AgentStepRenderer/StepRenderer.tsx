import React from 'react';
import { Accordion, AccordionItem, AccordionType } from '@juspay/blend-design-system';
import { WorkflowStep } from '../../../services/Workflow/workflowGraphService.types';
import { LLMCallRenderer } from './LLMCallRenderer';
import { ToolLsRenderer } from './ToolLsRenderer';
import { ToolReadRenderer } from './ToolReadRenderer';
import { ToolWriteRenderer } from './ToolWriteRenderer';
import { ToolTodoWriteRenderer } from './ToolTodoWriteRenderer';
import { ToolEditRenderer } from './ToolEditRenderer';
import { ToolGlobRenderer } from './ToolGlobRenderer';
import { ToolGrepRenderer } from './ToolGrepRenderer';
import { ToolBashRenderer } from './ToolBashRenderer';
import { ToolMultiEditRenderer } from './ToolMultiEditRenderer';
import { UserMessageRenderer } from './UserMessageRenderer';
import { ToolErrorRenderer } from './ToolErrorRenderer';
import { formatStepData } from '../utils/utils';
import { FinalResultRenderer } from './FinalResultRenderer';

interface AgentStepRendererProps {
  step: WorkflowStep;
  defaultOpen?: boolean;
}

export const AgentStepRenderer: React.FC<AgentStepRendererProps> = ({
  step,
  defaultOpen = true,
}) => {
  if (!step?.stepName) return null;

  if (step.stepName === 'final_result' && !step.data?.['gitInfo']) {
    return null;
  }

  const stepRenderers: Record<string, () => React.JSX.Element> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    llm_call: () => <LLMCallRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_ls: () => <ToolLsRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_read: () => <ToolReadRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_write: () => <ToolWriteRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'tool_todo-write': () => <ToolTodoWriteRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_edit: () => <ToolEditRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_glob: () => <ToolGlobRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_grep: () => <ToolGrepRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_bash: () => <ToolBashRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_multiedit: () => <ToolMultiEditRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    user_message: () => <UserMessageRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    assistant_message: () => <LLMCallRenderer data={step.data} />,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    final_result: () => <FinalResultRenderer data={step.data?.['gitInfo']} />,
  };

  const stepTypeMap: Record<string, string> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    llm_call_: 'llm_call',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_ls: 'tool_ls',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_read: 'tool_read',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_write: 'tool_write',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'tool_todo-write': 'tool_todo-write',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_edit: 'tool_edit',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_glob: 'tool_glob',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_grep: 'tool_grep',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_bash: 'tool_bash',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tool_multiedit: 'tool_multiedit',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    user_message: 'user_message',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    assistant_message: 'assistant_message',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    final_result: 'final_result',
  };

  const stepName = step.stepName.toLowerCase();
  // console.log('stepName', JSON.parse(JSON.stringify(stepName)), stepName);

  const matchedType = Object.entries(stepTypeMap).find(([pattern]) =>
    stepName.startsWith(pattern),
  )?.[1];

  const renderer = matchedType ? stepRenderers[matchedType] : undefined;

  const content = renderer ? (
    renderer()
  ) : (
    <pre className='bg-gray-50 p-2 rounded text-xs scroll-safe max-h-48 overflow-safe w-full text-wrap'>
      <code className='text-wrap'>{formatStepData(step.data)}</code>
    </pre>
  );

  const accordionProps: {
    accordionType: typeof AccordionType.BORDER;
    isMultiple: false;
    defaultValue?: string;
  } = {
    accordionType: AccordionType.BORDER,
    isMultiple: false,
  };

  if (defaultOpen) {
    accordionProps.defaultValue = step.id;
  }

  // early return for some steps to avoid rendering the accordion
  if (step.stepName === 'tool_todo-write') return <ToolTodoWriteRenderer data={step.data} />;
  if (step.stepName === 'tool_read') return <ToolReadRenderer data={step.data} />;
  if (step.stepName === 'tool_grep') return <ToolGrepRenderer data={step.data} />;
  if (step.stepName === 'tool_ls') return <ToolLsRenderer data={step.data} />;
  if (step.stepName === 'llm_call' || step.stepName.startsWith('llm_call_'))
    return <LLMCallRenderer data={step.data} />;
  if (step.stepName === 'tool_bash') return <ToolBashRenderer data={step.data} />;
  if (step.stepName === 'user_message') return <UserMessageRenderer data={step.data} />;
  if (step.stepName === 'assistant_message') return <LLMCallRenderer data={step.data} />;
  if (step.stepName === 'framework_error') return <ToolErrorRenderer data={step.data} />;
  // tool_edit, tool_write, tool_multiedit go through Accordion wrapper below

  return (
    <div className='overflow-safe w-full word-break-safe' data-step-name={step.stepName}>
      <Accordion {...accordionProps}>
        <AccordionItem
          value={step.id}
          title={step.stepName ?? 'Unknown Step'}
          subtext={`Status: ${step.status ?? 'unknown'}`}
        >
          <div className='p-2 overflow-safe w-full word-break-safe'>{content}</div>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default AgentStepRenderer;
