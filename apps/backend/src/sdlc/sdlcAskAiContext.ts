import {
  buildSdlcTicketLifecycleInstruction,
  buildSdlcWorkDeliveryInstruction,
} from './sdlcTicketLifecyclePrompt';

export interface SdlcAskAiSelectedArtifact {
  canvasId: string;
  title: string;
  artifactKind: 'ARTIFACT' | 'WIKI';
}

export function resolveSdlcAskAiArtifactKind(
  artifactType: string | null | undefined
): SdlcAskAiSelectedArtifact['artifactKind'] | undefined {
  if (!artifactType) return undefined;
  if (artifactType === 'WIKI') return 'WIKI';
  return 'ARTIFACT';
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
  linkedContext: string[];
  selectedArtifact?: SdlcAskAiSelectedArtifact;
}

export function buildSdlcAskAiContext(input: SdlcAskAiContextInput): string {
  const repositoryAccessInstruction =
    'SDLC repository access is uniformly write-capable; when live code is required, call sandbox-create, then sdlc-repository-access with the repository id, and clone with the exact cloneUrl it returns. Capability does not authorize mutation. For questions, PRDs, Tech Docs, reviews, and other non-implementation requests, inspect only: do not modify files, run builds or services, create commits, push, or create pull requests. Mutate the repository only when the user explicitly requests implementation work.';
  const implementationInstruction = `For an explicit implementation request, follow the approved repository conventions, create a safe non-default branch, and make only the requested changes. ${buildSdlcWorkDeliveryInstruction()} After remote push succeeds, call spaces-sdlc-create-pull-request exactly once. The backend creates and verifies the pull request, as a draft unless every check passed and the change is ready for review; never use a generic GitHub or Bitbucket tool. ${buildSdlcTicketLifecycleInstruction()}`;
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
              `When the user asks to modify this selected artifact, call spaces-sdlc-write-artifact with action update, canvasId ${input.selectedArtifact.canvasId}, and the complete updated markdown. Do not create a replacement artifact and do not fall back to generic canvas mutation tools.`,
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
    '6. Call sdlc-repository-access at most once per repository. If it times out or fails, do not create another sandbox, clone through any other URL, or repeatedly retry. Use complete and consistent Wiki or Hub Knowledge evidence when it is sufficient.',
    '7. If that evidence is insufficient, report that live code is unavailable and stop instead of guessing. Include the useful Wiki findings, the exact paths, symbols, or implementation questions you intended to inspect in code, and which claims remain unverified.',
    'Do not answer a substantive repository question without this preflight. Do not guess when repository knowledge is insufficient.',
    'Wiki pages may be outdated. Use them for orientation, then check the live code before stating how something works; when the Wiki and the code disagree, the code wins.',
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
    'When the user explicitly asks to create an artifact (PRD, Tech Doc, or any custom type), resolve its artifact type with spaces-sdlc-list-artifact-types, then call spaces-sdlc-write-artifact with action create, that id as artifactTypeId, the trackId the artifact belongs to, optionally a trackFolderId (a folder inside that track, from spaces-sdlc-list-tracks), title, and markdown. Pass this SDLC repository ID in repoIds and the repository channel ID as channelId. Link existing artifacts the user names as related context via relatedCanvasIds. Creating these Spaces artifacts does not require writable repository access. Never use a generic canvas tool as fallback. If any tool says an action was queued for approval, the action is still pending: never mark the artifact as created or complete. Claim success only when spaces-sdlc-write-artifact returns the created SDLC artifact identity and URL. If the user says only "PR", ask whether they mean PRD or pull request before taking action. V1 creates the editable canvas immediately without a separate approval card.',
    'When creating an implementation ticket for an artifact, call spaces-create-ticket with both sdlcRepoId set to this SDLC repository ID and sourceCanvasId set to the artifact canvas ID. The ticket is not complete until the tool confirms the SDLC link; never create an unlinked fallback or a duplicate ticket.',
    canvasPreflight,
    'Use relevant repository Tickets, conversations, explicitly linked context, and repository-channel history as supporting evidence. Inspect the live pinned codebase only when the preflight rules require it. Keep every lookup subject to its existing authorization.',
    'Use repository tools for live code rather than Vespa. For code answers, show the smallest relevant code excerpt first, then explain it and cite the exact repository-relative path, symbol, and line range. Do not claim code was indexed in Vespa and do not invent provider links.',
    'Claims drawn from Wiki, PRD, Tech Doc, Ticket, or conversation tools must retain the exact inline citation tokens returned by those tools. If sources disagree or a source category has no useful evidence, say so plainly.',
    '# Explicitly linked context',
    input.linkedContext.join('\n\n') || 'No accessible linked context is available.',
  ].join('\n\n');
}
