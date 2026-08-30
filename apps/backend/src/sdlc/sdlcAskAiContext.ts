import { isBaselineCanvasType } from '@xyne/shared';
import type { WikiFreshnessContext } from './wiki/wikiFreshness';
import { wikiAskAiFreshnessInstruction } from './wiki/wikiFreshness';
import {
  buildSdlcTicketLifecycleInstruction,
  buildSdlcWorkDeliveryInstruction,
} from './sdlcTicketLifecyclePrompt';

export interface SdlcAskAiSelectedArtifact {
  canvasId: string;
  title: string;
  artifactKind: 'ARTIFACT' | 'WIKI' | 'BASELINE';
}

export function resolveSdlcAskAiArtifactKind(
  artifactType: string | null | undefined
): SdlcAskAiSelectedArtifact['artifactKind'] | undefined {
  if (!artifactType) return undefined;
  if (artifactType === 'WIKI') return 'WIKI';
  return isBaselineCanvasType(artifactType) ? 'BASELINE' : 'ARTIFACT';
}

export function resolveSdlcAskAiSelectedArtifact(
  canvas: { id: string; title: string; artifactType: string | null | undefined } | null | undefined
): SdlcAskAiSelectedArtifact | undefined {
  const artifactKind = resolveSdlcAskAiArtifactKind(canvas?.artifactType);
  return canvas && artifactKind
    ? { canvasId: canvas.id, title: canvas.title, artifactKind }
    : undefined;
}

interface SdlcAskAiContextInput {
  repo: {
    id: string;
    name: string;
    url: string;
  };
  channelId: string;
  /** The hub's other repositories. Named so the agent knows they exist; only `repo` is sandboxed. */
  otherRepos?: Array<{ id: string; name: string; url: string }>;
  baselineDocuments: Array<{ title: string; content: string }>;
  linkedContext: string[];
  wikiFreshness?: WikiFreshnessContext;
  selectedArtifact?: SdlcAskAiSelectedArtifact;
}

export function buildSdlcAskAiContext(input: SdlcAskAiContextInput): string {
  const repositoryAccessInstruction =
    'SDLC repository setup is uniformly write-capable; call sandbox-repo-setup with write:true when live code is required. Capability does not authorize mutation. For questions, PRDs, Tech Docs, reviews, and other non-implementation requests, inspect only: do not modify files, run builds or services, create commits, push, or create pull requests. Mutate the repository only when the user explicitly requests implementation work.';
  const implementationInstruction = `For an explicit implementation request, follow the approved repository conventions, create a safe non-default branch, and make only the requested changes. ${buildSdlcWorkDeliveryInstruction()} After remote push succeeds, call spaces-sdlc-create-pull-request exactly once. The backend must create and verify a draft pull request; never use a generic GitHub tool. ${buildSdlcTicketLifecycleInstruction()}`;
  const selectedArtifactInstruction = input.selectedArtifact
    ? [
        '# Selected SDLC artifact',
        `Title: ${input.selectedArtifact.title}`,
        `Artifact kind: ${input.selectedArtifact.artifactKind}`,
        `Canvas ID: ${input.selectedArtifact.canvasId}`,
        `Repository ID: ${input.repo.id}`,
        'This selected canvas is already an SDLC artifact. Never classify it as a regular canvas.',
        ...(input.selectedArtifact.artifactKind === 'ARTIFACT'
          ? [
              `When the user asks to modify this selected artifact, call spaces-sdlc-mutate-artifact with action update, canvasId ${input.selectedArtifact.canvasId}, and the complete updated markdown. Do not create a replacement artifact and do not fall back to generic canvas mutation tools.`,
            ]
          : []),
      ].join('\n')
    : 'No SDLC artifact is currently selected.';
  const canvasPreflight = [
    'For every non-implementation request, begin with this repository-knowledge preflight before using repository sandbox tools:',
    `1. Call spaces-search once with type: canvas and in: ${input.channelId}, using focused terms from the question.`,
    '2. Read up to three of the most relevant results with spaces-read-canvas. Prioritize imported Wiki pages; also read relevant PRDs and Tech Docs. Existing Wiki pages remain readable regardless of whether generation is running, failed, cancelled, complete, or based on an older commit.',
    '3. If those canvases fully and consistently support the requested answer or artifact, use them directly without opening a repository sandbox.',
    '4. If evidence is missing, incomplete, ambiguous, stale, or inconsistent, inspect the pinned repository using the uniform write-capable sandbox while obeying the non-mutation rule above. Current code is authoritative when it conflicts with Wiki or other canvases.',
    '5. If search returns no relevant canvas, say that explicitly and continue with repository inspection.',
    '6. Call sandbox-repo-setup at most once with write:true. If setup times out or fails, do not create another sandbox, clone through a raw provider URL, or repeatedly retry setup. Use complete and consistent Wiki or Repo Knowledge evidence when it is sufficient.',
    '7. If that evidence is insufficient, report that live code is unavailable and stop instead of guessing. Include the useful Wiki findings, the exact paths, symbols, or implementation questions you intended to inspect in code, and which claims remain unverified.',
    'Do not answer a substantive repository question without this preflight. Do not guess when repository knowledge is insufficient.',
    input.wikiFreshness
      ? wikiAskAiFreshnessInstruction(input.wikiFreshness)
      : 'Wiki freshness is unknown. Still read relevant existing Wiki pages as orientation, warn that they may be partial, stale, or inconsistent, inspect live code before factual repository claims, and disclose the freshness limitation.',
  ].join('\n');

  return [
    '# SDLC repository mode',
    `Repository: ${input.repo.name} (${input.repo.url})`,
    `SDLC repository ID: ${input.repo.id}`,
    `Repository channel ID: ${input.channelId}`,
    input.otherRepos?.length
      ? [
          'This hub contains other repositories. Only the repository above is pinned and inspectable in this session; to work in another one, ask the user to switch to it in the SDLC hub first.',
          ...input.otherRepos.map((other) => `- ${other.name} (${other.url}) - SDLC repository ID: ${other.id}`),
        ].join('\n')
      : 'This hub contains no other repositories.',
    repositoryAccessInstruction,
    implementationInstruction,
    selectedArtifactInstruction,
    'When the user explicitly asks to create an artifact (PRD, Tech Doc, or any custom type), resolve its type folderId with spaces-sdlc-list-artifact-types, then call spaces-sdlc-mutate-artifact with action create, that folderId, the trackId the artifact belongs to, title, and markdown. Pass this SDLC repository ID. Link existing artifacts the user names as related context via relatedCanvasIds. Creating these Spaces artifacts does not require writable repository access. Never use a generic canvas tool as fallback. If any tool says an action was queued for approval, the action is still pending: never mark the artifact as created or complete. Claim success only when spaces-sdlc-mutate-artifact returns the created SDLC artifact identity and URL. If the user says only "PR", ask whether they mean PRD or pull request before taking action. V1 creates the editable canvas immediately without a separate approval card.',
    'When creating an implementation ticket for an artifact, call spaces-create-ticket with both sdlcRepoId set to this SDLC repository ID and sourceCanvasId set to the artifact canvas ID. The ticket is not complete until the tool confirms the SDLC link; never create an unlinked fallback or a duplicate ticket.',
    canvasPreflight,
    'Use relevant repository Tickets, conversations, explicitly linked context, and repository-channel history as supporting evidence. Inspect the live pinned codebase only when the preflight rules require it. Keep every lookup subject to its existing authorization.',
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
