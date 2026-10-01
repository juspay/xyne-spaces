import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { useClawKnowledgeBaseTree } from '@/hooks/useClawKnowledgeBaseTree';
import { useClawMcp } from '@/hooks/useClawMcp';
import { useClawSkills } from '@/hooks/useClawSkills';
import { useClawSubagents } from '@/hooks/useClawSubagents';

/**
 * Loads what the tools rows need to draw their pills when the create page opens.
 * A row the chat fills then shows its pills on its first frame, instead of a
 * lone "+ Add" that the pills push aside once the catalog arrives.
 */
export function WarmHubCatalogs(): null {
  useClawAvailableTools();
  useClawMcp();
  useClawSubagents();
  useClawSkills();
  useClawKnowledgeBaseTree();
  return null;
}
