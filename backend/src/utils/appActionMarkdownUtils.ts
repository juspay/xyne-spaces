import { logger } from './logger';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { db } from '@/database/client';
import { messageMetadataService } from '@/services/messageMetadataService';

function parseFrontmatter(markdown: string): { data: Record<string, unknown>; end: number } | null {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .parse(markdown);

  for (const node of tree.children) {
    if (node.type === 'yaml') {
      try {
        const data = yamlLoad(node.value) as Record<string, unknown>;
        return { data, end: node.position?.end.offset ?? 0 };
      } catch (error) {
        logger.error('Failed to parse app action YAML frontmatter', { error });
        return null;
      }
    }
  }

  return null;
}

/**
 * Move an app action from appActions[] to actioned[] in message frontmatter.
 * Updates the message content in the database.
 */
export async function updateAppActionStatus(
  messageId: string,
  actionId: string,
): Promise<void> {
  const message = await db.message.findUnique({
    where: { messageId },
    select: { content: true, conversationId: true },
  });

  if (!message) {
    throw new Error(`Message ${messageId} not found`);
  }

  const frontmatter = parseFrontmatter(message.content);
  if (!frontmatter) return;

  const { data, end } = frontmatter;
  const appActions = Array.isArray(data['appActions']) ? data['appActions'] as Record<string, unknown>[] : [];
  const actioned = Array.isArray(data['actioned']) ? data['actioned'] as Record<string, unknown>[] : [];

  // Find the clicked action
  const clickedAction = appActions.find((a) => a['actionId'] === actionId);
  if (!clickedAction) return;

  // Reusable actions stay active after click — don't move to actioned[]
  if (clickedAction['reusable'] === true) return;

  // Move ALL actions to actioned — the clicked one is marked, others are dismissed
  const now = new Date().toISOString();
  for (const action of appActions) {
    actioned.push({
      actionId: action['actionId'],
      label: action['label'] ?? '',
      color: action['actionId'] === actionId ? (action['color'] ?? '#6b7280') : '#6b7280',
      actionedAt: now,
    });
  }

  // Rebuild frontmatter — no more active actions
  const updatedData: Record<string, unknown> = { ...data };
  delete updatedData['appActions'];
  updatedData['actioned'] = actioned;

  const newFrontmatter = '---\n' + yamlDump(updatedData) + '---\n';
  const contentAfter = message.content.substring(end);
  const updatedContent = newFrontmatter + contentAfter;

  await db.message.update({
    where: { messageId },
    data: { content: updatedContent, edited: true },
  });

  // Sync to conversations.initial_message_md so Zero picks up the change
  await messageMetadataService.syncInitialMessageMd(message.conversationId);
}
