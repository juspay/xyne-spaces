const AI_KNOWLEDGE_SEGMENT = '/ai/knowledge';
const KB_SEGMENT = '/knowledge-base';

// The KB folder browser and file viewer are reachable from two routes — the
// standalone /knowledge-base screen and the embedded /ai/knowledge screen —
// sharing the same components (KbContentsShell, KnowledgeBaseV2Screen,
// FileViewerLayout). Every navigation built from inside those components
// (opening a folder, opening a file, going back from the viewer) must stay
// under whichever of the two the user is currently on, rather than always
// hopping to /knowledge-base. This resolves that base path from the current
// location, workspace prefix included.
export function resolveKbBasePath(pathname: string): string {
  const aiIndex = pathname.indexOf(AI_KNOWLEDGE_SEGMENT);
  if (aiIndex !== -1) return pathname.slice(0, aiIndex + AI_KNOWLEDGE_SEGMENT.length);
  const kbIndex = pathname.indexOf(KB_SEGMENT);
  if (kbIndex !== -1) return pathname.slice(0, kbIndex + KB_SEGMENT.length);
  return KB_SEGMENT;
}
