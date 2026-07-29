import type { Canvas } from './Canvas.types';

const EXCLUDED_CALL_GENERATED_SOURCES = new Set([
  'call_prd',
  'call_detailed_summary',
  'genius_dm_response',
  'genius_canvas_long_response',
  'jira_migration_report',
  'release_notes',
  'workflow_knowledge',
  'commit_analysis',
  'genius_investigation',
  // Retired generators — kept so their existing legacy canvases stay filtered.
  'xyne_auto_rca',
]);

function getCanvasMetadataSource(canvas: Canvas): string | undefined {
  const metadata = canvas.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const source = metadata.source;
  return typeof source === 'string' ? source : undefined;
}

export function isExcludedCallGeneratedCanvas(canvas: Canvas): boolean {
  const source = getCanvasMetadataSource(canvas);
  return source ? EXCLUDED_CALL_GENERATED_SOURCES.has(source) : false;
}

export function filterExcludedCallGeneratedCanvases(
  canvases: Canvas[],
  excludeCallGeneratedCanvases: boolean,
): Canvas[] {
  if (!excludeCallGeneratedCanvases) {
    return canvases;
  }

  return canvases.filter(canvas => !isExcludedCallGeneratedCanvas(canvas));
}

export function filterStarredCanvases(canvases: Canvas[], showStarredOnly: boolean): Canvas[] {
  if (!showStarredOnly) {
    return canvases;
  }

  return canvases.filter(canvas => canvas.isStarred);
}

export function withStarredCanvasState(canvases: Canvas[]): Canvas[] {
  return canvases.map(canvas => ({
    ...canvas,
    isStarred: canvas.userStatuses?.some(status => status.isStarred) ?? canvas.isStarred ?? false,
  }));
}
