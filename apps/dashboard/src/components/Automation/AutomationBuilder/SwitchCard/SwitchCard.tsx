import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ListTree,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Popover } from '../../../ui/Popover/Popover';
import { Dialog } from '../../../ui/Dialog/Dialog';
import { Button } from '../../../ui/Button/Button';
import type {
  AutomationStepConfig,
  Condition,
  SwitchCaseEntry,
  ValidationIssue,
} from '../../Automation.types';
import { ConditionEditor } from '../ConditionEditor/ConditionEditor';
import {
  summarizeCondition,
  hasInvalidTagCondition,
} from '../ConditionEditor/ConditionEditor.utils';
import { BranchSteps } from '../BranchSteps/BranchSteps';
import type { SwitchCardProps } from './SwitchCard.types';

export function SwitchCard({
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
}: SwitchCardProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingCaseIndex, setEditingCaseIndex] = useState<number | null>(null);
  const [tagConditionError, setTagConditionError] = useState<string | null>(null);
  const [draftCondition, setDraftCondition] = useState<Condition>({
    variable: '',
    operator: 'eq',
    value: '',
  });

  useEffect(() => {
    if (editingCaseIndex !== null) {
      const caseEntry = step.config.cases[editingCaseIndex];
      if (caseEntry) setDraftCondition(caseEntry.condition);
    }
  }, [editingCaseIndex, step.config.cases]);

  const handleAddCase = (): void => {
    const newCase: SwitchCaseEntry = {
      condition: { variable: '', operator: 'eq', value: '' },
      steps: [],
    };
    onChange({
      ...step,
      config: {
        ...step.config,
        cases: [...step.config.cases, newCase],
      },
    });
  };

  const handleRemoveCase = (caseIndex: number): void => {
    onChange({
      ...step,
      config: {
        ...step.config,
        cases: step.config.cases.filter((_, i) => i !== caseIndex),
      },
    });
  };

  const handleCaseConditionSave = (): void => {
    if (editingCaseIndex === null) return;
    if (hasInvalidTagCondition(draftCondition)) {
      setTagConditionError(
        'One or more tag conditions are invalid — a category must be selected and at least one tag must be added.',
      );
      return;
    }
    setTagConditionError(null);
    const cases = step.config.cases.slice();
    const existing = cases[editingCaseIndex];
    if (!existing) return;
    cases[editingCaseIndex] = { ...existing, condition: draftCondition };
    onChange({ ...step, config: { ...step.config, cases } });
    setEditingCaseIndex(null);
  };

  const handleCaseBranchChange = (caseIndex: number, steps: AutomationStepConfig[]): void => {
    const cases = step.config.cases.slice();
    const existing = cases[caseIndex];
    if (!existing) return;
    cases[caseIndex] = { ...existing, steps };
    onChange({ ...step, config: { ...step.config, cases } });
  };

  const handleDefaultChange = (steps: AutomationStepConfig[]): void => {
    onChange({ ...step, config: { ...step.config, default: steps } });
  };

  const issuesUnder = (prefix: string): ValidationIssue[] =>
    issues.filter(i => i.path.startsWith(prefix));

  return (
    <div
      data-slot='automation-switch-card'
      className='flex flex-col gap-4 rounded-md border border-border bg-background p-5'
    >
      {/* Header */}
      <div className='flex items-start justify-between gap-3'>
        <button
          type='button'
          className='flex flex-1 items-start gap-3 text-left'
          onClick={() => setCollapsed(prev => !prev)}
          data-track-category='automation-builder'
          data-track-name='switch-toggle-collapse'
        >
          <div className='flex size-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400'>
            <ListTree className='size-4' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
              Step {index} · control
            </span>
            <span className='text-sm font-medium text-foreground'>Switch / Case</span>
            <span className='mt-1 text-xs text-muted-foreground'>
              Evaluate conditions top-to-bottom, run the first matching case or default.
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
            data-track-name='switch-move-up'
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
            data-track-name='switch-move-down'
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
              data-track-name='switch-delete'
              className='flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-500/10'
            >
              <Trash2 className='size-4' />
              Delete step
            </button>
          </Popover>
        </div>
      </div>

      {!collapsed && (
        <div className='flex flex-col gap-3 border-t border-border pt-4'>
          <div className='flex gap-4 overflow-x-auto pb-2'>
            {step.config.cases.map((caseEntry, caseIndex) => {
              const caseSummary = summarizeCondition(caseEntry.condition);
              const caseConditionUnset =
                caseSummary === 'Click to set a condition' || caseSummary === 'Condition';

              return (
                <div
                  key={caseIndex}
                  className='w-[320px] min-w-[320px] flex-shrink-0 flex flex-col gap-2'
                >
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-xs font-medium text-foreground'>
                      {caseEntry.label || `Case ${caseIndex + 1}`}
                    </span>
                    <div className='flex items-center gap-1'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setEditingCaseIndex(caseIndex)}
                        data-track-category='automation-builder'
                        data-track-name='switch-open-case-editor'
                        className='gap-1 h-7 text-xs'
                      >
                        <Pencil className='size-3' />
                        {caseConditionUnset ? 'Set' : 'Edit'}
                      </Button>
                      <button
                        type='button'
                        onClick={() => handleRemoveCase(caseIndex)}
                        aria-label={`Remove case ${caseIndex + 1}`}
                        data-track-category='automation-builder'
                        data-track-name='switch-remove-case'
                        className='flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-500/10'
                      >
                        <X className='size-3.5' />
                      </button>
                    </div>
                  </div>
                  <button
                    type='button'
                    onClick={() => setEditingCaseIndex(caseIndex)}
                    data-track-category='automation-builder'
                    data-track-name='switch-open-case-editor'
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-left text-xs truncate',
                      caseConditionUnset
                        ? 'border-dashed border-border text-muted-foreground hover:bg-accent/30'
                        : 'border-border bg-accent/20 text-foreground font-mono hover:bg-accent/40',
                    )}
                  >
                    {caseSummary}
                  </button>
                  <BranchSteps
                    label={`Case ${caseIndex + 1} steps`}
                    accent='blue'
                    steps={caseEntry.steps}
                    catalog={catalog}
                    schemaCache={schemaCache}
                    schemaLoadingFor={schemaLoadingFor}
                    operators={operators}
                    variableSources={variableSources}
                    onChange={next => handleCaseBranchChange(caseIndex, next)}
                    ensureSchema={ensureSchema}
                    issues={issuesUnder(`${pathPrefix}.config.cases[${caseIndex}].steps`)}
                    pathPrefix={`${pathPrefix}.config.cases[${caseIndex}].steps`}
                    readOnly={readOnly}
                    renderConditionalCard={renderConditionalCard}
                    renderSwitchCard={renderSwitchCard}
                  />
                </div>
              );
            })}

            {/* Default branch */}
            <div className='w-[320px] min-w-[320px] flex-shrink-0 flex flex-col gap-2'>
              <div className='flex min-h-7 items-center'>
                <span className='text-xs font-medium text-foreground'>Default</span>
              </div>
              <div className='rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground'>
                Runs when no case matches
              </div>
              <BranchSteps
                label='Default steps'
                accent='gray'
                steps={step.config.default}
                catalog={catalog}
                schemaCache={schemaCache}
                schemaLoadingFor={schemaLoadingFor}
                operators={operators}
                variableSources={variableSources}
                onChange={handleDefaultChange}
                ensureSchema={ensureSchema}
                issues={issuesUnder(`${pathPrefix}.config.default`)}
                pathPrefix={`${pathPrefix}.config.default`}
                readOnly={readOnly}
                renderConditionalCard={renderConditionalCard}
                renderSwitchCard={renderSwitchCard}
              />
            </div>
          </div>

          {/* Add case button */}
          <Button
            variant='outline'
            size='sm'
            onClick={handleAddCase}
            className='gap-1.5 self-start'
            data-track-category='automation-builder'
            data-track-name='switch-add-case'
          >
            <Plus className='size-3.5' />
            Add case
          </Button>
        </div>
      )}

      {/* Condition editor dialog for cases */}
      <Dialog
        open={editingCaseIndex !== null}
        onOpenChange={open => {
          if (!open) setEditingCaseIndex(null);
        }}
        title='Edit case condition'
        description='Define when this case should match.'
        className='sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden border border-border'
      >
        <div className='flex max-h-[85vh] flex-col'>
          <div className='flex flex-col gap-1 border-b border-border px-5 py-4'>
            <h3 className='text-base font-semibold text-foreground'>Edit case condition</h3>
            <p className='text-xs text-muted-foreground'>
              Pick a variable, choose an operator, and set the value. Use AND / OR to compose
              multiple checks.
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
                  setEditingCaseIndex(null);
                }}
                data-track-category='automation-builder'
                data-track-name='CANCEL_SWITCH_CASE'
              >
                Cancel
              </Button>
              <Button
                size='sm'
                onClick={handleCaseConditionSave}
                data-track-category='automation-builder'
                data-track-name='SAVE_SWITCH_CASE'
              >
                Save condition
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
