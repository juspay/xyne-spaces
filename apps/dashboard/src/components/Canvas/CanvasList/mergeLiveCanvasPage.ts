interface CanvasRow {
  id: string;
  updatedAt: number;
}

const compareRows = (a: CanvasRow, b: CanvasRow): number =>
  b.updatedAt - a.updatedAt || b.id.localeCompare(a.id);

export function mergeLiveCanvasPage<T extends CanvasRow>(
  existing: T[],
  page: T[],
  previousPageIds: Set<string>,
  otherLivePage: T[],
  preserveDisplacedRows = false,
): T[] {
  const byId = new Map(existing.map(row => [row.id, row]));
  const pageIds = new Set(page.map(row => row.id));
  const otherPageIds = new Set(otherLivePage.map(row => row.id));
  const boundary = page[page.length - 1];

  previousPageIds.forEach(id => {
    if (pageIds.has(id) || otherPageIds.has(id)) return;
    const row = byId.get(id);
    // A new top row can push an already loaded row past the first-page boundary.
    if (preserveDisplacedRows && boundary && row && compareRows(row, boundary) > 0) return;
    byId.delete(id);
  });
  page.forEach(row => {
    const previous = byId.get(row.id);
    if (!previous || row.updatedAt >= previous.updatedAt) byId.set(row.id, row);
  });
  return Array.from(byId.values()).sort(compareRows);
}
