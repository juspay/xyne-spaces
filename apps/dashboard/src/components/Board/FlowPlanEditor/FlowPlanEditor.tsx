import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  MiniMap,
  Panel,
  SelectionMode,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Plus, LayoutGrid, FileText, UserCheck, SquareDashedMousePointer, X } from 'lucide-react';
import {
  FormContextType,
  FormEntityType,
  FormFieldType,
  type FlowPlanGroup,
  type FlowPlanDecision,
  type FlowPlanNode,
  type FlowStepGate,
} from '@xyne/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { STATUS_OPTIONS } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import { cn } from '../../../utils/classNames';
import { formService } from '../../../services/Form/formService';
import {
  mapFormDetailsToBuilderFields,
  mapFormFieldsToApiPayload,
} from '../../../utils/board/formFieldApiMapper';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { getFlowPlanEditorIssues, VIRTUAL_ROOT_ID, CARD_WIDTH } from './FlowPlanEditor.utils';
import { FlowPlanEdge } from './FlowPlanEdge';
import { FlowDecisionConfigPanel } from './FlowDecisionConfigPanel';
import { disconnectDecisionTargets, reassignDecisionRoute } from './flowDecisionMutations';
import {
  createGroupFromSelection,
  groupIsWithin,
  moveGroupToContainer,
  moveStepToContainer,
  reorderSiblingEntities,
  ungroupFlowGroup,
  type CreateGroupReason,
} from './flowGroupMutations';
import {
  addLink,
  coverId,
  isCoverId,
  memberGroupOf,
  parentsInState,
  planIdOf,
  removeLink,
  resolveParentChild,
  withParents,
  withoutStaleDecisionParents,
  type PlanState,
} from './flowPlanGraph';
import {
  DEFAULT_GATE,
  FLOW_PLAN_NODE_TYPES,
  gateOf,
  type AddStepKind,
  type EditorNodeData,
} from './FlowPlanNodes';
import { useFlowPlanEdges } from './useFlowPlanEdges';
import { useBuildFlowPlanNodes } from './useBuildFlowPlanNodes';
import {
  FlowStepConfigPanel,
  type ConfirmationGate,
  type FormBuilderData,
  type FormGate,
} from './FlowStepConfigPanel';

export { gateOf } from './FlowPlanNodes';

const STEP_CARD_HEIGHT = 170;

const groupSelectionError = (reason: CreateGroupReason): string => {
  switch (reason) {
    case 'empty':
      return 'Draw a box around at least one step or group';
    case 'mixed-scope':
      return 'Select items from the same group level';
    case 'entry-parents':
      return 'The first selected row must have the same immediate parent or parents';
    case 'not-contiguous':
      return 'Select one complete section grown from the same first row';
    case 'decision-incomplete':
      return 'Include the form, decision, and every immediate decision path';
    case 'depth':
      return 'That selection would nest flow groups more than one level deep';
    case 'cycle':
      return 'Grouping that selection would create a circular flow';
    case 'mixed-detached':
      return 'Connect the loose steps before grouping them with starting steps';
  }
};

const EDGE_TYPES = { flowPlan: FlowPlanEdge };

export interface FlowPlanEditorProps {
  planNodes: FlowPlanNode[];
  onChange: (nodes: FlowPlanNode[]) => void;
  groups?: FlowPlanGroup[];
  onGroupsChange?: (groups: FlowPlanGroup[]) => void;
  decisions?: FlowPlanDecision[];
  onDecisionsChange?: (decisions: FlowPlanDecision[]) => void;
  /** Steps/groups deliberately unwired from the flow (no implicit main-ticket
      edge). Hosts should block saving while any exist. */
  onDetachedStepsChange?: (stepIds: string[]) => void;
  readOnly?: boolean;
  showStatusLegend?: boolean;
  projectId?: string;
}

/** Design-time editor for the FLOW plan DAG and nested group sub-flows. */
export const FlowPlanEditor: React.FC<FlowPlanEditorProps> = ({
  planNodes,
  onChange,
  groups = [],
  onGroupsChange,
  decisions = [],
  onDecisionsChange,
  onDetachedStepsChange,
  readOnly = false,
  showStatusLegend = true,
  projectId,
}) => {
  const planNodesRef = useRef(planNodes);
  planNodesRef.current = planNodes;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;
  const editorIssues = useMemo(
    () => getFlowPlanEditorIssues(planNodes, groups, decisions),
    [planNodes, groups, decisions],
  );
  const validationWarningById = useMemo(() => {
    const warnings = new Map<string, string>();
    for (const issue of editorIssues) {
      for (const nodeId of issue.nodeIds) {
        if (!warnings.has(nodeId)) warnings.set(nodeId, issue.message);
      }
    }
    return warnings;
  }, [editorIssues]);

  const currentState = useCallback(
    (): PlanState => ({ nodes: planNodesRef.current, groups: groupsRef.current }),
    [],
  );
  const commit = useCallback(
    (state: PlanState) => {
      if (state.nodes !== planNodesRef.current) onChange(state.nodes);
      if (state.groups !== groupsRef.current) onGroupsChange?.(state.groups);
    },
    [onChange, onGroupsChange],
  );

  // Steps/groups the user unwired on purpose (air-dropped their last edge).
  // Without this, a parentless entity silently snaps back to the main ticket.
  const [detachedIds, setDetachedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Reconnected or deleted entities stop being detached. Grouped steps are
    // never detached — parentless members are the group's entry row.
    setDetachedIds(prev => {
      if (prev.size === 0) return prev;
      const next = new Set(
        [...prev].filter(id => {
          const step = planNodes.find(node => node.id === id);
          if (step) return step.parentIds.length === 0 && !step.groupId;
          const group = groups.find(candidate => candidate.id === id);
          return !!group && group.parentIds.length === 0 && !group.groupId;
        }),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [planNodes, groups]);
  useEffect(() => {
    onDetachedStepsChange?.([...detachedIds]);
  }, [detachedIds, onDetachedStepsChange]);

  // Older drafts can retain a Decision id after its route was reassigned or
  // its form field was changed. That invisible parent caused both the odd
  // layout and the UUID-heavy save error. Remove only stale Decision parents;
  // if this leaves an outer item parentless, keep it visibly detached so the
  // user can decide where it belongs.
  useEffect(() => {
    const decisionById = new Map(decisions.map(decision => [decision.id, decision]));
    const staleParentIdsOf = (targetId: string, parentIds: string[]): string[] =>
      parentIds.filter(parentId => {
        const decision = decisionById.get(parentId);
        return !!decision && !decision.routes.some(route => route.targetId === targetId);
      });
    const staleNodeIds = planNodes
      .filter(node => !node.groupId && staleParentIdsOf(node.id, node.parentIds).length > 0)
      .map(node => node.id);
    const staleGroupIds = groups
      .filter(group => staleParentIdsOf(group.id, group.parentIds).length > 0)
      .map(group => group.id);
    if (staleNodeIds.length === 0 && staleGroupIds.length === 0) return;

    const staleNodeSet = new Set(staleNodeIds);
    const staleGroupSet = new Set(staleGroupIds);
    const nextNodes = planNodes.map(node =>
      staleNodeSet.has(node.id)
        ? {
            ...node,
            parentIds: node.parentIds.filter(
              parentId => !staleParentIdsOf(node.id, [parentId]).length,
            ),
          }
        : node,
    );
    const nextGroups = groups.map(group =>
      staleGroupSet.has(group.id)
        ? {
            ...group,
            parentIds: group.parentIds.filter(
              parentId => !staleParentIdsOf(group.id, [parentId]).length,
            ),
          }
        : group,
    );
    onChange(nextNodes);
    onGroupsChange?.(nextGroups);
    setDetachedIds(previous => {
      const next = new Set(previous);
      for (const node of nextNodes) {
        if (staleNodeSet.has(node.id) && !node.groupId && node.parentIds.length === 0) {
          next.add(node.id);
        }
      }
      for (const group of nextGroups) {
        if (staleGroupSet.has(group.id) && group.parentIds.length === 0 && !group.groupId) {
          next.add(group.id);
        }
      }
      return next;
    });
  }, [decisions, groups, onChange, onGroupsChange, planNodes]);

  const [configNodeId, setConfigNodeId] = useState<string | null>(null);
  const [configDecisionId, setConfigDecisionId] = useState<string | null>(null);
  const [draftGateType, setDraftGateType] = useState<FlowStepGate['type']>('confirmation');
  const [draftConfirmationGate, setDraftConfirmationGate] = useState<ConfirmationGate>({
    type: 'confirmation',
  });
  const [draftFormGate, setDraftFormGate] = useState<FormGate>({ type: 'form', formId: '' });
  const [draftAssignedTo, setDraftAssignedTo] = useState<string | null>(null);
  const [formBuilderMode, setFormBuilderMode] = useState<'create' | 'edit' | null>(null);
  const [editingFormData, setEditingFormData] = useState<FormBuilderData | null>(null);
  const [createdForms, setCreatedForms] = useState<Array<{ id: string; formName: string }>>([]);

  const [allForms] = useCachedQuery(queries.getAllFormsList(), { enabled: !readOnly });
  const formOptions = useMemo(() => {
    const synced = (allForms ?? []).map(form => ({ id: form.id, formName: form.formName }));
    const syncedIds = new Set(synced.map(form => form.id));
    // Freshly created forms may not have synced yet — surface them immediately
    return [...synced, ...createdForms.filter(form => !syncedIds.has(form.id))];
  }, [allForms, createdForms]);
  const formNameById = useMemo(
    () => new Map(formOptions.map(form => [form.id, form.formName])),
    [formOptions],
  );

  const configDecision = useMemo(
    () => decisions.find(decision => decision.id === configDecisionId) ?? null,
    [decisions, configDecisionId],
  );
  const decisionSource = configDecision
    ? (planNodes.find(node => node.id === configDecision.parentNodeId) ?? null)
    : null;
  const decisionFormId =
    decisionSource && gateOf(decisionSource).type === 'form'
      ? (gateOf(decisionSource) as FormGate).formId
      : '';
  const [decisionFieldRows] = useCachedQuery(
    queries.getFormFieldsByFormId({ formId: decisionFormId }),
    { enabled: !!decisionFormId && !readOnly },
  );
  const eligibleDecisionFields = useMemo(
    () =>
      (decisionFieldRows ?? []).flatMap(row => {
        const fieldName = row.globalField?.fieldName ?? row.fieldName;
        const fieldType = row.globalField?.fieldType ?? row.fieldType;
        const fieldEnum = row.globalField?.fieldEnum ?? row.fieldEnum;
        if (
          row.isOptional ||
          !fieldName ||
          (fieldType !== FormFieldType.STRING &&
            fieldType !== FormFieldType.BOOLEAN &&
            fieldType !== FormFieldType.SINGLE_SELECT)
        ) {
          return [];
        }
        return [{ id: row.id, fieldName, fieldType, fieldEnum }];
      }),
    [decisionFieldRows],
  );

  const updateDecision = useCallback(
    (decisionId: string, patch: Partial<FlowPlanDecision>) => {
      onDecisionsChange?.(
        decisionsRef.current.map(decision => {
          if (decision.id !== decisionId) return decision;
          const next = { ...decision, ...patch };
          if (next.fieldType !== 'STRING') {
            delete next.operator;
            delete next.comparisonValue;
          }
          return next;
        }),
      );
    },
    [onDecisionsChange],
  );

  const chooseDecisionField = useCallback(
    (fieldId: string) => {
      if (!configDecision) return;
      const field = eligibleDecisionFields.find(candidate => candidate.id === fieldId);
      if (!field) return;
      const disconnected = disconnectDecisionTargets(
        {
          nodes: planNodesRef.current,
          groups: groupsRef.current,
          decisions: decisionsRef.current,
          detachedIds,
        },
        configDecision.id,
      );
      onChange(disconnected.nodes);
      onGroupsChange?.(disconnected.groups);
      setDetachedIds(disconnected.detachedIds);
      const emptyTarget = '';
      const routes =
        field.fieldType === FormFieldType.STRING
          ? [
              { key: 'match', label: 'Match', targetId: emptyTarget },
              { key: 'otherwise', label: 'Otherwise', targetId: emptyTarget },
            ]
          : field.fieldType === FormFieldType.BOOLEAN
            ? [
                { key: 'yes', label: 'Yes', targetId: emptyTarget },
                { key: 'no', label: 'No', targetId: emptyTarget },
              ]
            : [
                ...(Array.isArray(field.fieldEnum) ? (field.fieldEnum as string[]) : []).map(
                  (value, index) => ({
                    key: `option:${index}`,
                    label: value,
                    value,
                    targetId: emptyTarget,
                  }),
                ),
                { key: 'otherwise', label: 'Otherwise', targetId: emptyTarget },
              ];
      updateDecision(configDecision.id, {
        fieldId: field.id,
        fieldName: field.fieldName,
        fieldType: field.fieldType,
        routes,
        ...(field.fieldType === FormFieldType.STRING
          ? { operator: 'equals', comparisonValue: '' }
          : {}),
      });
    },
    [configDecision, detachedIds, eligibleDecisionFields, onChange, onGroupsChange, updateDecision],
  );

  const setDecisionRouteTarget = useCallback(
    (decisionId: string, routeKey: string, targetId: string) => {
      const decision = decisionsRef.current.find(candidate => candidate.id === decisionId);
      const source = decision
        ? planNodesRef.current.find(node => node.id === decision.parentNodeId)
        : null;
      if (!decision || !source) return;
      const targetNode = planNodesRef.current.find(node => node.id === targetId);
      const targetGroup = groupsRef.current.find(group => group.id === targetId);
      if (!targetNode && !targetGroup) return;
      const targetScopeId = targetNode?.groupId ?? targetGroup?.groupId ?? null;
      if (targetScopeId !== (source.groupId ?? null)) {
        toast.error('Decision routes must stay in the same group scope');
        return;
      }
      const result = reassignDecisionRoute(
        {
          nodes: planNodesRef.current,
          groups: groupsRef.current,
          decisions: decisionsRef.current,
          detachedIds,
        },
        decisionId,
        routeKey,
        targetId,
      );
      onChange(result.nodes);
      onGroupsChange?.(result.groups);
      onDecisionsChange?.(result.decisions);
      setDetachedIds(result.detachedIds);
    },
    [detachedIds, onChange, onDecisionsChange, onGroupsChange],
  );

  const createDecisionTarget = useCallback(
    (decisionId: string, routeKey: string, kind: FlowStepGate['type'] | 'group') => {
      const decision = decisionsRef.current.find(candidate => candidate.id === decisionId);
      const source = decision
        ? planNodesRef.current.find(node => node.id === decision.parentNodeId)
        : null;
      if (!decision || !source) return;
      if (kind === 'group') {
        const sourceGroup = source.groupId
          ? groupsRef.current.find(group => group.id === source.groupId)
          : undefined;
        if (sourceGroup?.groupId) return;
        const groupId = uuidv4();
        const memberId = uuidv4();
        onGroupsChange?.([
          ...groupsRef.current,
          {
            id: groupId,
            name: `Group ${groupsRef.current.length + 1}`,
            parentIds: [decisionId],
            order: Math.max(
              0,
              decision.routes.findIndex(route => route.key === routeKey),
            ),
            ...(sourceGroup && { groupId: sourceGroup.id }),
          },
        ]);
        onChange([
          ...planNodesRef.current,
          {
            id: memberId,
            title: `Step ${planNodesRef.current.length + 1}`,
            parentIds: [],
            order: 0,
            gate: { type: 'confirmation' },
            groupId,
          },
        ]);
        updateDecision(decisionId, {
          routes: decision.routes.map(route =>
            route.key === routeKey ? { ...route, targetId: groupId } : route,
          ),
        });
        return;
      }
      const targetId = uuidv4();
      onChange([
        ...planNodesRef.current,
        {
          id: targetId,
          title: `Step ${planNodesRef.current.length + 1}`,
          parentIds: [decisionId],
          order: planNodesRef.current.length,
          gate: kind === 'form' ? { type: 'form', formId: '' } : { type: 'confirmation' },
          ...(source.groupId && { groupId: source.groupId }),
        },
      ]);
      updateDecision(decisionId, {
        routes: decision.routes.map(route =>
          route.key === routeKey ? { ...route, targetId } : route,
        ),
      });
    },
    [onChange, onGroupsChange, updateDecision],
  );

  const addStep = useCallback(
    (parentId: string | null, kind: AddStepKind) => {
      const current = planNodesRef.current;
      const parent = parentId ? (current.find(n => n.id === parentId) ?? null) : null;

      if (kind === 'decision') {
        if (!parent || gateOf(parent).type !== 'form') return;
        const hasDecision = decisionsRef.current.some(
          decision => decision.parentNodeId === parent.id,
        );
        const hasChild = current.some(node => node.parentIds.includes(parent.id));
        const hasGroupChild = groupsRef.current.some(group => group.parentIds.includes(parent.id));
        if (hasDecision || hasChild || hasGroupChild) {
          toast.error('A decision must be the only continuation after its form step');
          return;
        }
        const decision: FlowPlanDecision = {
          id: uuidv4(),
          parentNodeId: parent.id,
          fieldId: '',
          fieldName: '',
          fieldType: 'STRING',
          operator: 'equals',
          comparisonValue: '',
          routes: [],
        };
        onDecisionsChange?.([...decisionsRef.current, decision]);
        setConfigNodeId(null);
        setConfigDecisionId(decision.id);
        return;
      }

      if (kind === 'group') {
        const containingGroup = parent?.groupId
          ? groupsRef.current.find(group => group.id === parent.groupId)
          : undefined;
        if (containingGroup?.groupId) {
          toast.error('Flow groups can only be nested one level deep');
          return;
        }
        const newGroupId = uuidv4();
        onGroupsChange?.([
          ...groupsRef.current,
          {
            id: newGroupId,
            name: `Group ${groupsRef.current.length + 1}`,
            parentIds: parentId ? [parentId] : [],
            order: current.length + groupsRef.current.length,
            ...(containingGroup && { groupId: containingGroup.id }),
          },
        ]);
        onChange([
          ...current,
          {
            id: uuidv4(),
            title: `Step ${current.length + 1}`,
            parentIds: [],
            order: 0,
            gate: { type: 'confirmation' },
            groupId: newGroupId,
          },
        ]);
        return;
      }

      const parentIds = parentId ? [parentId] : [];
      const siblings = current.filter(n =>
        parentId ? n.parentIds.includes(parentId) : n.parentIds.length === 0,
      );
      const nextOrder = siblings.reduce((max, n) => Math.max(max, n.order), -1) + 1;
      const id = uuidv4();
      const groupId = parent?.groupId ?? null;
      onChange([
        ...current,
        {
          id,
          title: `Step ${current.length + 1}`,
          parentIds,
          order: nextOrder,
          gate: kind === 'form' ? { type: 'form', formId: '' } : { type: 'confirmation' },
          ...(groupId && { groupId }),
        },
      ]);
      if (kind === 'form') setConfigNodeId(id);
    },
    [onChange, onGroupsChange, onDecisionsChange],
  );

  const addDetachedNode = useCallback(
    (kind: FlowStepGate['type']) => {
      const current = planNodesRef.current;
      const id = uuidv4();
      const order =
        [...current.filter(node => !node.groupId).map(node => node.order), -1].reduce(
          (max, candidate) => Math.max(max, candidate),
          -1,
        ) + 1;
      onChange([
        ...current,
        {
          id,
          title: `Step ${current.length + 1}`,
          parentIds: [],
          order,
          gate: kind === 'form' ? { type: 'form', formId: '' } : { type: 'confirmation' },
        },
      ]);
      setDetachedIds(previous => new Set(previous).add(id));
      setConfigDecisionId(null);
      if (kind === 'form') setConfigNodeId(id);
    },
    [onChange],
  );

  const updateStep = useCallback(
    (id: string, patch: Partial<FlowPlanNode>) => {
      onChange(planNodesRef.current.map(n => (n.id === id ? { ...n, ...patch } : n)));
    },
    [onChange],
  );

  const closeFormBuilder = useCallback(() => {
    setFormBuilderMode(null);
    setEditingFormData(null);
  }, []);

  const handleCreateForm = useCallback(
    async (formData: FormBuilderData): Promise<void> => {
      if (!configNodeId) return;
      try {
        const created = await formService.createForm({
          formName: formData.formName,
          formDescription: formData.formDescription,
          contextType: FormContextType.BOARD,
          entityType: FormEntityType.TICKET,
          ...(projectId && { projectId }),
          fields: mapFormFieldsToApiPayload(formData.fields),
        });
        setCreatedForms(prev => [...prev, { id: created.id, formName: created.formName }]);
        setDraftFormGate({ type: 'form', formId: created.id });
        closeFormBuilder();
        toast.success('Form created and attached');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to create form');
      }
    },
    [closeFormBuilder, configNodeId, projectId],
  );

  // Deleting a step splices the graph: whatever depended on it inherits its
  // parents (same scope by construction — members reference members, outside
  // entities reference outside steps).
  const deleteStep = useCallback(
    (id: string) => {
      const current = currentState();
      const removed = current.nodes.find(n => n.id === id);
      if (!removed) return;
      if (
        removed.groupId &&
        current.nodes.filter(node => node.groupId === removed.groupId).length === 1 &&
        !current.groups.some(group => group.groupId === removed.groupId) &&
        decisionsRef.current.some(decision =>
          decision.routes.some(route => route.targetId === removed.groupId),
        )
      ) {
        toast.error('A decision route still points to this group');
        return;
      }
      const removedDecisionIds = new Set(
        decisionsRef.current
          .filter(decision => decision.parentNodeId === id)
          .map(decision => decision.id),
      );
      setConfigNodeId(prev => (prev === id ? null : prev));
      const splice = (parentIds: string[]): string[] => {
        if (!parentIds.includes(id)) return parentIds;
        return [
          ...parentIds.filter(parentId => parentId !== id),
          ...removed.parentIds.filter(parentId => !parentIds.includes(parentId)),
        ];
      };
      commit({
        nodes: current.nodes
          .filter(n => n.id !== id)
          .map(n => {
            const withoutRemovedDecision = n.parentIds.filter(
              parentId => !removedDecisionIds.has(parentId),
            );
            const inherited =
              withoutRemovedDecision.length !== n.parentIds.length
                ? [...new Set([...withoutRemovedDecision, ...removed.parentIds])]
                : withoutRemovedDecision;
            return inherited.includes(id)
              ? { ...n, parentIds: splice(inherited) }
              : { ...n, parentIds: inherited };
          }),
        groups: current.groups.map(group =>
          removedDecisionIds.size > 0 &&
          group.parentIds.some(parentId => removedDecisionIds.has(parentId))
            ? {
                ...group,
                parentIds: [
                  ...new Set([
                    ...group.parentIds.filter(parentId => !removedDecisionIds.has(parentId)),
                    ...removed.parentIds,
                  ]),
                ],
              }
            : group.parentIds.includes(id)
              ? { ...group, parentIds: splice(group.parentIds) }
              : group,
        ),
      });
      onDecisionsChange?.(
        decisionsRef.current
          .filter(decision => decision.parentNodeId !== id)
          .map(decision => ({
            ...decision,
            routes: decision.routes.map(route =>
              route.targetId === id ? { ...route, targetId: '' } : route,
            ),
          })),
      );
    },
    [commit, currentState, onDecisionsChange],
  );

  // Groups with no member steps left dissolve; anything that hung off them
  // inherits the group's parents.
  useEffect(() => {
    if (readOnly || !onGroupsChange) return;
    const used = new Set([
      ...planNodes.map(n => n.groupId).filter(Boolean),
      ...groups.map(group => group.groupId).filter(Boolean),
    ]);
    const empty = groups.filter(group => !used.has(group.id));
    if (empty.length === 0) return;
    let state: PlanState = { nodes: planNodes, groups };
    for (const group of empty) {
      const splice = (parentIds: string[]): string[] =>
        parentIds.includes(group.id)
          ? [
              ...parentIds.filter(parentId => parentId !== group.id),
              ...group.parentIds.filter(parentId => !parentIds.includes(parentId)),
            ]
          : parentIds;
      state = {
        nodes: state.nodes.map(n =>
          n.parentIds.includes(group.id) ? { ...n, parentIds: splice(n.parentIds) } : n,
        ),
        groups: state.groups
          .filter(candidate => candidate.id !== group.id)
          .map(candidate =>
            candidate.parentIds.includes(group.id)
              ? { ...candidate, parentIds: splice(candidate.parentIds) }
              : candidate,
          ),
      };
    }
    commit(state);
  }, [planNodes, groups, onGroupsChange, readOnly, commit]);

  // Ungroup: members keep their internal wiring; entry members inherit the
  // group's parents, and anything that hung off the group is rewired to the
  // group's terminal direct entities (steps or surviving child groups).
  const ungroup = useCallback(
    (groupId: string) => {
      if (
        decisionsRef.current.some(decision =>
          decision.routes.some(route => route.targetId === groupId),
        )
      ) {
        toast.error('Reassign the decision route before ungrouping this section');
        return;
      }
      const current = currentState();
      const result = ungroupFlowGroup(current, groupId, decisionsRef.current, detachedIds);
      if (!result) return;
      commit(result.state);
      setDetachedIds(result.detachedIds);
      setCollapsedGroups(prev => {
        if (!prev.has(groupId)) return prev;
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    },
    [commit, currentState, detachedIds],
  );

  const renameGroup = useCallback(
    (groupId: string, name: string) => {
      onGroupsChange?.(
        groupsRef.current.map(group => (group.id === groupId ? { ...group, name } : group)),
      );
    },
    [onGroupsChange],
  );

  // Drag-to-connect adds an extra parent (all parents must complete at
  // runtime). Cover handles stand in for their group; dragging from the main
  // ticket onto a detached entity re-attaches it.
  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (!source || !target || source === target) return;
      if (target === VIRTUAL_ROOT_ID) return;
      const sourceDecision = decisionsRef.current.find(decision => decision.id === source);
      if (sourceDecision && connection.sourceHandle) {
        setDecisionRouteTarget(sourceDecision.id, connection.sourceHandle, planIdOf(target));
        return;
      }
      if (decisionsRef.current.some(decision => decision.id === planIdOf(target))) return;
      const targetId = planIdOf(target);
      const state = withoutStaleDecisionParents(currentState(), targetId, decisionsRef.current);
      if (source === VIRTUAL_ROOT_ID) {
        // The main-ticket edge is implicit on parentless entities — connecting
        // it just clears the detached flag.
        const parents = parentsInState(state, targetId);
        if (parents !== null && parents.length === 0) {
          commit(state);
          setDetachedIds(prev => {
            if (!prev.has(targetId)) return prev;
            const next = new Set(prev);
            next.delete(targetId);
            return next;
          });
        }
        return;
      }
      // Cover entry → own member: the member starts with the group itself
      // (parallel to the other entry steps).
      if (isCoverId(source) && memberGroupOf(state, targetId) === planIdOf(source)) {
        const step = state.nodes.find(node => node.id === targetId);
        if (step && step.parentIds.length > 0) {
          commit(withParents(state, targetId, []));
        }
        return;
      }
      // Member → own cover: exit edges are derived (no dependents) — ignore.
      if (isCoverId(target) && memberGroupOf(state, planIdOf(source)) === planIdOf(target)) {
        return;
      }
      const link = resolveParentChild(connection);
      if (!link) {
        toast.error("Connect a group's bottom to another's top");
        return;
      }
      const result = addLink(state, link.parentId, link.childId);
      if (result.ok) {
        commit(result.state);
      } else if (result.reason === 'cycle') {
        toast.error('That connection would create a cycle');
      } else if (result.reason === 'cross-group') {
        toast.error('Steps inside a group only connect within it — connect the group instead');
      }
    },
    [commit, currentState, setDecisionRouteTarget],
  );

  // Dragging an edge endpoint rewires the link: dropped on another node it
  // reconnects, dropped on empty canvas it detaches. Detached entities float
  // (with a warning) until rewired — saving is blocked meanwhile.
  const edgeUpdateLanded = useRef(true);
  const onEdgeUpdateStart = useCallback(() => {
    edgeUpdateLanded.current = false;
  }, []);
  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      edgeUpdateLanded.current = true;
      const { source, target } = connection;
      if (!source || !target || source === target) return;
      if (target === VIRTUAL_ROOT_ID) return;
      if (oldEdge.source === source && oldEdge.target === target) return;

      const oldTargetId = planIdOf(oldEdge.target);
      let state = currentState();
      if (oldEdge.source !== VIRTUAL_ROOT_ID) {
        state = removeLink(state, planIdOf(oldEdge.source), oldTargetId);
      }
      state = withoutStaleDecisionParents(state, planIdOf(target), decisionsRef.current);
      if (source === VIRTUAL_ROOT_ID) {
        // Rewired onto the main ticket: entity becomes an implicit root child
        commit(state);
      } else if (isCoverId(source) && memberGroupOf(state, planIdOf(target)) === planIdOf(source)) {
        // Dropped on the cover's entry: the member starts with the group
        state = withParents(state, planIdOf(target), []);
        commit(state);
      } else if (isCoverId(target) && memberGroupOf(state, planIdOf(source)) === planIdOf(target)) {
        // Dropped on the cover's exit: only the old link goes away —
        // terminal-ness is derived from having no dependents
        commit(state);
      } else {
        const link = resolveParentChild(connection);
        if (!link) {
          toast.error("Connect a group's bottom to another's top");
          return;
        }
        const result = addLink(state, link.parentId, link.childId);
        if (!result.ok) {
          if (result.reason === 'cycle') toast.error('That connection would create a cycle');
          if (result.reason === 'cross-group') {
            toast.error('Steps inside a group only connect within it — connect the group instead');
          }
          return;
        }
        state = result.state;
        commit(state);
      }
      // Rewiring the target end can orphan the old target
      const oldTargetParents = parentsInState(state, oldTargetId);
      const oldTargetStep = state.nodes.find(n => n.id === oldTargetId);
      if (oldTargetParents?.length === 0 && !oldTargetStep?.groupId) {
        setDetachedIds(prev => new Set(prev).add(oldTargetId));
      }
    },
    [commit, currentState],
  );
  const onEdgeUpdateEnd = useCallback(
    (_event: unknown, edge: Edge) => {
      // Entry/exit edges are derived — dropping one on empty canvas is a no-op
      if (edge.sourceHandle === 'entry' || edge.targetHandle === 'exit') {
        edgeUpdateLanded.current = true;
        return;
      }
      if (!edgeUpdateLanded.current) {
        const targetId = planIdOf(edge.target);
        if (edge.source === VIRTUAL_ROOT_ID) {
          // Root edges are implicit — nothing to remove, just mark detached
          setDetachedIds(prev => new Set(prev).add(targetId));
        } else {
          const state = removeLink(currentState(), planIdOf(edge.source), targetId);
          commit(state);
          const parents = parentsInState(state, targetId);
          const step = state.nodes.find(n => n.id === targetId);
          const group = state.groups.find(candidate => candidate.id === targetId);
          if (parents?.length === 0 && (step ? !step.groupId : !!group && !group.groupId)) {
            setDetachedIds(prev => new Set(prev).add(targetId));
          }
        }
      }
      edgeUpdateLanded.current = true;
    },
    [commit, currentState],
  );

  // Deleting an edge removes that parent link; entities left parentless
  // become detached (saving is blocked until they are rewired).
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      let state = currentState();
      const affected = new Set<string>();
      for (const edge of deleted) {
        if (edge.source === VIRTUAL_ROOT_ID) continue;
        const targetId = planIdOf(edge.target);
        affected.add(targetId);
        state = removeLink(state, planIdOf(edge.source), targetId);
      }
      commit(state);
      const orphaned = [...affected].filter(id => {
        const step = state.nodes.find(n => n.id === id);
        if (step) return step.parentIds.length === 0 && !step.groupId;
        const group = state.groups.find(candidate => candidate.id === id);
        return !!group && group.parentIds.length === 0 && !group.groupId;
      });
      if (orphaned.length > 0) {
        setDetachedIds(prev => {
          const next = new Set(prev);
          orphaned.forEach(id => {
            next.add(id);
          });
          return next;
        });
      }
    },
    [commit, currentState],
  );

  // Click-to-delete from a single edge's × button (same effect as selecting the
  // edge and pressing Delete). Kept as its own path because inside an expanded
  // group cover there is no empty pane to drag an endpoint onto.
  const deleteEdgeLink = useCallback(
    (source: string, target: string) => {
      const targetId = planIdOf(target);
      if (source === VIRTUAL_ROOT_ID) {
        // The main-ticket edge is implicit — nothing to remove, just detach.
        setDetachedIds(prev => new Set(prev).add(targetId));
        return;
      }
      const state = removeLink(currentState(), planIdOf(source), targetId);
      commit(state);
      const step = state.nodes.find(n => n.id === targetId);
      if (parentsInState(state, targetId)?.length === 0 && !step?.groupId) {
        setDetachedIds(prev => new Set(prev).add(targetId));
      }
    },
    [commit, currentState],
  );

  // Collapsed groups render as one compact cover box (their member cards are
  // hidden); the cover keeps its position, so no re-layout on toggle.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const collapsedGroupsRef = useRef(collapsedGroups);
  collapsedGroupsRef.current = collapsedGroups;
  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNodeData>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const flowInstanceRef = useRef<ReactFlowInstance<EditorNodeData> | null>(null);
  const [groupSelectionMode, setGroupSelectionMode] = useState(false);

  const clearCanvasSelection = useCallback(() => {
    setNodes(previous =>
      previous.map(node => (node.selected ? { ...node, selected: false } : node)),
    );
  }, [setNodes]);

  const cancelGroupSelection = useCallback(() => {
    setGroupSelectionMode(false);
    clearCanvasSelection();
  }, [clearCanvasSelection]);

  const finishGroupSelection = useCallback(() => {
    if (!groupSelectionMode) return;
    requestAnimationFrame(() => {
      const selectedCanvasNodes =
        flowInstanceRef.current?.getNodes().filter(node => node.selected && !node.hidden) ?? [];
      const selectedGroupIds = new Set(
        selectedCanvasNodes.filter(node => isCoverId(node.id)).map(node => planIdOf(node.id)),
      );
      const state = currentState();
      const groupById = new Map(state.groups.map(group => [group.id, group]));
      const nodeById = new Map(state.nodes.map(node => [node.id, node]));
      const isInsideSelectedGroup = (entityId: string): boolean => {
        let groupId = nodeById.get(entityId)?.groupId ?? groupById.get(entityId)?.groupId ?? null;
        while (groupId) {
          if (selectedGroupIds.has(groupId)) return true;
          groupId = groupById.get(groupId)?.groupId ?? null;
        }
        return false;
      };
      const entityIds = [
        ...selectedGroupIds,
        ...selectedCanvasNodes
          .filter(node => !isCoverId(node.id) && nodeById.has(node.id))
          .map(node => node.id)
          .filter(id => !isInsideSelectedGroup(id)),
      ];
      const selectedDecisionIds = selectedCanvasNodes
        .map(node => node.id)
        .filter(id => decisionsRef.current.some(decision => decision.id === id))
        .filter(id => {
          const sourceId = decisionsRef.current.find(decision => decision.id === id)?.parentNodeId;
          return !sourceId || !isInsideSelectedGroup(sourceId);
        });
      const result = createGroupFromSelection(state, {
        entityIds,
        selectedDecisionIds,
        decisions: decisionsRef.current,
        detachedIds,
        groupId: uuidv4(),
        name: `Group ${groupsRef.current.length + 1}`,
      });
      if (!result.ok) {
        toast.error(groupSelectionError(result.reason));
        cancelGroupSelection();
        return;
      }
      commit(result.state);
      setDetachedIds(result.detachedIds);
      cancelGroupSelection();
    });
  }, [cancelGroupSelection, commit, currentState, detachedIds, groupSelectionMode]);

  useEffect(() => {
    if (!groupSelectionMode) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelGroupSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [cancelGroupSelection, groupSelectionMode]);

  /**
   * Builds the full React Flow node array from the plan:
   *   [virtual root, group covers, step cards]
   * (covers before their member cards — React Flow requires parents first).
   * Members are child nodes of their cover (`parentNode`), so dragging the
   * cover moves the whole group. With `relayout` false, existing positions
   * and user-resized cover sizes are preserved; new/changed nodes fall back
   * to the computed layout.
   */
  const buildGraphNodes = useBuildFlowPlanNodes({
    planNodesRef,
    groupsRef,
    decisionsRef,
    collapsedGroupsRef,
    addStep,
    updateStep,
    deleteStep,
    readOnly,
    detachedIds,
    configNodeId,
    setConfigNodeId,
    ...(onGroupsChange && { onGroupsChange }),
    onChange,
    renameGroup,
    ungroup,
    toggleGroupCollapse,
    configDecisionId,
    setConfigDecisionId,
    ...(onDecisionsChange && { onDecisionsChange }),
    validationWarningById,
  });

  useEffect(() => {
    setNodes(prev => buildGraphNodes(prev, prev.length === 0));
  }, [planNodes, groups, decisions, collapsedGroups, buildGraphNodes, setNodes]);

  const structureSignature = useMemo(
    () =>
      [
        ...planNodes.map(
          n => `${n.id}:${[...n.parentIds].sort().join('.')}:${n.order}:${n.groupId ?? ''}`,
        ),
        ...groups.map(
          g => `${g.id}:${[...g.parentIds].sort().join('.')}:${g.order ?? ''}:${g.groupId ?? ''}`,
        ),
        ...decisions.map(
          d =>
            `${d.id}:${d.parentNodeId}:${d.routes.map(route => `${route.key}:${route.targetId}`).join(',')}`,
        ),
      ]
        .sort()
        .join('|'),
    [planNodes, groups, decisions],
  );
  const buildGraphNodesRef = useRef(buildGraphNodes);
  buildGraphNodesRef.current = buildGraphNodes;
  const applyLayout = useCallback(() => {
    setNodes(prev => buildGraphNodesRef.current(prev, true));
  }, [setNodes]);
  const handleRearrange = useCallback(() => {
    applyLayout();
    requestAnimationFrame(() => {
      void flowInstanceRef.current?.fitView({ padding: 0.25, maxZoom: 1, duration: 250 });
    });
  }, [applyLayout]);
  const laidOutStructureRef = useRef<string | null>(null);
  useEffect(() => {
    if (laidOutStructureRef.current === structureSignature) return;
    laidOutStructureRef.current = structureSignature;
    applyLayout();
  }, [applyLayout, structureSignature]);

  // Dropping a step or group cover inside an expanded cover changes its
  // containment scope. Dragging it outside promotes it one level.
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (readOnly || node.id === VIRTUAL_ROOT_ID) return;
      const state = currentState();
      const rfById = new Map(nodesRef.current.map(n => [n.id, n]));
      const absolutePosition = (candidate: Node): { x: number; y: number } => {
        let x = candidate.position.x;
        let y = candidate.position.y;
        let parentId = candidate.parentNode;
        const seen = new Set<string>();
        while (parentId && !seen.has(parentId)) {
          seen.add(parentId);
          const parent = rfById.get(parentId);
          if (!parent) break;
          x += parent.position.x;
          y += parent.position.y;
          parentId = parent.parentNode;
        }
        return { x, y };
      };
      const absolute = absolutePosition(node);
      const absX = absolute.x;
      const absY = absolute.y;
      const centerX = absX + (node.width ?? CARD_WIDTH) / 2;
      const centerY = absY + (node.height ?? STEP_CARD_HEIGHT) / 2;
      const centerXById = new Map<string, number>();
      for (const canvasNode of nodesRef.current) {
        if (
          canvasNode.id === VIRTUAL_ROOT_ID ||
          decisionsRef.current.some(decision => decision.id === canvasNode.id)
        ) {
          continue;
        }
        const position = canvasNode.id === node.id ? absolute : absolutePosition(canvasNode);
        centerXById.set(planIdOf(canvasNode.id), position.x + (canvasNode.width ?? CARD_WIDTH) / 2);
      }

      const sizeNum = (value: unknown): number | null => (typeof value === 'number' ? value : null);
      let targetGroupId: string | null = null;
      const draggedGroupId = isCoverId(node.id) ? planIdOf(node.id) : null;
      const groupById = new Map(state.groups.map(group => [group.id, group]));
      const candidates = [...groupsRef.current].sort(
        (left, right) => Number(!!right.groupId) - Number(!!left.groupId),
      );
      for (const group of candidates) {
        if (draggedGroupId && groupIsWithin(groupById, group.id, draggedGroupId)) continue;
        if (collapsedGroupsRef.current.has(group.id)) continue; // no dropping into a collapsed cover
        const cover = rfById.get(coverId(group.id));
        if (!cover) continue;
        const coverPosition = absolutePosition(cover);
        const width = sizeNum(cover.style?.width) ?? cover.width ?? 0;
        const height = sizeNum(cover.style?.height) ?? cover.height ?? 0;
        if (
          centerX >= coverPosition.x &&
          centerX <= coverPosition.x + width &&
          centerY >= coverPosition.y &&
          centerY <= coverPosition.y + height
        ) {
          targetGroupId = group.id;
          break;
        }
      }

      if (draggedGroupId) {
        const dragged = state.groups.find(group => group.id === draggedGroupId);
        if (!dragged) return;
        if ((dragged.groupId ?? null) === targetGroupId) {
          commit(reorderSiblingEntities(state, dragged.id, centerXById));
          return;
        }
        if (
          decisionsRef.current.some(decision =>
            decision.routes.some(route => route.targetId === dragged.id),
          )
        ) {
          toast.error('Decision-linked groups stay in their current group scope');
          return;
        }
        const result = moveGroupToContainer(state, dragged.id, targetGroupId);
        if (!result.ok) {
          if (result.reason === 'depth') {
            toast.error('Flow groups can only be nested one level deep');
          }
          if (result.reason === 'has-child') {
            toast.error('Move the inner group out before nesting this group');
          }
          if (result.reason === 'cycle') {
            toast.error('Moving this group there would create a cycle');
          }
          return;
        }
        commit(result.state);
        return;
      }

      const step = state.nodes.find(n => n.id === node.id);
      if (!step) return;
      const currentGroupId = step.groupId ?? null;
      if (targetGroupId === currentGroupId) {
        commit(reorderSiblingEntities(state, step.id, centerXById));
        return;
      }
      if (
        decisionsRef.current.some(
          decision =>
            decision.parentNodeId === step.id ||
            decision.routes.some(route => route.targetId === step.id),
        )
      ) {
        toast.error('Decision-linked steps stay in their current group scope');
        return;
      }

      const result = moveStepToContainer(state, step.id, targetGroupId, decisionsRef.current);
      if (!result.ok) {
        if (result.reason === 'cycle') {
          toast.error('Moving this step into that group would create a cycle');
        } else {
          toast.error('That step cannot be moved across these group boundaries');
        }
        return;
      }
      commit(result.state);
    },
    [readOnly, commit, currentState],
  );

  const edges = useFlowPlanEdges({
    planNodes,
    groups,
    decisions,
    collapsedGroups,
    detachedIds,
    readOnly,
    deleteEdgeLink,
  });
  const configNode = useMemo(
    () => (configNodeId ? (planNodes.find(n => n.id === configNodeId) ?? null) : null),
    [planNodes, configNodeId],
  );
  const draftGate: FlowStepGate =
    draftGateType === 'confirmation' ? draftConfirmationGate : draftFormGate;
  const attachedFormId = draftFormGate.formId;
  const [attachedFieldRows] = useCachedQuery(
    queries.getFormFieldsByFormId({ formId: attachedFormId || '' }),
    { enabled: !!attachedFormId && !readOnly },
  );
  const handleOpenAttachedForm = useCallback(async (): Promise<void> => {
    if (!attachedFormId) return;
    try {
      const formDetails = await formService.getFormById(attachedFormId);
      setEditingFormData({
        formName: formDetails.formName,
        formDescription: formDetails.formDescription ?? '',
        fields: mapFormDetailsToBuilderFields(formDetails),
      });
      setFormBuilderMode('edit');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load form');
    }
  }, [attachedFormId]);

  const handleUpdateAttachedForm = useCallback(
    async (formData: FormBuilderData & { formId: string }): Promise<void> => {
      try {
        const formRow = (allForms ?? []).find(form => form.id === formData.formId);
        await formService.updateForm({
          formId: formData.formId,
          formName: formData.formName,
          formDescription: formData.formDescription,
          contextType: (formRow?.contextType as FormContextType) ?? FormContextType.BOARD,
          entityType: (formRow?.entityType as FormEntityType) ?? FormEntityType.TICKET,
          ...(projectId && { projectId }),
          fields: mapFormFieldsToApiPayload(formData.fields),
        });
        setCreatedForms(prev => [
          ...prev.filter(form => form.id !== formData.formId),
          { id: formData.formId, formName: formData.formName },
        ]);
        closeFormBuilder();
        toast.success('Form updated');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update form');
      }
    },
    [allForms, closeFormBuilder, projectId],
  );

  useEffect(() => {
    const node = configNodeId
      ? (planNodesRef.current.find(n => n.id === configNodeId) ?? null)
      : null;
    const savedGate = node ? gateOf(node) : DEFAULT_GATE;
    setDraftGateType(savedGate.type);
    setDraftConfirmationGate(
      savedGate.type === 'confirmation' ? savedGate : { type: 'confirmation' },
    );
    setDraftFormGate(savedGate.type === 'form' ? savedGate : { type: 'form', formId: '' });
    setDraftAssignedTo(node?.assignedTo ?? null);
    closeFormBuilder();
  }, [closeFormBuilder, configNodeId]);

  const panelDirty =
    !!configNode &&
    (JSON.stringify(gateOf(configNode)) !== JSON.stringify(draftGate) ||
      (configNode.assignedTo ?? null) !== draftAssignedTo);
  const canSavePanel = panelDirty && (draftGate.type !== 'form' || !!draftGate.formId);

  const handleSavePanel = useCallback((): void => {
    if (!configNode || (draftGate.type === 'form' && !draftGate.formId)) return;
    updateStep(configNode.id, { gate: draftGate, assignedTo: draftAssignedTo });
  }, [configNode, draftGate, draftAssignedTo, updateStep]);

  return (
    <div className='flex w-full h-full' style={{ minHeight: 420 }}>
      <div className='flex min-w-0 flex-1 flex-col h-full'>
        <div className='relative min-h-0 flex-1'>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onInit={instance => {
              flowInstanceRef.current = instance;
            }}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onEdgeUpdateStart={onEdgeUpdateStart}
            onEdgeUpdate={onEdgeUpdate}
            onEdgeUpdateEnd={onEdgeUpdateEnd}
            onNodeDragStop={onNodeDragStop}
            onSelectionEnd={finishGroupSelection}
            nodeTypes={FLOW_PLAN_NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            nodesConnectable={!readOnly}
            edgesUpdatable={!readOnly}
            selectionOnDrag={groupSelectionMode}
            selectionMode={SelectionMode.Full}
            panOnDrag={!groupSelectionMode}
            edgeUpdaterRadius={10}
            deleteKeyCode={['Backspace', 'Delete']}
            onPaneClick={() => setConfigNodeId(null)}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={2}
            className={cn(
              'rounded-xl flow-plan-editor',
              groupSelectionMode && 'flow-plan-editor--group-selection',
            )}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color='hsl(var(--border))'
            />
            <MiniMap
              pannable
              zoomable
              position='bottom-left'
              nodeColor='hsl(var(--muted-foreground))'
              maskColor='hsl(var(--background) / 0.72)'
              style={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
              }}
            />
            <Panel position='top-left'>
              <div className='flex flex-col items-start gap-2'>
                <button
                  type='button'
                  onClick={handleRearrange}
                  data-track-category='flow_plan_editor'
                  data-track-name='rearrange_steps'
                  className='flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 shadow text-[12px] text-muted-foreground hover:text-[#6276be] hover:border-[#6276be] transition-colors'
                  title='Auto-arrange steps'
                >
                  <LayoutGrid size={13} />
                  <span className='font-medium'>Rearrange</span>
                </button>
                {!readOnly && (
                  <>
                    <button
                      type='button'
                      onClick={() => {
                        if (groupSelectionMode) {
                          cancelGroupSelection();
                        } else {
                          clearCanvasSelection();
                          setConfigNodeId(null);
                          setConfigDecisionId(null);
                          setGroupSelectionMode(true);
                        }
                      }}
                      data-track-category='flow_plan_editor'
                      data-track-name={
                        groupSelectionMode ? 'cancel_create_group' : 'start_create_group'
                      }
                      className={cn(
                        'flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 shadow text-[12px] transition-colors',
                        groupSelectionMode
                          ? 'border-[#6276be] bg-[#6276be] text-white'
                          : 'bg-background border-border text-muted-foreground hover:text-[#6276be] hover:border-[#6276be]',
                      )}
                    >
                      {groupSelectionMode ? (
                        <X size={13} />
                      ) : (
                        <SquareDashedMousePointer size={13} />
                      )}
                      <span className='font-medium'>
                        {groupSelectionMode ? 'Cancel selection' : 'Select nodes to group'}
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className='flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 shadow text-[12px] text-muted-foreground hover:text-[#6276be] hover:border-[#6276be] transition-colors outline-none'
                        data-track-category='flow_plan_editor'
                        data-track-name='add_detached_node'
                      >
                        <Plus size={13} />
                        <span className='font-medium'>Add node</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='start' sideOffset={6} className='z-[9999]'>
                        <DropdownMenuItem
                          onSelect={() => addDetachedNode('confirmation')}
                          className='flex items-center gap-2'
                        >
                          <UserCheck size={13} className='text-[#6276be]' />
                          <span>Confirmation</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => addDetachedNode('form')}
                          className='flex items-center gap-2'
                        >
                          <FileText size={13} className='text-[#6276be]' />
                          <span>Form</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {groupSelectionMode && (
                      <div className='max-w-[190px] rounded-lg border border-[#6276be]/40 bg-background/95 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground shadow'>
                        Draw a box around the items to group. Press Esc to cancel.
                      </div>
                    )}
                  </>
                )}
              </div>
            </Panel>

            {showStatusLegend && (
              <Panel position='top-right'>
                <div className='bg-background/95 border border-border rounded-lg px-3 py-2.5 shadow flex flex-col gap-1.5'>
                  <span className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px]'>
                    Ticket statuses (fixed)
                  </span>
                  {STATUS_OPTIONS.map(option => (
                    <span
                      key={option.status}
                      className='flex items-center gap-1.5 text-[11px] text-foreground'
                    >
                      {option.icon}
                      {option.label}
                    </span>
                  ))}
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
        <div className='z-10 flex shrink-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 border-t border-border bg-background/95 px-3 py-2 text-[11px] text-muted-foreground'>
          <span>Add step to grow the flow downwards</span>
          <span className='opacity-40'>·</span>
          <span>Drag between steps to add an extra parent — all parents must complete first</span>
          <span className='opacity-40'>·</span>
          <span>Drop a step inside a group to move it in</span>
        </div>
      </div>

      {configDecision && decisionSource && !readOnly && (
        <FlowDecisionConfigPanel
          decision={configDecision}
          source={decisionSource}
          fieldsLoaded={decisionFieldRows !== undefined}
          eligibleFields={eligibleDecisionFields}
          nodes={planNodes}
          groups={groups}
          onChooseField={chooseDecisionField}
          onUpdate={patch => updateDecision(configDecision.id, patch)}
          onSetRouteTarget={(routeKey, targetId) =>
            setDecisionRouteTarget(configDecision.id, routeKey, targetId)
          }
          onCreateTarget={(routeKey, kind) =>
            createDecisionTarget(configDecision.id, routeKey, kind)
          }
          onClose={() => setConfigDecisionId(null)}
        />
      )}
      {configNode && !readOnly && (
        <FlowStepConfigPanel
          configNode={configNode}
          onClose={() => setConfigNodeId(null)}
          draftAssignedTo={draftAssignedTo}
          setDraftAssignedTo={setDraftAssignedTo}
          draftGate={draftGate}
          setDraftGateType={setDraftGateType}
          draftConfirmationGate={draftConfirmationGate}
          setDraftConfirmationGate={setDraftConfirmationGate}
          draftFormGate={draftFormGate}
          setDraftFormGate={setDraftFormGate}
          formBuilderMode={formBuilderMode}
          setFormBuilderMode={setFormBuilderMode}
          closeFormBuilder={closeFormBuilder}
          handleCreateForm={handleCreateForm}
          handleOpenAttachedForm={handleOpenAttachedForm}
          {...(projectId && { projectId })}
          editingFormData={editingFormData}
          handleUpdateAttachedForm={handleUpdateAttachedForm}
          formNameById={formNameById}
          attachedFieldRows={attachedFieldRows}
          formOptions={formOptions}
          canSavePanel={canSavePanel}
          handleSavePanel={handleSavePanel}
        />
      )}
    </div>
  );
};
