import type { Message } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

export interface AttachedLocalFolder {
  path: string;
  name: string;
  branch?: string;
  remote?: string;
}

export function attachedLocalFolder(messages: Message[]): AttachedLocalFolder | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.type !== 'user') continue;
    const item = (message.attachedContext ?? []).find(entry => entry.type === 'local-folder');
    if (!item) continue;
    const metadata: Record<string, unknown> = item.metadata ?? {};
    const path = typeof metadata['path'] === 'string' ? metadata['path'] : item.id;
    const branch = typeof metadata['branch'] === 'string' ? metadata['branch'] : undefined;
    const remote = typeof metadata['remote'] === 'string' ? metadata['remote'] : undefined;
    return {
      path,
      name: item.title,
      ...(branch ? { branch } : {}),
      ...(remote ? { remote } : {}),
    };
  }
  return null;
}
