import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GitBranch,
  MoreVertical,
  Pencil,
  Trash2,
} from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Popover } from '../../../ui/Popover/Popover';
import { Dialog } from '../../../ui/Dialog/Dialog';
import { Button } from '../../../ui/Button/Button';
import type { AutomationStepConfig, Condition, ValidationIssue } from '../../Automation.types';
import { ConditionEditor } from '../ConditionEditor/ConditionEditor';
import {
  summarizeCondition,
  hasInvalidTagCondition,
} from '../ConditionEditor/ConditionEditor.utils';
import { BranchSteps } from '../BranchSteps/BranchSteps';
import type { ConditionalCardProps } from './ConditionalCard.types';

export function ConditionalCard({
  step,
  catalog,
  schemaCache,
  schemaLoadingFor,
  operators,
  variableSources,
  index,
  total,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
  issues,
  pathPrefix,
  readOnly = false,
  ensureSchema,
  renderConditionalCard,
  renderSwitchCard,
}: ConditionalCardProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftCondition, setDraftCondition] = useState<Condition>(step.config.condition);
  const [tagConditionError, setTagConditionError] = useState<string | null>(null);
  useEffect(() => {
    if (editorOpen) setDraftCondition(step.config.condition);
  }, [editorOpen, step.config.condition]);

  const conditionSummary = summarizeCondition(step.config.condition);
  const conditionUnset =
    conditionSummary === 'Click to set a condition' || conditionSummary === 'Condition';

  const updateBranch = (branch: 'if_true' | 'if_false', next: AutomationStepConfig[]): void => {
    onChange({
      ...step,
      config: {
        ...step.config,
        [branch]: next,
      },
    });
  };

  const issuesUnder = (prefix: string): ValidationIssue[] =>
    issues.filter(i => i.path.startsWith(prefix));

  return (
    <div
      data-slot='automation-conditional-card'
      className='flex flex-col gap-4 rounded-md border border-border bg-background p-5'
    >
      <div className='flex items-start justify-between gap-3'>
        <button
          type='button'
          className='flex flex-1 items-start gap-3 text-left'
          onClick={() => setCollapsed(prev => !prev)}
          data-track-category='automation-builder'
          data-track-name='conditional-toggle-collapse'
        >
          <div className='flex size-8 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400'>
            <GitBranch className='size-4' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
              Step {index} · control
            </span>
            <span className='text-sm font-medium text-foreground'>If / Else</span>
            <span className='mt-1 text-xs text-muted-foreground'>
              Branch the run based on a condition.
            </span>
          </div>
          <div className='ml-auto pt-1 text-muted-foreground'>
            {collapsed ? <ChevronRight className='size-4' /> : <ChevronDown className='size-4' />}
          </div>
        </button>

        <div className='flex items-center gap-1'>
          <button
            type='button'
            onClick={onMoveUp}
            disabled={index === 1}
            aria-label='Move up'
            data-track-category='automation-builder'
            data-track-name='conditional-move-up'
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
              index === 1
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:text-foreground hover:bg-accent/40',
            )}
          >
            <ArrowUp className='size-4' />
          </button>
          <button
            type='button'
            onClick={onMoveDown}
            disabled={index === total}
            aria-label='Move down'
            data-track-category='automation-builder'
            data-track-name='conditional-move-down'
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
              index === total
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:text-foreground hover:bg-accent/40',
            )}
          >
            <ArrowDown className='size-4' />
          </button>
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            align='end'
            side='bottom'
            sideOffset={4}
            className='w-[160px] rounded-md p-1'
            trigger={
              <button
                type='button'
                aria-label='Step actions'
                className='flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40'
              >
                <MoreVertical className='size-4' />
              </button>
            }
          >
            <button
              type='button'
              onClick={() => {
                onDelete();
                setMenuOpen(false);
              }}
              data-track-category='automation-builder'
              data-track-name='conditional-delete'
              className='flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-500/10'
            >
              <Trash2 className='size-4' />
              Delete step
            </button>
          </Popover>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className='flex flex-col gap-2 border-t border-border pt-4'>
            <div className='flex items-center justify-between gap-3'>
              <span className='text-xs font-medium text-foreground'>Condition</span>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setEditorOpen(true)}
                data-track-category='automation-builder'
                data-track-name='conditional-open-editor'
                className='gap-1.5'
              >
                <Pencil className='size-3.5' />
                {conditionUnset ? 'Set condition' : 'Edit condition'}
              </Button>
            </div>
            <button
              type='button'
              onClick={() => setEditorOpen(true)}
              data-track-category='automation-builder'
              data-track-name='conditional-open-editor'
              className={cn(
                'rounded-md border px-3 py-2 text-left text-xs',
                conditionUnset
                  ? 'border-dashed border-border text-muted-foreground hover:bg-accent/30'
                  : 'border-border bg-accent/20 text-foreground font-mono hover:bg-accent/40',
              )}
            >
              {conditionSummary}
            </button>
          </div>

          <Dialog
            open={editorOpen}
            onOpenChange={setEditorOpen}
            title='Edit condition'
            description='Combine variables and operators to gate the next branch. Use AND/OR groups to nest.'
            className='sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden border border-border'
          >
            <div className='flex max-h-[85vh] flex-col'>
              <div className='flex flex-col gap-1 border-b border-border px-5 py-4'>
                <h3 className='text-base font-semibold text-foreground'>Edit condition</h3>
                <p className='text-xs text-muted-foreground'>
                  Pick a variable, choose an operator, and set the value to compare against. Use AND
                  / OR to nest multiple checks.
                </p>
              </div>
              <div className='flex-1 overflow-y-auto px-5 py-4'>
                <ConditionEditor
                  value={draftCondition}
                  onChange={setDraftCondition}
                  operators={operators}
                  variableSources={variableSources}
                />
              </div>
              <div className='flex flex-col gap-2 border-t border-border bg-background px-5 py-3'>
                {tagConditionError && <p className='text-xs text-red-500'>{tagConditionError}</p>}
                <div className='flex justify-end gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      setTagConditionError(null);
                      setEditorOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size='sm'
                    onClick={() => {
                      if (hasInvalidTagCondition(draftCondition)) {
                        setTagConditionError(
                          'One or more tag conditions are invalid — a category must be selected and at least one tag must be added.',
                        );
                        return;
                      }
                      setTagConditionError(null);
                      onChange({
                        ...step,
                        config: { ...step.config, condition: draftCondition },
                      });
                      setEditorOpen(false);
                    }}
                  >
                    Save condition
                  </Button>
                </div>
              </div>
            </div>
          </Dialog>

          <div className='flex gap-4 overflow-x-auto pb-2'>
            <BranchSteps
              label='If true'
              accent='green'
              steps={step.config.if_true ?? []}
              catalog={catalog}
              schemaCache={schemaCache}
              schemaLoadingFor={schemaLoadingFor}
              operators={operators}
              variableSources={variableSources}
              onChange={next => updateBranch('if_true', next)}
              ensureSchema={ensureSchema}
              issues={issuesUnder(`${pathPrefix}.config.if_true`)}
              pathPrefix={`${pathPrefix}.config.if_true`}
              readOnly={readOnly}
              renderConditionalCard={renderConditionalCard}
              renderSwitchCard={renderSwitchCard}
            />
            <BranchSteps
              label='Else'
              accent='red'
              steps={step.config.if_false ?? []}
              catalog={catalog}
              schemaCache={schemaCache}
              schemaLoadingFor={schemaLoadingFor}
              operators={operators}
              variableSources={variableSources}
              onChange={next => updateBranch('if_false', next)}
              ensureSchema={ensureSchema}
              issues={issuesUnder(`${pathPrefix}.config.if_false`)}
              pathPrefix={`${pathPrefix}.config.if_false`}
              readOnly={readOnly}
              renderConditionalCard={renderConditionalCard}
              renderSwitchCard={renderSwitchCard}
            />
          </div>
        </>
      )}
    </div>
  );
}
