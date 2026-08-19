import React from 'react';
import {
  FormFieldType,
  type FlowPlanDecision,
  type FlowPlanGroup,
  type FlowPlanNode,
  type FlowStepGate,
} from '@xyne/shared';
import { GitFork, X } from 'lucide-react';
import { getFieldTypeLabel } from '../../../utils/board/formFieldApiMapper';
import { Button } from '../../ui/Button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';

const UNSELECTED_VALUE = '__unselected__';

export interface EligibleDecisionField {
  id: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum: unknown;
}

interface FlowDecisionConfigPanelProps {
  decision: FlowPlanDecision;
  source: FlowPlanNode;
  fieldsLoaded: boolean;
  eligibleFields: EligibleDecisionField[];
  nodes: FlowPlanNode[];
  groups: FlowPlanGroup[];
  onChooseField: (fieldId: string) => void;
  onUpdate: (patch: Partial<FlowPlanDecision>) => void;
  onSetRouteTarget: (routeKey: string, targetId: string) => void;
  onCreateTarget: (routeKey: string, kind: FlowStepGate['type'] | 'group') => void;
  onClose: () => void;
}

export const FlowDecisionConfigPanel: React.FC<FlowDecisionConfigPanelProps> = ({
  decision,
  source,
  fieldsLoaded,
  eligibleFields,
  nodes,
  groups,
  onChooseField,
  onUpdate,
  onSetRouteTarget,
  onCreateTarget,
  onClose,
}) => {
  const sourceGroupId = source.groupId ?? null;
  const sourceGroup = sourceGroupId ? groups.find(group => group.id === sourceGroupId) : undefined;
  const availableNodes = nodes.filter(node => {
    if (node.id === source.id || (node.groupId ?? null) !== sourceGroupId) return false;
    return node.parentIds.length === 0 || node.parentIds.includes(decision.id);
  });
  const availableGroups = groups.filter(
    group =>
      (group.groupId ?? null) === sourceGroupId &&
      (group.parentIds.length === 0 || group.parentIds.includes(decision.id)),
  );

  return (
    <aside className='w-[380px] flex-shrink-0 h-full border-l border-border bg-muted/40 flex flex-col overflow-y-auto'>
      <div className='flex items-center justify-between border-b border-border bg-[hsl(var(--flow-decision-bg))] px-4 py-3'>
        <span className='flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--flow-decision-fg))]'>
          <GitFork size={13} /> Configure decision
        </span>
        <button
          type='button'
          onClick={onClose}
          data-track-category='flow_plan_editor'
          data-track-name='close_decision_config'
          className='rounded-md p-1.5 text-muted-foreground hover:bg-muted'
        >
          <X size={13} />
        </button>
      </div>
      <div className='flex flex-col gap-4 px-4 py-4'>
        <div>
          <label
            htmlFor='flow-decision-field'
            className='mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground'
          >
            Required form field
          </label>
          <Select
            value={decision.fieldId}
            onValueChange={fieldId => onChooseField(fieldId === UNSELECTED_VALUE ? '' : fieldId)}
          >
            <SelectTrigger
              id='flow-decision-field'
              data-track-category='flow_plan_editor'
              data-track-name='select_decision_field'
              className='w-full bg-background text-[12px] text-foreground'
            >
              <SelectValue placeholder='Choose a field…' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSELECTED_VALUE} className='text-[12px] text-muted-foreground'>
                Choose a field…
              </SelectItem>
              {eligibleFields.map(field => (
                <SelectItem key={field.id} value={field.id} className='text-[12px]'>
                  {field.fieldName} · {getFieldTypeLabel(field.fieldType)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {eligibleFields.length === 0 && fieldsLoaded && (
            <p className='mt-2 text-[11px] leading-4 text-muted-foreground'>
              This form has no required text, boolean, or single-select fields.
            </p>
          )}
        </div>

        {decision.fieldId && decision.fieldType === 'STRING' && (
          <div className='grid grid-cols-[130px_1fr] gap-2'>
            <Select
              value={decision.operator ?? 'equals'}
              onValueChange={operator => onUpdate({ operator: operator as 'equals' | 'notEquals' })}
            >
              <SelectTrigger
                data-track-category='flow_plan_editor'
                data-track-name='select_decision_operator'
                className='w-full bg-background text-[12px]'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='equals' className='text-[12px]'>
                  Equals
                </SelectItem>
                <SelectItem value='notEquals' className='text-[12px]'>
                  Does not equal
                </SelectItem>
              </SelectContent>
            </Select>
            <input
              type='text'
              value={decision.comparisonValue ?? ''}
              onChange={event => onUpdate({ comparisonValue: event.target.value })}
              data-track-category='flow_plan_editor'
              data-track-name='input_decision_comparison'
              placeholder='Comparison text'
              className='rounded-lg border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-amber-500'
            />
          </div>
        )}

        {decision.fieldId && (
          <div className='border-t border-border pt-4'>
            <p className='mb-2 text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground'>
              Outcome routes
            </p>
            <div className='flex flex-col gap-2'>
              {decision.routes.map(route => {
                return (
                  <div
                    key={route.key}
                    className='rounded-lg border border-border bg-background p-2.5'
                  >
                    <div className='mb-2 flex items-center justify-between gap-2'>
                      <span className='truncate text-[11px] font-semibold text-foreground'>
                        {route.label}
                      </span>
                      {!route.targetId && (
                        <span className='text-[9px] font-medium uppercase text-amber-600'>
                          Needs a target
                        </span>
                      )}
                    </div>
                    <Select
                      value={route.targetId}
                      onValueChange={targetId =>
                        onSetRouteTarget(route.key, targetId === UNSELECTED_VALUE ? '' : targetId)
                      }
                    >
                      <SelectTrigger
                        size='sm'
                        data-track-category='flow_plan_editor'
                        data-track-name='select_decision_target'
                        className='w-full bg-background text-[11px]'
                      >
                        <SelectValue placeholder='Choose next step…' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          value={UNSELECTED_VALUE}
                          className='text-[11px] text-muted-foreground'
                        >
                          Choose next step…
                        </SelectItem>
                        {availableNodes.map(node => (
                          <SelectItem key={node.id} value={node.id} className='text-[11px]'>
                            {node.title}
                          </SelectItem>
                        ))}
                        {availableGroups.map(group => (
                          <SelectItem key={group.id} value={group.id} className='text-[11px]'>
                            {group.name} (group)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!route.targetId && (
                      <div className='mt-2 flex flex-wrap gap-1.5'>
                        <button
                          type='button'
                          onClick={() => onCreateTarget(route.key, 'confirmation')}
                          data-track-category='flow_plan_editor'
                          data-track-name='create_decision_confirmation_target'
                          className='rounded-md border border-dashed border-amber-300 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-50'
                        >
                          + Confirmation step
                        </button>
                        <button
                          type='button'
                          onClick={() => onCreateTarget(route.key, 'form')}
                          data-track-category='flow_plan_editor'
                          data-track-name='create_decision_form_target'
                          className='rounded-md border border-dashed border-amber-300 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-50'
                        >
                          + Form step
                        </button>
                        {(!sourceGroupId || !sourceGroup?.groupId) && (
                          <button
                            type='button'
                            onClick={() => onCreateTarget(route.key, 'group')}
                            data-track-category='flow_plan_editor'
                            data-track-name='create_decision_group_target'
                            className='rounded-md border border-dashed border-amber-300 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-50'
                          >
                            + Group
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div className='sticky bottom-0 mt-auto border-t border-border bg-background px-4 py-3'>
        <Button
          size='sm'
          className='w-full bg-amber-600 text-white hover:bg-amber-700'
          onClick={onClose}
        >
          Done
        </Button>
      </div>
    </aside>
  );
};
