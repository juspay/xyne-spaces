import type { FlowPlanDecision, FlowPlanGroup, FlowPlanNode } from '@xyne/shared';

export const VIRTUAL_ROOT_ID = '__flow-root__';

export const CARD_WIDTH = 240;
export const GROUP_PAD = 20;
export const GROUP_HEADER = 36;

const H_GAP = 70;
const V_GAP = 55;
const TOP_MARGIN = 40;

/** Anything the layout can place: a step card or a whole group block. */
export interface FlowLayoutItem {
  id: string;
  parentIds: string[];
  order: number;
  width: number;
  height: number;
}

export interface FlowPlanEditorIssue {
  nodeIds: string[];
  message: string;
}

/**
 * User-facing decision problems that can be attached to the affected cards.
 * The structural validator remains authoritative at save time; this projection
 * gives the editor enough context to explain the problem without exposing ids.
 */
export function getFlowPlanEditorIssues(
  nodes: FlowPlanNode[],
  groups: FlowPlanGroup[],
  decisions: FlowPlanDecision[],
): FlowPlanEditorIssue[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const groupById = new Map(groups.map(group => [group.id, group]));
  const decisionById = new Map(decisions.map(decision => [decision.id, decision]));
  const issues: FlowPlanEditorIssue[] = [];
  const seen = new Set<string>();
  const add = (key: string, nodeIds: string[], message: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ nodeIds: [...new Set(nodeIds)], message });
  };
  const targetName = (id: string): string =>
    nodeById.get(id)?.title || groupById.get(id)?.name || 'Deleted step';

  for (const node of nodes) {
    if (!node.title.trim()) {
      add(`step-title:${node.id}`, [node.id], 'Give this step a title before saving.');
    }
    if (node.gate?.type === 'form' && !node.gate.formId) {
      add(
        `step-form:${node.id}`,
        [node.id],
        `Attach a form to “${node.title || 'Untitled step'}” or change it to confirmation.`,
      );
    }
  }

  for (const group of groups) {
    if (!group.groupId) continue;
    const outerGroup = groupById.get(group.groupId);
    if (!outerGroup) {
      add(
        `group-parent-missing:${group.id}`,
        [group.id],
        `“${group.name || 'Untitled group'}” is inside a deleted group. Move it to another group or back to the main flow.`,
      );
    } else if (outerGroup.groupId) {
      add(
        `group-depth:${group.id}`,
        [group.id, outerGroup.id],
        'Flow groups can only be nested one level deep.',
      );
    }
  }

  for (const decision of decisions) {
    const decisionName = decision.fieldName || 'Decision';
    if (!decision.fieldId || !decision.fieldName) {
      add(
        `decision-field:${decision.id}`,
        [decision.id],
        'Choose the required form field this decision should use.',
      );
    }
    if (
      decision.fieldType === 'STRING' &&
      (!decision.operator || !decision.comparisonValue?.trim())
    ) {
      add(
        `decision-comparison:${decision.id}`,
        [decision.id],
        `Enter the value that the “${decisionName}” decision should compare against.`,
      );
    }

    for (const route of decision.routes) {
      if (!route.targetId) {
        add(
          `decision-route-empty:${decision.id}:${route.key}`,
          [decision.id],
          `Choose where the “${route.label}” path should go.`,
        );
        continue;
      }
      const target = nodeById.get(route.targetId) ?? groupById.get(route.targetId);
      if (!target) {
        add(
          `decision-route-missing:${decision.id}:${route.key}`,
          [decision.id],
          `The “${route.label}” path points to a deleted step. Choose another destination.`,
        );
        continue;
      }
      if (target.parentIds.length !== 1 || target.parentIds[0] !== decision.id) {
        add(
          `decision-route-parent:${decision.id}:${route.targetId}`,
          [decision.id, route.targetId],
          `“${targetName(route.targetId)}” is selected for the “${route.label}” path, but it has another incoming connection. Decision destinations can only start from their decision path.`,
        );
      }
    }
  }

  for (const target of [...nodes, ...groups]) {
    for (const parentId of target.parentIds) {
      const decision = decisionById.get(parentId);
      if (!decision || decision.routes.some(route => route.targetId === target.id)) continue;
      add(
        `stale-decision-parent:${decision.id}:${target.id}`,
        [decision.id, target.id],
        `“${targetName(target.id)}” is still linked to the “${decision.fieldName || 'Decision'}” decision, but no path points to it. Reconnect this item or choose it as a decision destination.`,
      );
    }
  }

  return issues;
}

/**
 * Top-down tidy-tree layout over a DAG of variable-size blocks (org-chart
 * style): every item is centred over its subtree, siblings pack
 * left-to-right, and the virtual main-ticket root ends up centred over the
 * whole graph. Rows are as tall as their tallest item.
 *
 * Depth (row) comes from the DAG — one row below the DEEPEST parent — while
 * horizontal packing uses a spanning tree built from each item's primary
 * (first) parent, so multi-parent items sit under their first parent and the
 * extra parent edges simply fan across.
 */
export function computeFlowLayout(
  items: FlowLayoutItem[],
  rootHeight: number = 150,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const byId = new Map(items.map(item => [item.id, item]));

  // Row = 1 + max(parent rows); parentless items hang off the root (row 1)
  const layerOf = new Map<string, number>();
  const resolveLayer = (id: string, trail: Set<string>): number => {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    if (trail.has(id)) return 1; // cycle guard — validated elsewhere
    trail.add(id);
    const item = byId.get(id);
    const layer =
      !item || item.parentIds.length === 0
        ? 1
        : 1 + Math.max(...item.parentIds.map(parentId => resolveLayer(parentId, trail)));
    layerOf.set(id, layer);
    return layer;
  };
  for (const item of items) resolveLayer(item.id, new Set());

  // Row tops: each row is as tall as its tallest item (root = row 0)
  const rowHeights = new Map<number, number>([[0, rootHeight]]);
  for (const item of items) {
    const layer = layerOf.get(item.id) ?? 1;
    rowHeights.set(layer, Math.max(rowHeights.get(layer) ?? 0, item.height));
  }
  const maxLayer = Math.max(0, ...rowHeights.keys());
  const rowTop = new Map<number, number>();
  let cursorY = TOP_MARGIN;
  for (let layer = 0; layer <= maxLayer; layer += 1) {
    rowTop.set(layer, cursorY);
    cursorY += (rowHeights.get(layer) ?? 0) + V_GAP;
  }

  // Spanning tree on the primary (first) parent for horizontal packing.
  // Multi-parent joins are placed separately after all their parents; counting
  // them here would make one arbitrary parent reserve the join's full width.
  const childrenByPrimary = new Map<string | null, FlowLayoutItem[]>();
  for (const item of items) {
    const primary = item.parentIds[0] ?? null;
    const list = childrenByPrimary.get(primary) ?? [];
    list.push(item);
    childrenByPrimary.set(primary, list);
  }
  childrenByPrimary.forEach(list => list.sort((a, b) => a.order - b.order));
  const exclusiveChildrenOf = (id: string | null): FlowLayoutItem[] =>
    (childrenByPrimary.get(id) ?? []).filter(child => child.parentIds.length <= 1);

  // Subtree width = max(own block, packed exclusive-child widths)
  const widthOf = (id: string | null): number =>
    id === null ? CARD_WIDTH : (byId.get(id)?.width ?? CARD_WIDTH);
  const widthMemo = new Map<string | null, number>();
  const subtreeWidth = (id: string | null): number => {
    const known = widthMemo.get(id);
    if (known !== undefined) return known;
    const children = exclusiveChildrenOf(id);
    const width =
      children.length === 0
        ? widthOf(id)
        : Math.max(
            widthOf(id),
            children.reduce((sum, child) => sum + subtreeWidth(child.id), 0) +
              H_GAP * (children.length - 1),
          );
    widthMemo.set(id, width);
    return width;
  };

  // Assign: item centred over its packed children, children packed from left
  const assign = (id: string | null, left: number): void => {
    const width = subtreeWidth(id);
    const centerX = left + width / 2;
    const layer = id === null ? 0 : (layerOf.get(id) ?? 1);
    positions.set(id ?? VIRTUAL_ROOT_ID, {
      x: centerX - widthOf(id) / 2,
      y: rowTop.get(layer) ?? TOP_MARGIN,
    });
    const children = exclusiveChildrenOf(id);
    const childrenWidth =
      children.reduce((sum, child) => sum + subtreeWidth(child.id), 0) +
      H_GAP * Math.max(0, children.length - 1);
    let cursor = centerX - childrenWidth / 2;
    for (const child of children) {
      assign(child.id, cursor);
      cursor += subtreeWidth(child.id) + H_GAP;
    }
  };
  assign(null, 60);

  // A join with several parents belongs visually between those parents, not
  // under whichever parent happened to be listed first. Identical sibling
  // joins are packed as one set, then their exclusive descendants are laid out
  // beneath them.
  const joinItems = items.filter(item => item.parentIds.length > 1);
  const joinSets = new Map<string, FlowLayoutItem[]>();
  for (const item of joinItems) {
    const layer = layerOf.get(item.id) ?? 1;
    const key = `${layer}:${[...item.parentIds].sort().join(',')}`;
    const siblings = joinSets.get(key) ?? [];
    siblings.push(item);
    joinSets.set(key, siblings);
  }

  const orderedJoinSets = [...joinSets.values()].sort(
    (a, b) => (layerOf.get(a[0]!.id) ?? 1) - (layerOf.get(b[0]!.id) ?? 1),
  );
  for (const siblings of orderedJoinSets) {
    siblings.sort((a, b) => a.order - b.order);
    const parentCenters = siblings[0]!.parentIds.flatMap(parentId => {
      const parentPosition = positions.get(parentId);
      return parentPosition ? [parentPosition.x + widthOf(parentId) / 2] : [];
    });
    if (parentCenters.length < 2) continue;

    const desiredCenter = (Math.min(...parentCenters) + Math.max(...parentCenters)) / 2;
    const siblingsWidth =
      siblings.reduce((sum, sibling) => sum + subtreeWidth(sibling.id), 0) +
      H_GAP * (siblings.length - 1);
    let cursorX = desiredCenter - siblingsWidth / 2;
    for (const sibling of siblings) {
      assign(sibling.id, cursorX);
      cursorX += subtreeWidth(sibling.id) + H_GAP;
    }
  }

  return positions;
}

/** Layout of a group's members, relative to the cover's top-left corner. */
export interface FlowGroupLayout {
  width: number;
  height: number;
  /** Member id -> position relative to the cover */
  memberPositions: Map<string, { x: number; y: number }>;
}

/**
 * Lays a group's members out inside the cover: entry members (no parents) on
 * the first row, the internal DAG below, padded and leaving room for the
 * cover header.
 */
export function computeGroupInternalLayout(
  members: FlowPlanNode[],
  cardHeight: number,
  decisions: FlowPlanDecision[] = [],
  decisionHeight: number = 100,
  childGroups: FlowLayoutItem[] = [],
): FlowGroupLayout {
  const layout = computeFlowLayout(
    [
      ...members.map(member => ({
        id: member.id,
        parentIds: member.parentIds,
        order: member.order,
        width: CARD_WIDTH,
        height: cardHeight,
      })),
      ...decisions.map((decision, index) => ({
        id: decision.id,
        parentIds: [decision.parentNodeId],
        order: members.length + index,
        width: CARD_WIDTH,
        height: decisionHeight,
      })),
      ...childGroups,
    ],
    0,
  );
  layout.delete(VIRTUAL_ROOT_ID);
  const xs = [...layout.values()].map(position => position.x);
  const ys = [...layout.values()].map(position => position.y);
  const minX = xs.length > 0 ? Math.min(...xs) : 0;
  const minY = ys.length > 0 ? Math.min(...ys) : 0;
  const memberPositions = new Map<string, { x: number; y: number }>();
  let maxX = 0;
  let maxY = 0;
  for (const [id, position] of layout) {
    const x = position.x - minX + GROUP_PAD;
    const y = position.y - minY + GROUP_HEADER + GROUP_PAD;
    memberPositions.set(id, { x, y });
    const childGroup = childGroups.find(group => group.id === id);
    const width = childGroup?.width ?? CARD_WIDTH;
    const height = childGroup
      ? childGroup.height
      : decisions.some(decision => decision.id === id)
        ? decisionHeight
        : cardHeight;
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  return {
    width: Math.max(CARD_WIDTH + GROUP_PAD * 2, maxX + GROUP_PAD),
    height: Math.max(GROUP_HEADER + cardHeight + GROUP_PAD * 2, maxY + GROUP_PAD),
    memberPositions,
  };
}

/** Group order for layout purposes = its earliest member's order. */
export function groupOrder(members: FlowPlanNode[]): number {
  return members.length > 0 ? Math.min(...members.map(member => member.order)) : 0;
}

/**
 * Would adding `parentId` as a parent of `childId` create a cycle in the
 * combined step+group graph? Both ids may be step ids or group ids.
 * Containment counts: a member starts after its group, so its group is an
 * ancestor of it.
 */
export function wouldCreateCycle(
  nodes: FlowPlanNode[],
  groups: FlowPlanGroup[],
  childId: string,
  parentId: string,
): boolean {
  if (childId === parentId) return true;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const groupById = new Map(groups.map(group => [group.id, group]));
  const parentsOf = (id: string): string[] => {
    const node = nodeById.get(id);
    if (node) return node.groupId ? [...node.parentIds, node.groupId] : node.parentIds;
    const group = groupById.get(id);
    return group ? [...group.parentIds, ...(group.groupId ? [group.groupId] : [])] : [];
  };
  // Cycle iff childId is an ancestor of parentId
  const queue = [parentId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === childId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...parentsOf(current));
  }
  return false;
}
