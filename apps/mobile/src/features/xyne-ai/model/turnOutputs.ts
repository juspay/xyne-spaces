import type { BriefCitation } from '@/src/features/morning-brief/api/dailyBriefApi';

import type { ToolInvocation } from '../api/xyneAIEvents';

/** Pages the agent asked the app to open, once per tool call. */
export function openUrlTargets(tools: ToolInvocation[]): string[] {
  const urls = tools.flatMap(({ toolName, args, isError }) => {
    const url = typeof args['url'] === 'string' ? args['url'].trim() : '';
    return toolName === 'open-url' && !isError && /^https?:\/\//i.test(url) ? [url] : [];
  });
  return [...new Set(urls)];
}

/** Canvases the run created; the tool cites each one it makes. */
export function createdCanvases(tools: ToolInvocation[]): BriefCitation[] {
  const canvases = tools
    .filter(
      ({ toolName, status, isError }) =>
        /create-canvas$/.test(toolName) && status === 'completed' && !isError,
    )
    .flatMap(({ citations }) => citations?.filter(({ kind }) => kind === 'canvas') ?? []);
  return [
    ...new Map(canvases.map(canvas => [canvas.viewAccessId ?? canvas.canvasId, canvas])).values(),
  ];
}
