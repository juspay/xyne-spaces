import type { Canvas } from './Canvas.types';

const EXCLUDED_CALL_GENERATED_SOURCES = new Set([
  'call_prd',
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

const RECORDING_GENERATED_SOURCES = new Set(['call_notes', 'call_detailed_summary']);

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

export function isExcludedRecordingGeneratedCanvas(canvas: Canvas): boolean {
  const source = getCanvasMetadataSource(canvas);
  return source ? RECORDING_GENERATED_SOURCES.has(source) : false;
}

export function getRecordingCanvasCallId(canvas: Canvas): string | null {
  if (!isExcludedRecordingGeneratedCanvas(canvas)) {
    return null;
  }

  const metadata = canvas.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const callId = (metadata as Record<string, unknown>)['callId'];
  return typeof callId === 'string' && callId ? callId : null;
}

export function filterExcludedRecordingGeneratedCanvases(
  canvases: Canvas[],
  excludeRecordingGeneratedCanvases: boolean,
): Canvas[] {
  if (!excludeRecordingGeneratedCanvases) {
    return canvases;
  }

  return canvases.filter(canvas => !isExcludedRecordingGeneratedCanvas(canvas));
}

export function isAnyCallGeneratedCanvas(canvas: Canvas): boolean {
  return isExcludedCallGeneratedCanvas(canvas) || isExcludedRecordingGeneratedCanvas(canvas);
}

export function filterStarredCanvases(canvases: Canvas[], showStarredOnly: boolean): Canvas[] {
  if (!showStarredOnly) {
    return canvases;
  }

  return canvases.filter(canvas => canvas.isStarred);
}

export function filterArchivedCanvases(
  canvases: Canvas[],
  options: { includeArchived?: boolean; onlyArchived?: boolean },
): Canvas[] {
  if (options.onlyArchived) {
    return canvases.filter(canvas => canvas.isArchived);
  }

  if (options.includeArchived) {
    return canvases;
  }

  return canvases.filter(canvas => !canvas.isArchived);
}

export function withStarredCanvasState(canvases: Canvas[]): Canvas[] {
  return canvases.map(canvas => ({
    ...canvas,
    isStarred: canvas.userStatuses?.some(status => status.isStarred) ?? canvas.isStarred ?? false,
  }));
}
