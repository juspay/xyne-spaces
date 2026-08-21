export interface SdlcArtifactCreationPromptInput {
  kind: 'PRD' | 'TECH_DOC';
  title: string;
  repositoryName: string;
  direction?: string;
  parentPrd?: { canvasId: string; title: string };
}

export function buildSdlcArtifactCreationPrompt(input: SdlcArtifactCreationPromptInput): string {
  const direction = input.direction?.trim();
  const repository = JSON.stringify(input.repositoryName);
  const title = JSON.stringify(input.title);
  const request =
    input.kind === 'TECH_DOC'
      ? input.parentPrd
        ? `Create a Tech Doc titled ${title} for the PRD ${JSON.stringify(input.parentPrd.title)} (canvas ID: ${input.parentPrd.canvasId}) in repository ${repository}.`
        : `Create a Tech Doc titled ${title} in repository ${repository}. It has no parent PRD.`
      : `Create a PRD titled ${title} in repository ${repository}.`;
  return direction ? `${request}\n\nUser direction: ${direction}` : request;
}
