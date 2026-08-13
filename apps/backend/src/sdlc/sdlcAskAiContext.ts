import type { WikiFreshnessContext } from './wiki/wikiFreshness';
import { wikiAskAiFreshnessInstruction } from './wiki/wikiFreshness';

interface SdlcAskAiContextInput {
  repo: {
    id: string;
    name: string;
    url: string;
  };
  channelId: string;
  baselineDocuments: Array<{ title: string; content: string }>;
  linkedContext: string[];
  wikiFreshness?: WikiFreshnessContext;
}

export function buildSdlcAskAiContext(input: SdlcAskAiContextInput): string {
  const canvasPreflight = [
    'Before using repository sandbox tools for any substantive repository question, perform this canvas preflight:',
    `1. Call spaces-search once with type: canvas and in: ${input.channelId}, using focused terms from the question.`,
    '2. Read up to three of the most relevant results with spaces-read-canvas before inspecting live code. Prioritize imported Wiki pages; also read relevant PRDs and Tech Docs.',
    '3. If search returns no relevant canvas, say that explicitly and continue with repository inspection.',
    'Do not answer a substantive repository question without this canvas preflight. Do not treat repository code as a substitute for checking the repository knowledge canvases.',
    input.wikiFreshness
      ? wikiAskAiFreshnessInstruction(input.wikiFreshness)
      : 'Wiki freshness is unknown. Use the Wiki only for orientation, inspect live code before factual repository claims, and disclose the freshness limitation.',
  ].join('\n');

  return [
    '# SDLC repository mode',
    `Repository: ${input.repo.name} (${input.repo.url})`,
    `SDLC repository ID: ${input.repo.id}`,
    `Repository channel ID: ${input.channelId}`,
    'When the user explicitly asks to create a PRD or Tech Doc, use spaces-sdlc-create-artifact instead of spaces-create-canvas. Pass this SDLC repository ID. A Tech Doc must be linked to an existing parent PRD canvas; ask which PRD when it is ambiguous. V1 creates the editable canvas immediately without a separate approval card.',
    canvasPreflight,
    'After the canvas preflight, inspect the live pinned codebase and relevant repository Tickets, conversations, explicitly linked context, and repository-channel history. Keep every lookup subject to its existing authorization.',
    'The approved baseline documents below are already loaded into this session. Use them directly; do not spend tool calls rediscovering their canvas IDs.',
    'Use repository tools for live code rather than Vespa. For code answers, show the smallest relevant code excerpt first, then explain it and cite the exact repository-relative path, symbol, and line range. Do not claim code was indexed in Vespa and do not invent provider links.',
    'Claims drawn from Wiki, PRD, Tech Doc, Ticket, or conversation tools must retain the exact inline citation tokens returned by those tools. If sources disagree or a source category has no useful evidence, say so plainly.',
    input.baselineDocuments.length > 0
      ? input.baselineDocuments
          .map((memory) => `## ${memory.title}\n${memory.content}`)
          .join('\n\n')
      : 'No approved baseline memory is available yet.',
    '# Explicitly linked context',
    input.linkedContext.join('\n\n') || 'No accessible linked context is available.',
  ].join('\n\n');
}
