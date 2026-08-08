import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Node } from 'reactflow';
import {
  FlowPlanModel,
  type FlowPlanDecision,
  type FlowPlanGroup,
  type FlowPlanNode,
} from '@xyne/shared';
import {
  collapsedGroupCoverHeight,
  flowGroupColor,
  type FlowGroupNodeData,
} from '../FlowRun/FlowGroupNode';
import {
  CARD_WIDTH,
  computeFlowLayout,
  computeGroupInternalLayout,
  VIRTUAL_ROOT_ID,
  type FlowLayoutItem,
} from './FlowPlanEditor.utils';
import { coverId } from './flowPlanGraph';
import { gateOf, type AddStepKind, type EditorNodeData } from './FlowPlanNodes';

const STEP_CARD_HEIGHT = 170;

type BuildFlowPlanNodes = (
  previous: Node<EditorNodeData>[],
  relayout: boolean,
) => Node<EditorNodeData>[];

interface UseBuildFlowPlanNodesArgs {
  planNodesRef: MutableRefObject<FlowPlanNode[]>;
  groupsRef: MutableRefObject<FlowPlanGroup[]>;
  decisionsRef: MutableRefObject<FlowPlanDecision[]>;
  collapsedGroupsRef: MutableRefObject<Set<string>>;
  addStep: (parentId: string | null, kind: AddStepKind) => void;
  updateStep: (id: string, patch: Partial<FlowPlanNode>) => void;
  deleteStep: (id: string) => void;
  readOnly: boolean;
  detachedIds: Set<string>;
  configNodeId: string | null;
  setConfigNodeId: Dispatch<SetStateAction<string | null>>;
  onGroupsChange?: (groups: FlowPlanGroup[]) => void;
  onChange: (nodes: FlowPlanNode[]) => void;
  renameGroup: (groupId: string, name: string) => void;
  ungroup: (groupId: string) => void;
  toggleGroupCollapse: (groupId: string) => void;
  configDecisionId: string | null;
  setConfigDecisionId: Dispatch<SetStateAction<string | null>>;
  onDecisionsChange?: (decisions: FlowPlanDecision[]) => void;
  validationWarningById: Map<string, string>;
}

export function useBuildFlowPlanNodes({
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
  onGroupsChange,
  onChange,
  renameGroup,
  ungroup,
  toggleGroupCollapse,
  configDecisionId,
  setConfigDecisionId,
  onDecisionsChange,
  validationWarningById,
}: UseBuildFlowPlanNodesArgs): BuildFlowPlanNodes {
  return useCallback(
    (prev: Node<EditorNodeData>[], relayout: boolean): Node<EditorNodeData>[] => {
      const plan = planNodesRef.current;
      const collapsed = collapsedGroupsRef.current;
      const prevById = new Map(prev.map(n => [n.id, n]));

      // Read-model over the live editor arrays (already normalized in state).
      const model = new FlowPlanModel({
        version: 2,
        updatedAt: 0,
        nodes: plan,
        groups: groupsRef.current,
        decisions: decisionsRef.current,
      });
      const activeGroups = model.activeGroups;
      const groupIds = model.activeGroupIds;
      const nestedGroups = activeGroups.filter(group => !!group.groupId);
      const topGroups = activeGroups.filter(group => !group.groupId);
      const internalByGroup = new Map(
        nestedGroups.map(group => [
          group.id,
          computeGroupInternalLayout(
            model.membersOf(group.id).map(member => ({
              ...member,
              order: model.layoutOrder(member.id),
            })),
            STEP_CARD_HEIGHT,
            model.decisions.filter(
              decision => model.getNode(decision.parentNodeId)?.groupId === group.id,
            ),
          ),
        ]),
      );
      // Cover size always follows the content (collapsed = member list card)
      const coverSizeOf = (groupId: string): { width: number; height: number } => {
        if (collapsed.has(groupId)) {
          return {
            width: CARD_WIDTH,
            height: collapsedGroupCoverHeight(
              model.membersOf(groupId).length + model.childGroupsOf(groupId).length,
            ),
          };
        }
        const content = internalByGroup.get(groupId);
        return content
          ? { width: content.width, height: content.height }
          : { width: CARD_WIDTH, height: STEP_CARD_HEIGHT };
      };

      for (const group of topGroups) {
        const children = model.childGroupsOf(group.id).filter(child => groupIds.has(child.id));
        const childIds = new Set(children.map(child => child.id));
        internalByGroup.set(
          group.id,
          computeGroupInternalLayout(
            model.membersOf(group.id).map(member => ({
              ...member,
              order: model.layoutOrder(member.id),
              parentIds: member.parentIds.map(parentId =>
                childIds.has(parentId) ? coverId(parentId) : parentId,
              ),
            })),
            STEP_CARD_HEIGHT,
            model.decisions.filter(
              decision => model.getNode(decision.parentNodeId)?.groupId === group.id,
            ),
            100,
            children.map(child => ({
              id: coverId(child.id),
              parentIds: child.parentIds.map(parentId =>
                childIds.has(parentId) ? coverId(parentId) : parentId,
              ),
              order: model.layoutOrder(child.id),
              ...coverSizeOf(child.id),
            })),
          ),
        );
      }

      // Top-level layout: ungrouped steps + covers as one block each
      const layoutItems: FlowLayoutItem[] = [
        ...plan
          .filter(step => !step.groupId)
          .map(step => ({
            id: step.id,
            parentIds: step.parentIds.map(parentId =>
              groupIds.has(parentId) ? coverId(parentId) : parentId,
            ),
            order: model.layoutOrder(step.id),
            width: CARD_WIDTH,
            height: STEP_CARD_HEIGHT,
          })),
        ...topGroups.map(group => {
          const size = coverSizeOf(group.id);
          return {
            id: coverId(group.id),
            parentIds: group.parentIds.map(parentId =>
              groupIds.has(parentId) ? coverId(parentId) : parentId,
            ),
            order: model.layoutOrder(group.id),
            width: size.width,
            height: size.height,
          };
        }),
        ...model.decisions
          .filter(decision => !model.getNode(decision.parentNodeId)?.groupId)
          .map((decision, index) => ({
            id: decision.id,
            parentIds: [decision.parentNodeId],
            order: plan.length + index,
            width: CARD_WIDTH,
            height: 100,
          })),
      ];
      const layout = computeFlowLayout(layoutItems, STEP_CARD_HEIGHT);
      const positionOf = (id: string, keepPrev: boolean): { x: number; y: number } => {
        const prevNode = keepPrev && !relayout ? prevById.get(id) : undefined;
        return prevNode?.position ?? layout.get(id) ?? { x: 60, y: 40 };
      };

      const rootNode: Node<EditorNodeData> = {
        id: VIRTUAL_ROOT_ID,
        type: 'flowPlanNode',
        position: positionOf(VIRTUAL_ROOT_ID, true),
        deletable: false,
        data: {
          planNode: null,
          detached: false,
          onUpdate: () => {},
          onDelete: () => {},
          onAddStep: kind => addStep(null, kind),
          onConfigure: () => {},
          configuring: false,
          readOnly,
          canAddGroup: true,
          canAddDecision: false,
          routesThroughDecision: false,
        },
      };

      const orderedActiveGroups = [...topGroups, ...nestedGroups];
      const coverNodes: Node<EditorNodeData>[] = orderedActiveGroups.map(group => {
        const isCollapsed = collapsed.has(group.id);
        const size = coverSizeOf(group.id);
        const parentNode = group.groupId ? coverId(group.groupId) : undefined;
        const prevNode = prevById.get(coverId(group.id));
        const samePlacement = prevNode?.parentNode === parentNode;
        const position = group.groupId
          ? !relayout && samePlacement && prevNode
            ? prevNode.position
            : (internalByGroup.get(group.groupId)?.memberPositions.get(coverId(group.id)) ?? {
                x: 20,
                y: 56,
              })
          : positionOf(coverId(group.id), samePlacement);
        return {
          id: coverId(group.id),
          type: 'flowGroupNode',
          position,
          style: { width: size.width, height: size.height },
          draggable: !readOnly,
          selectable: !readOnly,
          deletable: false,
          ...(parentNode && { parentNode }),
          ...(group.groupId && collapsed.has(group.groupId) && { hidden: true }),
          data: {
            name: group.name,
            memberCount: model.descendantMembersOf(group.id).length,
            color: flowGroupColor(group.id),
            collapsed: isCollapsed,
            ...(isCollapsed && {
              members: model.directEntityIdsInLevelOrder(group.id).map(id => {
                const member = model.getNode(id);
                if (member) return { id: member.id, title: member.title };
                const child = model.getGroup(id)!;
                return {
                  id: child.id,
                  title: child.name,
                  memberCount: model.descendantMembersOf(child.id).length,
                };
              }),
            }),
            connectable: !readOnly,
            ...(validationWarningById.has(group.id) && {
              validationWarning: validationWarningById.get(group.id)!,
            }),
            onToggleCollapse: () => toggleGroupCollapse(group.id),
            ...(!readOnly &&
              onGroupsChange && {
                onRename: (name: string) => renameGroup(group.id, name),
                onUngroup: () => ungroup(group.id),
              }),
          } satisfies FlowGroupNodeData,
        };
      });

      const stepNodes: Node<EditorNodeData>[] = plan.map(step => {
        const inGroup = step.groupId && groupIds.has(step.groupId);
        const parentNode = inGroup ? coverId(step.groupId!) : undefined;
        const containingGroup = step.groupId ? model.getGroup(step.groupId) : undefined;
        const prevNode = prevById.get(step.id);
        // Positions only carry over within the same coordinate frame
        const samePlacement = prevNode?.parentNode === parentNode;
        const position =
          !relayout && samePlacement && prevNode
            ? prevNode.position
            : inGroup
              ? (internalByGroup.get(step.groupId!)!.memberPositions.get(step.id) ?? {
                  x: 20,
                  y: 56,
                })
              : positionOf(step.id, samePlacement);
        return {
          id: step.id,
          type: 'flowPlanNode',
          position,
          deletable: false,
          ...(parentNode && { parentNode }),
          ...(inGroup &&
            (collapsed.has(step.groupId!) ||
              (!!containingGroup?.groupId && collapsed.has(containingGroup.groupId))) && {
              hidden: true,
            }),
          data: {
            planNode: step,
            detached: detachedIds.has(step.id),
            onUpdate: (patch: Partial<FlowPlanNode>) => updateStep(step.id, patch),
            onDelete: () => deleteStep(step.id),
            onAddStep: (kind: AddStepKind) => addStep(step.id, kind),
            onConfigure: (): void => {
              setConfigDecisionId(null);
              setConfigNodeId(step.id);
            },
            configuring: configNodeId === step.id,
            readOnly,
            canAddGroup: !step.groupId || !containingGroup?.groupId,
            canAddDecision:
              gateOf(step).type === 'form' &&
              !decisionsRef.current.some(decision => decision.parentNodeId === step.id) &&
              !plan.some(candidate => candidate.parentIds.includes(step.id)) &&
              !groupsRef.current.some(group => group.parentIds.includes(step.id)),
            routesThroughDecision: decisionsRef.current.some(
              decision => decision.parentNodeId === step.id,
            ),
            ...(validationWarningById.has(step.id) && {
              validationWarning: validationWarningById.get(step.id)!,
            }),
          },
        };
      });

      const decisionNodes: Node<EditorNodeData>[] = model.decisions.map(decision => {
        const source = model.getNode(decision.parentNodeId);
        const sourceGroupId = source?.groupId ?? null;
        const inGroup = !!sourceGroupId && groupIds.has(sourceGroupId);
        const parentNode = sourceGroupId && inGroup ? coverId(sourceGroupId) : undefined;
        const containingGroup = sourceGroupId ? model.getGroup(sourceGroupId) : undefined;
        const prevNode = prevById.get(decision.id);
        const samePlacement = prevNode?.parentNode === parentNode;
        const position =
          !relayout && samePlacement && prevNode
            ? prevNode.position
            : inGroup
              ? (internalByGroup.get(sourceGroupId ?? '')?.memberPositions.get(decision.id) ?? {
                  x: 20,
                  y: 56,
                })
              : positionOf(decision.id, samePlacement);
        return {
          id: decision.id,
          type: 'flowDecisionNode',
          position,
          deletable: false,
          ...(parentNode && { parentNode }),
          ...(sourceGroupId &&
            inGroup &&
            (collapsed.has(sourceGroupId) ||
              (!!containingGroup?.groupId && collapsed.has(containingGroup.groupId))) && {
              hidden: true,
            }),
          data: {
            decision,
            onConfigure: (): void => {
              setConfigNodeId(null);
              setConfigDecisionId(decision.id);
            },
            onDelete: (): void => {
              onDecisionsChange?.(
                decisionsRef.current.filter(candidate => candidate.id !== decision.id),
              );
              onChange(
                planNodesRef.current.map(node =>
                  node.parentIds.includes(decision.id)
                    ? {
                        ...node,
                        parentIds: node.parentIds.filter(parentId => parentId !== decision.id),
                      }
                    : node,
                ),
              );
              onGroupsChange?.(
                groupsRef.current.map(group =>
                  group.parentIds.includes(decision.id)
                    ? {
                        ...group,
                        parentIds: group.parentIds.filter(parentId => parentId !== decision.id),
                      }
                    : group,
                ),
              );
              setConfigDecisionId(null);
            },
            configuring: configDecisionId === decision.id,
            readOnly,
            ...(validationWarningById.has(decision.id) && {
              validationWarning: validationWarningById.get(decision.id)!,
            }),
          },
        };
      });

      return [rootNode, ...coverNodes, ...stepNodes, ...decisionNodes];
    },
    [
      addStep,
      updateStep,
      deleteStep,
      readOnly,
      detachedIds,
      configNodeId,
      onGroupsChange,
      onChange,
      renameGroup,
      ungroup,
      toggleGroupCollapse,
      configDecisionId,
      onDecisionsChange,
      validationWarningById,
    ],
  );
}
