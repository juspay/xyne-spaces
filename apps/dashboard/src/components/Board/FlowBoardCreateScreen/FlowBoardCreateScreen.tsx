import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, GitBranch } from 'lucide-react';
import {
  BoardType,
  validateFlowPlan,
  type FlowPlanDecision,
  type FlowPlanGroup,
  type FlowPlanNode,
} from '@xyne/shared';
import { Button } from '../../ui/Button';
import Input from '../../ui/Input';
import Textarea from '../../ui/Textarea';
import { apiInstance } from '../../../services/clients/apiClient';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useZero } from '../../../hooks/useZero';
import { FlowPlanEditor } from '../FlowPlanEditor/FlowPlanEditor';
import { getFlowPlanEditorIssues } from '../FlowPlanEditor/FlowPlanEditor.utils';
import { STATUS_OPTIONS } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';

export interface FlowBoardEditTarget {
  id: string;
  name: string;
  description?: string | null | undefined;
  nodes: FlowPlanNode[];
  groups: FlowPlanGroup[];
  decisions: FlowPlanDecision[];
}

interface FlowBoardCreateScreenProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  editBoard?: FlowBoardEditTarget;
  cloneBoard?: Omit<FlowBoardEditTarget, 'id'>;
}

/** Shared create/edit surface for FLOW board details and plan. */
export const FlowBoardCreateScreen: React.FC<FlowBoardCreateScreenProps> = ({
  projectId,
  isOpen,
  onClose,
  editBoard,
  cloneBoard,
}) => {
  const navigate = useNavigate();
  const zero = useZero();
  const isEdit = !!editBoard;
  const isClone = !!cloneBoard;
  const sourceBoard = editBoard ?? cloneBoard;
  const [name, setName] = useState(sourceBoard?.name ?? '');
  const [description, setDescription] = useState(sourceBoard?.description ?? '');
  const [planNodes, setPlanNodes] = useState<FlowPlanNode[]>(sourceBoard?.nodes ?? []);
  const [planGroups, setPlanGroups] = useState<FlowPlanGroup[]>(sourceBoard?.groups ?? []);
  const [planDecisions, setPlanDecisions] = useState<FlowPlanDecision[]>(
    sourceBoard?.decisions ?? [],
  );
  const [detachedStepIds, setDetachedStepIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [projectBoards] = useCachedQuery(queries.boardsListByProject({ projectId }), {
    enabled: isOpen,
  });
  const nameCollision = useMemo(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return false;
    return (projectBoards ?? []).some(
      board => board.id !== editBoard?.id && board.name.trim().toLowerCase() === trimmed,
    );
  }, [projectBoards, name, editBoard?.id]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    if (!name.trim()) {
      toast.error('Board name is required');
      return false;
    }
    if (nameCollision) {
      toast.error(`Board "${name.trim()}" already exists in this project`);
      return false;
    }
    if (planNodes.length === 0) {
      toast.error('Add at least one step to the flow');
      return false;
    }
    if (planNodes.some(node => !node.title.trim())) {
      toast.error('Every step needs a title');
      return false;
    }
    if (detachedStepIds.length > 0) {
      const firstId = detachedStepIds[0];
      const stepName =
        planNodes.find(node => node.id === firstId)?.title ??
        planGroups.find(group => group.id === firstId)?.name ??
        'A step';
      toast.error(`"${stepName}" is detached from the flow — connect it before saving`);
      return false;
    }
    const formStepMissingForm = planNodes.find(
      node => node.gate?.type === 'form' && !node.gate.formId,
    );
    if (formStepMissingForm) {
      toast.error(`Attach a form to "${formStepMissingForm.title}" or switch it to confirmation`);
      return false;
    }
    const editorIssue = getFlowPlanEditorIssues(planNodes, planGroups, planDecisions)[0];
    if (editorIssue) {
      toast.error(editorIssue.message);
      return false;
    }
    try {
      validateFlowPlan({
        version: 2,
        nodes: planNodes,
        groups: planGroups,
        decisions: planDecisions,
        updatedAt: Date.now(),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The flow plan is invalid');
      return false;
    }
    return true;
  };

  const handleCreate = async (): Promise<void> => {
    setIsSaving(true);
    try {
      const response = await apiInstance.post<{ board: { id: string } }>('/boards', {
        name: name.trim(),
        description: description.trim() || undefined,
        projectId,
        boardType: BoardType.FLOW,
        flowPlan: {
          version: 2,
          nodes: planNodes,
          groups: planGroups,
          decisions: planDecisions,
          updatedAt: Date.now(),
        },
      });
      toast.success(isClone ? 'Flow board cloned' : 'Flow board created');
      onClose();
      void navigate(`/projects/${projectId}/${response.data.board.id}`);
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to create flow board';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (board: FlowBoardEditTarget): Promise<void> => {
    setIsSaving(true);
    try {
      const planResult = zero.mutate(
        mutators.board.updateFlowPlan({
          boardId: board.id,
          plan: {
            version: 2,
            nodes: planNodes,
            groups: planGroups,
            decisions: planDecisions,
            updatedAt: Date.now(),
          },
          timestamp: Date.now(),
        }),
      );
      const planResponse = await planResult.server;
      if (planResponse?.type === 'error') {
        throw new Error(planResponse.error.message || 'Failed to save plan');
      }
      const nameChanged = name.trim() !== board.name;
      const descriptionChanged = description.trim() !== (board.description ?? '');
      if (nameChanged || descriptionChanged) {
        const boardResult = zero.mutate(
          mutators.board.update({
            boardId: board.id,
            ...(nameChanged ? { name: name.trim() } : {}),
            ...(descriptionChanged ? { description: description.trim() } : {}),
            timestamp: Date.now(),
          }),
        );
        const boardResponse = await boardResult.server;
        if (boardResponse?.type === 'error') {
          throw new Error(boardResponse.error.message || 'Failed to save board details');
        }
      }
      toast.success('Flow board updated');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save flow board');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (!validate()) return;
    if (editBoard) {
      await handleUpdate(editBoard);
    } else {
      await handleCreate();
    }
  };

  const trackCategory = isEdit ? 'flow_board' : 'flow_board_create';

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='flow-board-create-title'
        className='bg-background flex flex-col w-[96vw] h-[94vh] rounded-lg shadow-xl overflow-hidden border border-border'
      >
        <header className='flex items-center justify-between px-[18px] py-4 border-b border-border'>
          <div className='flex items-center gap-2'>
            <Button
              onClick={onClose}
              variant='ghost'
              size='iconSm'
              className='w-[16px] h-[16px] text-foreground hover:opacity-70'
              data-track-category={trackCategory}
              data-track-name='navigate_back'
            >
              <ChevronLeft size={16} />
            </Button>
            <GitBranch size={16} className='text-[#6276be]' />
            <span
              id='flow-board-create-title'
              className='text-[16px] font-semibold text-foreground'
            >
              {isEdit ? 'Edit Flow Board' : isClone ? 'Clone Flow Board' : 'Create Flow Board'}
            </span>
            {isEdit && (
              <span className='text-[13px] text-muted-foreground'>
                — changes only affect steps that have not been created yet
              </span>
            )}
          </div>
          <div className='flex items-center gap-3'>
            <Button
              variant='secondary'
              onClick={onClose}
              data-track-category={trackCategory}
              data-track-name={isEdit ? 'cancel_edit_plan' : 'cancel_flow_board'}
            >
              Cancel
            </Button>
            <Button
              className='bg-[#6276BE] hover:bg-[#5060A0] text-white'
              onClick={() => void handleSubmit()}
              disabled={isSaving || nameCollision}
              data-track-category={trackCategory}
              data-track-name={isEdit ? 'save_plan' : 'create_flow_board'}
            >
              {isSaving
                ? isEdit
                  ? 'Saving…'
                  : 'Creating…'
                : isEdit
                  ? 'Save changes'
                  : isClone
                    ? 'Clone board'
                    : 'Create board'}
            </Button>
          </div>
        </header>

        <div className='flex-1 flex overflow-hidden'>
          <div className='flex-1 min-w-0 border-r border-border bg-muted/20'>
            <FlowPlanEditor
              planNodes={planNodes}
              onChange={setPlanNodes}
              groups={planGroups}
              onGroupsChange={setPlanGroups}
              decisions={planDecisions}
              onDecisionsChange={setPlanDecisions}
              onDetachedStepsChange={setDetachedStepIds}
              showStatusLegend={false}
              projectId={projectId}
            />
          </div>

          <aside className='w-[320px] flex-shrink-0 flex flex-col gap-5 p-6 overflow-y-auto'>
            <div>
              <h2 className='text-[15px] font-semibold text-foreground'>Board details</h2>
              <p className='text-[12px] text-muted-foreground mt-1 leading-[18px]'>
                Design the step plan once — every run instantiates it as tickets, top to bottom.
              </p>
            </div>

            <div className='flex flex-col gap-1.5'>
              <label htmlFor='flow-board-name' className='text-[13px] font-medium text-foreground'>
                Board name
              </label>
              <Input
                id='flow-board-name'
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder='e.g. Customer Onboarding'
                data-track-category={trackCategory}
                data-track-name='input_board_name'
                aria-invalid={nameCollision || undefined}
                className='text-[13px]'
              />
              {nameCollision && (
                <p className='text-[11px] text-red-500'>
                  A board named “{name.trim()}” already exists in this project.
                </p>
              )}
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='flow-board-description'
                className='text-[13px] font-medium text-foreground'
              >
                Description
              </label>
              <Textarea
                id='flow-board-description'
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder='Optional'
                rows={3}
                data-track-category={trackCategory}
                data-track-name='input_board_description'
                className='text-[13px]'
              />
            </div>

            <div className='border-t border-border pt-4'>
              <p className='text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
                Ticket stages (fixed)
              </p>
              <div className='flex flex-col gap-2'>
                {STATUS_OPTIONS.map(option => (
                  <span
                    key={option.status}
                    className='flex items-center gap-2 text-[12px] text-foreground'
                  >
                    {option.icon}
                    {option.label}
                  </span>
                ))}
              </div>
              <p className='text-[11px] text-muted-foreground mt-3 leading-[16px]'>
                Flow tickets use these five real, system-managed stages. Eligible steps are created
                in “To Do”, then move automatically through “Started” to “Paused” while waiting for
                confirmation or a form.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
