export interface SdlcArtifactCreationPromptInput {
  typeLabel: string;
  folderId: string;
  title: string;
  repositoryName?: string;
  direction?: string;
  relatedArtifacts?: Array<{ canvasId: string; title: string }>;
  track?: { id: string; name: string };
}

export function buildSdlcArtifactCreationPrompt(input: SdlcArtifactCreationPromptInput): string {
  const direction = input.direction?.trim();
  const repository = input.repositoryName
    ? `repository ${JSON.stringify(input.repositoryName)}`
    : 'this SDLC hub';
  const title = JSON.stringify(input.title);
  const typeLabel = input.typeLabel;
  const trackClause = input.track
    ? ` inside the SDLC track ${JSON.stringify(input.track.name)} (pass trackId ${JSON.stringify(
        input.track.id,
      )})`
    : '';
  const relatedClause =
    input.relatedArtifacts && input.relatedArtifacts.length > 0
      ? ` Use these related artifacts as context and pass their canvas IDs as relatedCanvasIds in the create call so they are linked: ${input.relatedArtifacts
          .map(item => `${JSON.stringify(item.title)} (canvas ID: ${item.canvasId})`)
          .join(', ')}.`
      : '';
  const request =
    `Create a ${typeLabel} titled ${title} in ${repository}${trackClause}. ` +
    `Pass artifactTypeId ${JSON.stringify(
      input.folderId,
    )} in the spaces-sdlc-write-artifact create call so it is filed under the ${typeLabel} type.` +
    relatedClause;
  return direction ? `${request}\n\nUser direction: ${direction}` : request;
}
