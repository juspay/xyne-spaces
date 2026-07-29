import type { ConfluencePage } from './confluenceClient';

export interface ConfluencePageTreeNode {
  page: ConfluencePage;
  parentId?: string;
  children: ConfluencePageTreeNode[];
  isVirtual?: boolean;
}

export interface ConfluencePageTree {
  roots: ConfluencePageTreeNode[];
  nodeById: Map<string, ConfluencePageTreeNode>;
}

export interface ConfluenceTopLevelSection {
  id: string;
  title: string;
  childPages: number;
}

export const buildConfluencePageTree = (pages: ConfluencePage[]): ConfluencePageTree => {
  const nodeById = new Map<string, ConfluencePageTreeNode>();
  for (const page of pages) {
    nodeById.set(page.id, { page, children: [] });
  }

  for (const page of pages) {
    for (let index = 0; index < (page.ancestors || []).length; index += 1) {
      const ancestor = page.ancestors?.[index];
      if (!ancestor || nodeById.has(ancestor.id)) continue;

      nodeById.set(ancestor.id, {
        page: {
          id: ancestor.id,
          type: 'virtual-folder',
          title: ancestor.title,
          ancestors: page.ancestors?.slice(0, index) || [],
        },
        children: [],
        isVirtual: true,
      });
    }
  }

  for (const node of nodeById.values()) {
    const parentId = [...(node.page.ancestors || [])]
      .reverse()
      .find(ancestor => nodeById.has(ancestor.id))?.id;
    node.parentId = parentId;
    if (parentId) {
      nodeById.get(parentId)?.children.push(node);
    }
  }

  const roots = [...nodeById.values()].filter(node => !node.parentId);
  roots.sort((a, b) => a.page.title.localeCompare(b.page.title));
  return { roots, nodeById };
};

export const countChildrenByParentId = (
  nodeById: Map<string, ConfluencePageTreeNode>,
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const node of nodeById.values()) {
    if (node.parentId) {
      counts.set(node.parentId, (counts.get(node.parentId) || 0) + 1);
    }
  }
  return counts;
};

export const getConfluenceSectionRoots = (roots: ConfluencePageTreeNode[]): {
  sectionRoots: ConfluencePageTreeNode[];
  spaceHomePage?: ConfluencePageTreeNode;
} => {
  const hasSpaceHomePage = roots.length === 1 && roots[0].children.length > 0;
  const sectionRoots = hasSpaceHomePage ? roots[0].children : roots;

  return {
    sectionRoots: [...sectionRoots].sort((a, b) => a.page.title.localeCompare(b.page.title)),
    ...(hasSpaceHomePage ? { spaceHomePage: roots[0] } : {}),
  };
};

export const getConfluenceTopLevelSections = (
  roots: ConfluencePageTreeNode[],
  childCountByParentId: Map<string, number>,
): ConfluenceTopLevelSection[] => {
  const { sectionRoots } = getConfluenceSectionRoots(roots);

  return sectionRoots.map(node => ({
    id: node.page.id,
    title: node.page.title,
    childPages: childCountByParentId.get(node.page.id) || 0,
  }));
};
