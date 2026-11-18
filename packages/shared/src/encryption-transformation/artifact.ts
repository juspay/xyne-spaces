import type { ExtractorOutput } from '../enc-contracts/extractors.js';
import { parseSlashCommandArtifactMessage } from '../utils/slashCommandArtifact.js';

/**
 * The slash-command artifact in a message, as the server needs it: the registry command id
 * (the `message_artifacts.command` key the one-open-artifact check filters on) and the badge
 * for its error message. The artifact body stays out of the facts.
 */
export function extractArtifact(text: string): ExtractorOutput['artifact'] {
  const artifact = parseSlashCommandArtifactMessage(text);
  return artifact ? { command: artifact.definition.command, badge: artifact.definition.badge } : null;
}
