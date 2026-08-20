export interface SdlcArtifactCreationPromptInput {
  kind: 'PRD' | 'TECH_DOC';
  title: string;
  repositoryName: string;
  direction?: string;
  parentPrd?: { canvasId: string; title: string };
  track?: { id: string; name: string };
}

export function buildSdlcArtifactCreationPrompt(input: SdlcArtifactCreationPromptInput): string {
  const direction = input.direction?.trim();
  const request =
    input.kind === 'TECH_DOC' && input.parentPrd
      ? `Create a Tech Doc titled ${JSON.stringify(input.title)} for the PRD ${JSON.stringify(input.parentPrd.title)} (canvas ID: ${input.parentPrd.canvasId}) in repository ${JSON.stringify(input.repositoryName)}.`
      : input.kind === 'PRD' && input.track
        ? `Create a PRD titled ${JSON.stringify(input.title)} in repository ${JSON.stringify(input.repositoryName)} inside the SDLC track ${JSON.stringify(input.track.name)}. Pass trackId ${JSON.stringify(input.track.id)} in the spaces-sdlc-mutate-artifact create call so the PRD is assigned to that track.`
        : `Create a PRD titled ${JSON.stringify(input.title)} in repository ${JSON.stringify(input.repositoryName)}.`;
  return direction ? `${request}\n\nUser direction: ${direction}` : request;
}
