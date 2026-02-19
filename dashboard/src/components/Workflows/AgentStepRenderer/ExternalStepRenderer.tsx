import React, { useState, useCallback, useMemo } from 'react';
import { WorkflowStep } from '../../../services/Workflow/workflowGraphService.types';
import ApprovalDialog from '../../Tickets/TicketDetails/ApprovalDialog';
import { useApprovalSubmit } from '../../../services/Workflow/useApprovalSubmit';
import type { PendingHumanInterventionStep } from '@xyne/shared';

/**
 * Renders the external INPUT step.
 * - When waiting (no output step yet): shows the amber "Respond" card + dialog.
 * - When completed (output step exists) or just submitted: shows a green "Answered" header.
 *   The actual answer values are rendered by ExternalStepOutputRenderer on the output step.
 */
export const ExternalStepApprovalRenderer: React.FC<{ step: WorkflowStep }> = ({ step }) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [submittedResponse, setSubmittedResponse] = useState<Record<string, unknown> | null>(null);
  const { submitResponse, isSubmitting } = useApprovalSubmit();

  const parsedData = useMemo(() => {
    if (!step.data) return null;
    if (typeof step.data === 'string') {
      try {
        return JSON.parse(step.data) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return step.data;
  }, [step.data]);

  const externalMetadata = parsedData?.['externalMetadata'] as
    | {
        type?: string;
        title?: string;
        responseSchema?: PendingHumanInterventionStep['responseSchema'];
      }
    | undefined;

  const rawMeta = parsedData?.['externalMetadata'] as Record<string, unknown> | undefined;
  const responseSchema = (externalMetadata?.responseSchema ??
    rawMeta?.['response_schema'] ??
    null) as PendingHumanInterventionStep['responseSchema'];

  const pendingStep: PendingHumanInterventionStep = {
    id: step.id,
    stepName: step.stepName || '',
    title: externalMetadata?.title || 'Approval Required',
    responseSchema,
    workflowExecutionId: step.workflowExecutionId || '',
    createdAt: step.createdAt,
  };

  const isAnswered = submittedResponse !== null || step.computedStatus === 'completed';

  const handleSubmit = useCallback(
    async (response: Record<string, unknown>) => {
      await submitResponse({ workflowStepId: step.id, response });
      setSubmittedResponse(response);
      setIsDialogOpen(false);
    },
    [step.id, submitResponse],
  );

  // Extract question texts from the input step data for inline rendering
  const questions = useMemo(() => {
    const questionData = parsedData?.['args'] as unknown[];
    const firstArg = questionData?.[0] as
      | { questions?: { header?: string; question: string }[] }
      | undefined;
    return firstArg?.questions || [];
  }, [parsedData]);

  if (submittedResponse && step.computedStatus !== 'completed') {
    return (
      <div className='p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800'>
        <p className='text-sm font-medium text-emerald-800 dark:text-emerald-200 mb-2'>Answered</p>
        {questions.length > 0 && (
          <div className='space-y-1.5'>
            {questions.map((q, idx) => {
              const key = `question_${idx}`;
              const val = submittedResponse[key];
              let answerText = '—';
              if (val !== null && val !== undefined) {
                if (typeof val === 'string') {
                  answerText = val;
                } else if (typeof val === 'number' || typeof val === 'boolean') {
                  answerText = `${val}`;
                } else {
                  answerText = JSON.stringify(val);
                }
              }
              return (
                <div key={idx} className='text-sm'>
                  <span className='font-medium text-emerald-700 dark:text-emerald-300'>
                    {q.header || q.question}:
                  </span>{' '}
                  <span className='text-emerald-600 dark:text-emerald-400'>{answerText}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (isAnswered) {
    return null;
  }

  return (
    <div className='p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800'>
      <div className='flex items-center justify-between'>
        <div>
          <p className='text-sm font-medium text-amber-800 dark:text-amber-200'>
            {pendingStep.title}
          </p>
          {responseSchema?.description && (
            <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
              {responseSchema.description}
            </p>
          )}
        </div>
        <button
          onClick={() => setIsDialogOpen(true)}
          className='px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors'
        >
          Respond
        </button>
      </div>
      <ApprovalDialog
        step={pendingStep}
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

export const ExternalStepOutputRenderer: React.FC<{ step: WorkflowStep }> = ({ step }) => {
  const parsedData = useMemo(() => {
    if (!step.data) return null;
    if (typeof step.data === 'string') {
      try {
        return JSON.parse(step.data) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return step.data;
  }, [step.data]);

  const answers = parsedData?.['answers'] as string[][] | undefined;
  const questionTexts = parsedData?.['questionTexts'] as string[] | undefined;

  if (!answers || !questionTexts || questionTexts.length === 0) {
    return (
      <div className='p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800'>
        <p className='text-sm font-medium text-emerald-800 dark:text-emerald-200'>Answered</p>
      </div>
    );
  }

  return (
    <div className='p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800'>
      <p className='text-sm font-medium text-emerald-800 dark:text-emerald-200 mb-2'>Answered</p>
      <div className='space-y-1.5'>
        {questionTexts.map((question, idx) => {
          const answer = answers[idx];
          const answerText = answer ? answer.join(', ') : '—';
          return (
            <div key={idx} className='text-sm'>
              <span className='font-medium text-emerald-700 dark:text-emerald-300'>
                {question}:
              </span>{' '}
              <span className='text-emerald-600 dark:text-emerald-400'>{answerText}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
