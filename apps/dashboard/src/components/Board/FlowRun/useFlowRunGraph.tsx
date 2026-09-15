import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { Archive, CircleMinus } from 'lucide-react';
import { MarkerType, type Edge, type Node } from 'reactflow';
import {
  FlowPlanModel,
  TicketStatusV2,
  type FlowDecisionOutcome,
  type FlowPlanNode,
  type Ticket,
} from '@xyne/shared';
import type { FlowNodeSelection } from './FlowNodeSidePanel';
import {
  flowRuntimeStatusOf,
  getFlowMeta,
  isFlowStepBacklogged,
  mapPlanToRunTickets,
  type FlowRunTicket,
} from './flowRun.utils';
import type { FlowTicketNodeData } from './FlowTicketNodeCard';
import { collapsedGroupCoverHeight, flowGroupColor, type FlowGroupNodeData } from './FlowGroupNode';
import { getStatusOption } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import {
  CARD_WIDTH as FLOW_CARD_WIDTH,
  computeFlowLayout,
  computeGroupInternalLayout,
  VIRTUAL_ROOT_ID as FLOW_VIRTUAL_ROOT_ID,
  type FlowLayoutItem,
} from '../FlowPlanEditor/FlowPlanEditor.utils';

export interface FlowRunGraph {
  nodes: Node<FlowTicketNodeData | FlowGroupNodeData>[];
  edges: Edge[];
  locked: Set<string>;
}

/** React Flow node id for a group's cover — consumers must not re-derive the prefix. */
export const flowGroupCoverId = (groupId: string): string => `flow-group:${groupId}`;

interface UseFlowRunGraphArgs {
  isFlowBoard: boolean;
  selectedFlowRunModel: FlowPlanModel | null;
  selectedGraphRootTicketId: string | null;
  graphTickets: Ticket[];
  collapsedFlowGroups: Set<string>;
  setCollapsedFlowGroups: Dispatch<SetStateAction<Set<string>>>;
  flowSelection: FlowNodeSelection | null;
  setFlowSelection: Dispatch<SetStateAction<FlowNodeSelection | null>>;
  flowGroupBacklogPendingId: string | null;
  handleFlowGroupBacklog: (groupId: string) => Promise<void>;
}

export function useFlowRunGraph({
  isFlowBoard,
  selectedFlowRunModel,
  selectedGraphRootTicketId,
  graphTickets,
  collapsedFlowGroups,
  setCollapsedFlowGroups,
  flowSelection,
  setFlowSelection,
  flowGroupBacklogPendingId,
  handleFlowGroupBacklog,
}: UseFlowRunGraphArgs): FlowRunGraph {
  return useMemo((): FlowRunGraph => {
    const empty = { nodes: [], edges: [], locked: new Set<string>() };
    if (!isFlowBoard || !selectedFlowRunModel || !selectedGraphRootTicketId) return empty;
    const rootTicket =
      (graphTickets.find(
        ticket => ticket.id === selectedGraphRootTicketId,
      ) as unknown as FlowRunTicket) ?? null;
    if (!rootTicket) return empty;
    const ticketsByPlanNodeId = mapPlanToRunTickets(
      graphTickets as unknown as FlowRunTicket[],
      selectedGraphRootTicketId,
    );
    const runModel = selectedFlowRunModel;
    const statusByPlanNodeId = new Map(
      [...ticketsByPlanNodeId].map(([planNodeId, ticket]) => [
        planNodeId,
        flowRuntimeStatusOf(ticket),
      ]),
    );
    const decisionOutcomeById = new Map<string, FlowDecisionOutcome>();
    for (const decision of runModel.decisions) {
      const outcome = getFlowMeta(ticketsByPlanNodeId.get(decision.parentNodeId) ?? {})
        ?.decisionOutcomes?.[decision.id];
      if (outcome) decisionOutcomeById.set(decision.id, outcome);
    }
    const skipped = runModel.skippedPlanNodeIds(
      statusByPlanNodeId,
      rootTicket.statusV2 === TicketStatusV2.CANCELLED,
      decisionOutcomeById,
    );
    const skippedWithoutDecisions = runModel.skippedPlanNodeIds(
      statusByPlanNodeId,
      rootTicket.statusV2 === TicketStatusV2.CANCELLED,
    );
    const decisionSkipped = new Set(
      [...skipped].filter(planNodeId => !skippedWithoutDecisions.has(planNodeId)),
    );
    const rootPaused = rootTicket.statusV2 === TicketStatusV2.PAUSED;
    const locked = rootPaused
      ? new Set(runModel.nodes.map(planNode => planNode.id))
      : new Set<string>();
    // Groups carry outer edges; member tickets remain inside the cover.
    const activeGroups = runModel.activeGroups;
    const activeGroupIds = runModel.activeGroupIds;
    const skippedGroupIds = new Set(
      activeGroups
        .filter(
          group => runModel.deriveGroupStatus(group.id, statusByPlanNodeId, skipped) === 'SKIPPED',
        )
        .map(group => group.id),
    );
    const coverId = flowGroupCoverId;
    const displayId = (planId: string): string =>
      activeGroupIds.has(planId) ? coverId(planId) : planId;
    const runtimeParentIds = (parentIds: string[]): string[] =>
      parentIds.map(parentId => runModel.getDecision(parentId)?.parentNodeId ?? parentId);
    const collapsedIds = new Set(
      [...collapsedFlowGroups].filter(groupId => activeGroupIds.has(groupId)),
    );
    const hiddenPlanNodeIds = new Set(
      runModel.nodes
        .filter(planNode => {
          if (!planNode.groupId) return false;
          const group = runModel.getGroup(planNode.groupId);
          return (
            collapsedIds.has(planNode.groupId) ||
            (!!group?.groupId && collapsedIds.has(group.groupId))
          );
        })
        .map(planNode => planNode.id),
    );
    const STEP_CARD_HEIGHT = 118;
    const nestedGroups = activeGroups.filter(group => !!group.groupId);
    const topGroups = activeGroups.filter(group => !group.groupId);
    const internalByGroup = new Map(
      nestedGroups.map(group => [
        group.id,
        computeGroupInternalLayout(
          runModel.membersOf(group.id).map(member => ({
            ...member,
            order: runModel.layoutOrder(member.id),
            parentIds: runtimeParentIds(member.parentIds),
          })),
          STEP_CARD_HEIGHT,
        ),
      ]),
    );
    const coverSizeOf = (groupId: string): { width: number; height: number } => {
      if (collapsedIds.has(groupId)) {
        return {
          width: FLOW_CARD_WIDTH,
          height: collapsedGroupCoverHeight(
            runModel.membersOf(groupId).length + runModel.childGroupsOf(groupId).length,
          ),
        };
      }
      const content = internalByGroup.get(groupId);
      return content
        ? { width: content.width, height: content.height }
        : { width: FLOW_CARD_WIDTH, height: STEP_CARD_HEIGHT };
    };
    for (const group of topGroups) {
      const children = runModel
        .childGroupsOf(group.id)
        .filter(child => activeGroupIds.has(child.id));
      const childIds = new Set(children.map(child => child.id));
      internalByGroup.set(
        group.id,
        computeGroupInternalLayout(
          runModel.membersOf(group.id).map(member => ({
            ...member,
            order: runModel.layoutOrder(member.id),
            parentIds: runtimeParentIds(member.parentIds).map(parentId =>
              childIds.has(parentId) ? coverId(parentId) : parentId,
            ),
          })),
          STEP_CARD_HEIGHT,
          [],
          100,
          children.map(child => ({
            id: coverId(child.id),
            parentIds: runtimeParentIds(child.parentIds).map(parentId =>
              childIds.has(parentId) ? coverId(parentId) : parentId,
            ),
            order: runModel.layoutOrder(child.id),
            ...coverSizeOf(child.id),
          })),
        ),
      );
    }
    const layoutItems: FlowLayoutItem[] = [
      ...runModel.nodes
        .filter(planNode => !planNode.groupId || !activeGroupIds.has(planNode.groupId))
        .map(planNode => ({
          id: planNode.id,
          parentIds: runtimeParentIds(planNode.parentIds).map(displayId),
          order: runModel.layoutOrder(planNode.id),
          width: FLOW_CARD_WIDTH,
          height: STEP_CARD_HEIGHT,
        })),
      ...topGroups.map(group => ({
        id: coverId(group.id),
        parentIds: runtimeParentIds(group.parentIds).map(displayId),
        order: runModel.layoutOrder(group.id),
        ...coverSizeOf(group.id),
      })),
    ];
    const layout = computeFlowLayout(layoutItems, STEP_CARD_HEIGHT);
    for (const group of topGroups) {
      const coverPosition = layout.get(coverId(group.id));
      const internal = internalByGroup.get(group.id);
      if (!coverPosition || !internal) continue;
      for (const [memberId, relative] of internal.memberPositions) {
        layout.set(memberId, {
          x: coverPosition.x + relative.x,
          y: coverPosition.y + relative.y,
        });
      }
      for (const child of runModel.childGroupsOf(group.id)) {
        const childCoverPosition = layout.get(coverId(child.id));
        const childInternal = internalByGroup.get(child.id);
        if (!childCoverPosition || !childInternal) continue;
        for (const [memberId, relative] of childInternal.memberPositions) {
          layout.set(memberId, {
            x: childCoverPosition.x + relative.x,
            y: childCoverPosition.y + relative.y,
          });
        }
      }
    }
    const toggleGroup = (groupId: string): void => {
      setCollapsedFlowGroups(prev => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        return next;
      });
      // Collapsing hides the member the panel may be showing
      setFlowSelection(prev => {
        const selectedGroup = prev?.planNode?.groupId
          ? runModel.getGroup(prev.planNode.groupId)
          : undefined;
        return prev?.planNode?.groupId === groupId || selectedGroup?.groupId === groupId
          ? null
          : prev;
      });
    };
    const memberStatusChip = (member: FlowPlanNode): React.ReactNode => {
      const ticket = ticketsByPlanNodeId.get(member.id) ?? null;
      if (isFlowStepBacklogged(ticket)) {
        return (
          <span className='flex shrink-0 items-center text-amber-600' title='Backlog'>
            <Archive size={12} />
          </span>
        );
      }
      const statusOption = ticket ? getStatusOption(flowRuntimeStatusOf(ticket)) : null;
      if (statusOption) {
        return (
          <span className='flex shrink-0 items-center' title={statusOption.label}>
            {statusOption.icon}
          </span>
        );
      }
      if (skipped.has(member.id)) {
        return (
          <span className='shrink-0 text-[10px] text-muted-foreground' title='Skipped'>
            —
          </span>
        );
      }
      return (
        <span className='flex shrink-0 items-center opacity-60' title='To Do'>
          {getStatusOption(TicketStatusV2.TODO)?.icon}
        </span>
      );
    };
    const groupNodes: Node<FlowGroupNodeData>[] = [...topGroups, ...nestedGroups]
      .filter(group => !group.groupId || !collapsedIds.has(group.groupId))
      .map(group => {
        const members = runModel.descendantMembersOf(group.id);
        const allBacklogged =
          members.length > 0 &&
          members.every(member => isFlowStepBacklogged(ticketsByPlanNodeId.get(member.id)));
        const groupStatus = runModel.deriveGroupStatus(group.id, statusByPlanNodeId, skipped);
        const allSettled = members.every(
          member =>
            skipped.has(member.id) ||
            ticketsByPlanNodeId.get(member.id)?.statusV2 === TicketStatusV2.CANCELLED,
        );
        const statusOption =
          groupStatus && groupStatus !== 'SKIPPED'
            ? getStatusOption(groupStatus as TicketStatusV2)
            : null;
        const isCollapsed = collapsedIds.has(group.id);
        const targetEntityIds = new Set([
          ...runModel.groupAndAncestorIds(group.id),
          ...runModel.childGroupsOf(group.id).map(child => child.id),
          ...members.map(member => member.id),
        ]);
        const unresolvedDecision = runModel.decisions.find(decision => {
          if (decisionOutcomeById.has(decision.id) || skipped.has(decision.parentNodeId)) {
            return false;
          }
          return (
            members.some(member => member.id === decision.parentNodeId) ||
            decision.routes.some(route => targetEntityIds.has(route.targetId))
          );
        });
        const backlogDisabledReason = rootPaused
          ? 'Resume the Flow run first.'
          : rootTicket.statusV2 !== TicketStatusV2.STARTED
            ? 'Only an active Flow run can move a group to backlog.'
            : flowGroupBacklogPendingId && flowGroupBacklogPendingId !== group.id
              ? 'Another group is being moved to backlog.'
              : unresolvedDecision
                ? `Resolve conditional step "${runModel.getNode(unresolvedDecision.parentNodeId)?.title ?? 'Condition'}" first.`
                : members.every(member => {
                      const ticket = ticketsByPlanNodeId.get(member.id);
                      return (
                        skipped.has(member.id) ||
                        isFlowStepBacklogged(ticket) ||
                        ticket?.statusV2 === TicketStatusV2.COMPLETED ||
                        ticket?.statusV2 === TicketStatusV2.CANCELLED
                      );
                    })
                  ? 'All group steps are already settled.'
                  : undefined;
        const statusChip = allBacklogged ? (
          <span
            className='flex shrink-0 items-center gap-1 text-[10px] font-medium text-amber-600'
            title='Backlog'
          >
            <Archive size={isCollapsed ? 14 : 12} />
            {!isCollapsed && 'Backlog'}
          </span>
        ) : groupStatus === 'SKIPPED' ? (
          <span
            className='flex shrink-0 items-center gap-1 text-[10px] font-medium text-muted-foreground'
            title='Skipped'
          >
            {isCollapsed ? <CircleMinus size={14} /> : <span aria-hidden='true'>—</span>}
            {!isCollapsed && 'Skipped'}
          </span>
        ) : statusOption ? (
          <span
            className='flex shrink-0 items-center gap-1 text-[10px] font-medium text-muted-foreground'
            title={statusOption.label}
          >
            {statusOption.icon}
            {!isCollapsed && statusOption.label}
          </span>
        ) : isCollapsed ? (
          <span
            className='flex shrink-0 items-center text-muted-foreground'
            title={allSettled ? 'Skipped' : 'To Do'}
          >
            {allSettled ? <CircleMinus size={14} /> : getStatusOption(TicketStatusV2.TODO)?.icon}
          </span>
        ) : (
          <span className='shrink-0 text-[9px] font-medium uppercase tracking-[0.5px] text-muted-foreground'>
            {allSettled ? 'Skipped' : 'To Do'}
          </span>
        );
        const size = coverSizeOf(group.id);
        return {
          id: coverId(group.id),
          type: 'flowGroupNode',
          position: layout.get(coverId(group.id)) ?? { x: 60, y: 40 },
          style: { width: size.width, height: size.height },
          draggable: false,
          selectable: false,
          data: {
            name: group.name,
            memberCount: members.length,
            color: flowGroupColor(group.id),
            collapsed: isCollapsed,
            status: statusChip,
            skipped: groupStatus === 'SKIPPED',
            notStarted: groupStatus === null && !allSettled,
            ...(isCollapsed && {
              members: runModel.directEntityIdsInLevelOrder(group.id).map(id => {
                const member = runModel.getNode(id);
                if (member) {
                  return {
                    id: member.id,
                    title: ticketsByPlanNodeId.get(member.id)?.title ?? member.title,
                    status: memberStatusChip(member),
                  };
                }
                const child = runModel.getGroup(id)!;
                const childMembers = runModel.descendantMembersOf(child.id);
                const childAllBacklogged =
                  childMembers.length > 0 &&
                  childMembers.every(member =>
                    isFlowStepBacklogged(ticketsByPlanNodeId.get(member.id)),
                  );
                const childStatus = runModel.deriveGroupStatus(
                  child.id,
                  statusByPlanNodeId,
                  skipped,
                );
                return {
                  id: child.id,
                  title: child.name,
                  memberCount: runModel.descendantMembersOf(child.id).length,
                  status: childAllBacklogged ? (
                    <span className='flex shrink-0 items-center text-amber-600' title='Backlog'>
                      <Archive size={12} />
                    </span>
                  ) : childStatus === 'SKIPPED' ? (
                    <span
                      className='flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground'
                      title='Skipped'
                      aria-label='Skipped'
                    >
                      <CircleMinus size={13} />
                    </span>
                  ) : childStatus ? (
                    <span className='flex shrink-0 items-center' title={childStatus}>
                      {getStatusOption(childStatus as TicketStatusV2)?.icon}
                    </span>
                  ) : undefined,
                };
              }),
            }),
            onToggleCollapse: () => toggleGroup(group.id),
            onMoveToBacklog: () => void handleFlowGroupBacklog(group.id),
            ...(backlogDisabledReason && { backlogDisabledReason }),
            backlogPending: flowGroupBacklogPendingId === group.id,
          },
        };
      });
    const nodes: Node<FlowTicketNodeData | FlowGroupNodeData>[] = [
      ...groupNodes,
      {
        id: FLOW_VIRTUAL_ROOT_ID,
        type: 'flowTicketNode',
        position: layout.get(FLOW_VIRTUAL_ROOT_ID) ?? { x: 60, y: 40 },
        selected: !!flowSelection && flowSelection.planNode === null,
        data: {
          planNode: null,
          ticket: rootTicket,
          skipped: false,
          onSelect: () => setFlowSelection({ planNode: null, ticket: rootTicket, skipped: false }),
        },
      },
      ...runModel.nodes
        .filter(planNode => !hiddenPlanNodeIds.has(planNode.id))
        .map(planNode => {
          const ticket = ticketsByPlanNodeId.get(planNode.id) ?? null;
          const isSkipped = skipped.has(planNode.id);
          const decision = runModel.decisionAfter(planNode.id);
          const outcome = decision ? decisionOutcomeById.get(decision.id) : undefined;
          const selectedRoute =
            decision && outcome
              ? runModel.routeForOutcome(decision.id, outcome.outcomeKey)
              : undefined;
          const skipReason: FlowTicketNodeData['skipReason'] = isSkipped
            ? decisionSkipped.has(planNode.id)
              ? 'decision'
              : 'blocked'
            : undefined;
          return {
            id: planNode.id,
            type: 'flowTicketNode',
            position: layout.get(planNode.id) ?? { x: 60, y: 40 },
            selected: flowSelection?.planNode?.id === planNode.id,
            data: {
              planNode,
              ticket,
              skipped: isSkipped,
              ...(skipReason && { skipReason }),
              ...(decision && {
                decision: {
                  fieldName: decision.fieldName,
                  ...(selectedRoute && { selectedLabel: selectedRoute.label }),
                },
              }),
              onSelect: () =>
                setFlowSelection({
                  planNode,
                  ticket,
                  skipped: isSkipped,
                  ...(skipReason && { skipReason }),
                }),
            },
          };
        }),
    ];
    // Edges: parents -> steps/covers. Internal member edges only while the
    // group is expanded; entry members hang off the cover's top border and
    // terminal members run into its bottom border (entry/exit handles).
    interface EdgeProps {
      waiting: boolean;
      dimmed: boolean;
      color: string;
      label?: string;
      dashed?: boolean;
    }
    const stepEdgeProps = (planNode: FlowPlanNode): EdgeProps => {
      const targetTicket = ticketsByPlanNodeId.get(planNode.id);
      const targetStatus = targetTicket ? flowRuntimeStatusOf(targetTicket) : null;
      // Dotted (animated) edge = the flow is waiting on this step right now.
      const waiting =
        !!targetTicket &&
        !isFlowStepBacklogged(targetTicket) &&
        !locked.has(planNode.id) &&
        (targetTicket.statusV2 === TicketStatusV2.PAUSED ||
          targetTicket.statusV2 === TicketStatusV2.STARTED);
      // Edge color mirrors the target step: blue = yet to start, dashed blue
      // = waiting, green = completed, red = cancelled, gray = skipped path
      // after a cancel (the edge INTO the cancelled step itself stays red).
      const dimmed = skipped.has(planNode.id);
      const color = dimmed
        ? '#d4d4d8'
        : isFlowStepBacklogged(targetTicket)
          ? '#d97706'
          : targetStatus === TicketStatusV2.COMPLETED
            ? '#22c55e'
            : targetTicket?.statusV2 === TicketStatusV2.CANCELLED
              ? '#ef4444'
              : '#6276be';
      return { waiting, dimmed, color };
    };
    const edgePropsFromSource = (sourceId: string, targetProps: EdgeProps): EdgeProps =>
      skipped.has(sourceId) || skippedGroupIds.has(sourceId)
        ? {
            ...targetProps,
            waiting: false,
            dimmed: true,
            color: '#d4d4d8',
            dashed: true,
          }
        : targetProps;
    const edges: Edge[] = [];
    const pushEdge = (
      source: string,
      target: string,
      props: EdgeProps,
      handles?: { sourceHandle?: string; targetHandle?: string },
      edgeKey?: string,
    ): void => {
      edges.push({
        id: `flow-edge:${edgeKey ?? `${source}:${handles?.sourceHandle ?? 'default'}:${target}`}`,
        source,
        target,
        ...(handles?.sourceHandle ? { sourceHandle: handles.sourceHandle } : {}),
        ...(handles?.targetHandle ? { targetHandle: handles.targetHandle } : {}),
        type: 'default',
        animated: props.waiting,
        markerEnd: { type: MarkerType.ArrowClosed, color: props.color, width: 18, height: 18 },
        style: {
          stroke: props.color,
          strokeWidth: props.dimmed ? 1.25 : props.waiting ? 2 : 1.5,
          ...(props.dimmed && { opacity: 0.6 }),
          ...(props.dashed && { strokeDasharray: '5 5' }),
        },
        ...(props.label && {
          label: props.label,
          labelStyle: {
            fill: props.dimmed ? '#71717a' : props.color,
            fontSize: 10,
            fontWeight: 600,
          },
          labelShowBg: true,
          labelBgStyle: {
            fill: props.dimmed ? '#fafafa' : '#ffffff',
            stroke: props.color,
            strokeWidth: 1,
            opacity: 0.96,
          },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 6,
        }),
      });
    };
    for (const planNode of runModel.nodes) {
      if (planNode.groupId && activeGroupIds.has(planNode.groupId)) {
        if (collapsedIds.has(planNode.groupId)) continue; // members hidden
        const props = stepEdgeProps(planNode);
        for (const parentId of planNode.parentIds) {
          if (!runModel.isDecision(parentId)) {
            pushEdge(displayId(parentId), planNode.id, edgePropsFromSource(parentId, props));
          }
        }
        // Entry members flow in from the cover top; terminal members flow
        // out into the cover bottom — the path through the group is visible.
        if (planNode.parentIds.length === 0) {
          pushEdge(coverId(planNode.groupId), planNode.id, props, { sourceHandle: 'entry' });
        }
        if (runModel.isTerminalMember(planNode)) {
          pushEdge(planNode.id, coverId(planNode.groupId), props, { targetHandle: 'exit' });
        }
        continue;
      }
      const props = stepEdgeProps(planNode);
      const sourcePlanIds =
        planNode.parentIds.length > 0 ? planNode.parentIds : [FLOW_VIRTUAL_ROOT_ID];
      for (const sourcePlanId of sourcePlanIds) {
        if (runModel.isDecision(sourcePlanId)) continue;
        pushEdge(displayId(sourcePlanId), planNode.id, edgePropsFromSource(sourcePlanId, props));
      }
    }
    const groupEdgePropsById = new Map<string, EdgeProps>();
    const groupEdgeProps = (groupId: string): EdgeProps => {
      const cached = groupEdgePropsById.get(groupId);
      if (cached) return cached;
      const members = runModel.descendantMembersOf(groupId);
      const groupStatus = runModel.deriveGroupStatus(groupId, statusByPlanNodeId, skipped);
      const waiting =
        !rootPaused &&
        members.some(member => {
          const memberTicket = ticketsByPlanNodeId.get(member.id);
          return (
            !!memberTicket &&
            !isFlowStepBacklogged(memberTicket) &&
            (memberTicket.statusV2 === TicketStatusV2.PAUSED ||
              memberTicket.statusV2 === TicketStatusV2.STARTED)
          );
        });
      const dimmed =
        groupStatus === 'SKIPPED' ||
        (groupStatus === null &&
          members.every(
            member =>
              skipped.has(member.id) ||
              ticketsByPlanNodeId.get(member.id)?.statusV2 === TicketStatusV2.CANCELLED,
          ));
      // Same palette as step edges — the cover itself carries the group color
      const color = dimmed
        ? '#d4d4d8'
        : groupStatus === 'COMPLETED'
          ? '#22c55e'
          : groupStatus === 'CANCELLED'
            ? '#ef4444'
            : '#6276be';
      const props = { waiting, dimmed, color, ...(dimmed && { dashed: true }) };
      groupEdgePropsById.set(groupId, props);
      return props;
    };
    for (const group of activeGroups) {
      if (group.groupId && collapsedIds.has(group.groupId)) continue;
      const props = groupEdgeProps(group.id);
      const sourcePlanIds =
        group.parentIds.length > 0
          ? group.parentIds
          : group.groupId
            ? [group.groupId]
            : [FLOW_VIRTUAL_ROOT_ID];
      for (const sourcePlanId of sourcePlanIds) {
        if (!runModel.isDecision(sourcePlanId)) {
          pushEdge(
            displayId(sourcePlanId),
            coverId(group.id),
            edgePropsFromSource(sourcePlanId, props),
            group.groupId && group.parentIds.length === 0 ? { sourceHandle: 'entry' } : undefined,
          );
        }
      }
      if (!collapsedIds.has(group.id)) {
        const terminalEntities = new Set(runModel.terminalEntityIdsOf(group.id));
        for (const child of runModel.childGroupsOf(group.id)) {
          if (terminalEntities.has(child.id)) {
            pushEdge(coverId(child.id), coverId(group.id), groupEdgeProps(child.id), {
              targetHandle: 'exit',
            });
          }
        }
      }
    }
    for (const decision of runModel.decisions) {
      const sourceGroupId = runModel.getNode(decision.parentNodeId)?.groupId;
      const sourceGroup = sourceGroupId ? runModel.getGroup(sourceGroupId) : undefined;
      if (
        sourceGroupId &&
        (collapsedIds.has(sourceGroupId) ||
          (!!sourceGroup?.groupId && collapsedIds.has(sourceGroup.groupId)))
      )
        continue;
      const outcome = decisionOutcomeById.get(decision.id);
      const outcomeKey = outcome?.outcomeKey;
      const resolvedTargetId = outcome
        ? runModel.resolvedDecisionTargetId(decision.id, outcome)
        : undefined;
      const routesByTarget = new Map<string, typeof decision.routes>();
      for (const route of decision.routes) {
        const targetRoutes = routesByTarget.get(route.targetId) ?? [];
        targetRoutes.push(route);
        routesByTarget.set(route.targetId, targetRoutes);
      }
      for (const [targetId, targetRoutes] of routesByTarget) {
        const selectedRoute =
          targetId === resolvedTargetId
            ? targetRoutes.find(route => route.key === outcomeKey)
            : undefined;
        const selected = !!selectedRoute;
        const routeLabels = targetRoutes.map(route => route.label).join(' / ');
        const label = !outcomeKey
          ? routeLabels
          : selectedRoute
            ? `${selectedRoute.label} · Chosen`
            : `${routeLabels} · Skipped`;
        pushEdge(
          decision.parentNodeId,
          displayId(targetId),
          {
            waiting: false,
            dimmed: !!outcomeKey && !selected,
            color: outcomeKey ? (selected ? '#22c55e' : '#d4d4d8') : '#d97706',
            label,
            dashed: !!outcomeKey && !selected,
          },
          undefined,
          `decision:${decision.id}:${targetId}`,
        );
      }
    }
    return { nodes, edges, locked };
  }, [
    isFlowBoard,
    selectedFlowRunModel,
    selectedGraphRootTicketId,
    graphTickets,
    collapsedFlowGroups,
    flowSelection,
    flowGroupBacklogPendingId,
    handleFlowGroupBacklog,
  ]);
}
