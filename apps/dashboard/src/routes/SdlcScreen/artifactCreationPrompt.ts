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
    `Pass folderId ${JSON.stringify(
      input.folderId,
    )} in the spaces-sdlc-mutate-artifact create call so it is filed under the ${typeLabel} type.` +
    relatedClause;
  return direction ? `${request}\n\nUser direction: ${direction}` : request;
}

export interface SdlcWikiPageCreationPromptInput {
  title: string;
  repositoryName?: string;
  repoId?: string;
  folderPath?: string;
  direction?: string;
}

export function buildSdlcWikiPageCreationPrompt(input: SdlcWikiPageCreationPromptInput): string {
  const direction = input.direction?.trim();
  const scope = input.repositoryName
    ? `the Wiki of repository ${JSON.stringify(input.repositoryName)}`
    : "this hub's own Wiki";
  const folder = input.folderPath ? `folderPath ${JSON.stringify(input.folderPath)}, ` : '';
  // Omitting the repository would hand the page to the run's pinned one.
  const repos = input.repoId
    ? `repoIds [${JSON.stringify(input.repoId)}]`
    : 'an empty repoIds array';
  const request =
    `Write a Wiki page titled ${JSON.stringify(input.title)} in ${scope}, and nowhere else. ` +
    `Call spaces-sdlc-mutate-artifact with artifactType "WIKI", action "create", ` +
    `title ${JSON.stringify(input.title)}, ${folder}${repos} so it is filed there.`;
  return direction ? `${request}\n\nUser direction: ${direction}` : request;
}
