import { useMemo } from 'react';
import { MarkerType, type Edge } from 'reactflow';
import {
  FlowPlanModel,
  type FlowPlanDecision,
  type FlowPlanGroup,
  type FlowPlanNode,
} from '@xyne/shared';
import {
  GROUP_ENTRY_HANDLE,
  GROUP_EXIT_HANDLE,
  GROUP_INPUT_HANDLE,
  GROUP_OUTPUT_HANDLE,
} from '../FlowRun/FlowGroupNode';
import { VIRTUAL_ROOT_ID } from './FlowPlanEditor.utils';
import { coverId, isCoverId } from './flowPlanGraph';

interface UseFlowPlanEdgesArgs {
  planNodes: FlowPlanNode[];
  groups: FlowPlanGroup[];
  decisions: FlowPlanDecision[];
  collapsedGroups: Set<string>;
  detachedIds: Set<string>;
  readOnly: boolean;
  deleteEdgeLink: (source: string, target: string) => void;
}

export function useFlowPlanEdges({
  planNodes,
  groups,
  decisions,
  collapsedGroups,
  detachedIds,
  readOnly,
  deleteEdgeLink,
}: UseFlowPlanEdgesArgs): Edge[] {
  return useMemo((): Edge[] => {
    const edgeModel = new FlowPlanModel({
      version: 2,
      nodes: planNodes,
      groups,
      decisions,
      updatedAt: 0,
    });
    const activeGroupIds = edgeModel.activeGroupIds;
    const displayId = (planId: string): string =>
      activeGroupIds.has(planId) ? coverId(planId) : planId;
    const seen = new Set<string>();
    const list: Edge[] = [];
    const pushEdge = (
      source: string,
      target: string,
      options?: { sourceHandle?: string; targetHandle?: string; derived?: boolean },
      label?: string,
    ): void => {
      const id = `e-${source}-${options?.sourceHandle ?? 'default'}-${target}-${options?.targetHandle ?? 'default'}`;
      if (seen.has(id) || source === target) return;
      seen.add(id);
      // Entry/exit edges are derived (parentless / no dependents) — nothing to
      // delete, but their endpoints can be dragged to rewire the member. Real
      // parent links get a × delete button (see FlowPlanEdge).
      const derived = options?.derived ?? false;
      const removable = !readOnly && source !== VIRTUAL_ROOT_ID && !derived;
      list.push({
        id,
        source,
        target,
        ...(options?.sourceHandle ? { sourceHandle: options.sourceHandle } : {}),
        ...(options?.targetHandle ? { targetHandle: options.targetHandle } : {}),
        // Derived entry/exit edges keep the default renderer; real links use the
        // custom edge so they can be deleted with a click.
        type: derived ? 'default' : 'flowPlan',
        deletable: removable,
        updatable: !readOnly && !derived,
        interactionWidth: 10,
        ...(removable && {
          data: { onDelete: (): void => deleteEdgeLink(source, target) },
        }),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#6276be',
          width: 18,
          height: 18,
        },
        style: { stroke: '#94a3b8', strokeWidth: 1.5 },
        ...(label && {
          label,
          labelStyle: {
            fill: 'hsl(var(--flow-decision-fg))',
            fontSize: 10,
            fontWeight: 600,
          },
          labelShowBg: true,
          labelBgStyle: {
            fill: 'hsl(var(--flow-decision-bg))',
            stroke: 'hsl(var(--flow-decision-border))',
            strokeWidth: 1,
          },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 6,
        }),
      });
    };
    const externalHandles = (
      source: string,
      target: string,
    ): { sourceHandle?: string; targetHandle?: string } => ({
      ...(isCoverId(source) && { sourceHandle: GROUP_OUTPUT_HANDLE }),
      ...(isCoverId(target) && { targetHandle: GROUP_INPUT_HANDLE }),
    });

    for (const step of planNodes) {
      if (step.groupId && activeGroupIds.has(step.groupId)) {
        const containingGroup = edgeModel.getGroup(step.groupId);
        if (
          collapsedGroups.has(step.groupId) ||
          (!!containingGroup?.groupId && collapsedGroups.has(containingGroup.groupId))
        )
          continue;
        for (const parentId of step.parentIds) {
          if (!decisions.some(decision => decision.id === parentId))
            pushEdge(displayId(parentId), step.id, externalHandles(displayId(parentId), step.id));
        }
        continue;
      }
      // Detached steps draw no implicit root edge — they float until rewired
      const sources =
        step.parentIds.length > 0
          ? step.parentIds.map(displayId)
          : detachedIds.has(step.id)
            ? []
            : [VIRTUAL_ROOT_ID];
      for (const source of sources) {
        if (!decisions.some(decision => decision.id === source))
          pushEdge(source, step.id, externalHandles(source, step.id));
      }
    }
    for (const group of groups) {
      if (!activeGroupIds.has(group.id)) continue;
      if (group.groupId && collapsedGroups.has(group.groupId)) continue;
      const sources =
        group.parentIds.length > 0
          ? group.parentIds.map(displayId)
          : detachedIds.has(group.id)
            ? []
            : group.groupId
              ? [coverId(group.groupId)]
              : [VIRTUAL_ROOT_ID];
      for (const source of sources) {
        if (!decisions.some(decision => decision.id === source))
          pushEdge(
            source,
            coverId(group.id),
            group.groupId && group.parentIds.length === 0
              ? {
                  sourceHandle: GROUP_ENTRY_HANDLE,
                  targetHandle: GROUP_INPUT_HANDLE,
                  derived: true,
                }
              : externalHandles(source, coverId(group.id)),
          );
      }
      if (collapsedGroups.has(group.id)) continue;
      // Internal flow: cover top fans into entry members, terminal members
      // fan into the cover bottom — the full path through the group is
      // visible, and dragging an endpoint rewires the member.
      const members = planNodes.filter(step => step.groupId === group.id);
      const terminalIds = new Set(edgeModel.terminalEntityIdsOf(group.id));
      for (const member of members) {
        if (member.parentIds.length === 0) {
          pushEdge(coverId(group.id), member.id, {
            sourceHandle: GROUP_ENTRY_HANDLE,
            derived: true,
          });
        }
        if (terminalIds.has(member.id)) {
          pushEdge(member.id, coverId(group.id), {
            targetHandle: GROUP_EXIT_HANDLE,
            derived: true,
          });
        }
      }
      for (const child of edgeModel.childGroupsOf(group.id)) {
        if (terminalIds.has(child.id)) {
          pushEdge(coverId(child.id), coverId(group.id), {
            sourceHandle: GROUP_OUTPUT_HANDLE,
            targetHandle: GROUP_EXIT_HANDLE,
            derived: true,
          });
        }
      }
    }
    for (const decision of decisions) {
      pushEdge(decision.parentNodeId, decision.id, {
        targetHandle: 'decision',
        derived: true,
      });
      for (const route of decision.routes) {
        if (!route.targetId) continue;
        const target = displayId(route.targetId);
        pushEdge(
          decision.id,
          target,
          {
            sourceHandle: route.key,
            ...(isCoverId(target) && { targetHandle: GROUP_INPUT_HANDLE }),
            derived: true,
          },
          route.label,
        );
      }
    }
    return list;
  }, [planNodes, groups, decisions, collapsedGroups, detachedIds, readOnly, deleteEdgeLink]);
}
