import type { ShortcutScope } from './shortcutsRegistry';

export interface ShortcutDefinition {
  keys: string | string[];
  displayKeys?: string[];
  electronOnly?: boolean;
  scope?: ShortcutScope;
  priority?: number;
  allowInInputs?: boolean;
  preventDefault?: boolean;
  useKey?: boolean;
  description?: string;
  category?: string;
  when?: (event: KeyboardEvent) => boolean;
}

export const shortcuts = {
  // ===== GLOBAL NAVIGATION =====
  'global.search': {
    keys: ['mod+k', 'mod+g'],
    scope: 'global',
    allowInInputs: true,
    priority: 100,
    description: 'Global search',
    category: 'Navigation',
  },
  'global.findInChannel': {
    keys: 'mod+f',
    scope: 'global',
    allowInInputs: true,
    priority: 50,
    description: 'Search in current',
    category: 'Navigation',
    preventDefault: true,
  },
  'global.openCommandMode': {
    keys: 'mod+/',
    scope: 'global',
    allowInInputs: true,
    priority: 100,
    description: 'Open command mode',
    category: 'Navigation',
    useKey: true,
  },
  'global.openCanvasTab': {
    keys: ['mod+shift+n'],
    // Browsers reserve this for a new incognito/private window.
    electronOnly: true,
    scope: 'channel',
    description: 'Open canvas tab',
    category: 'Navigation',
    priority: 50,
    allowInInputs: true,
  },
  'global.goBack': {
    keys: ['mod+['],
    scope: 'global',
    description: 'Go back in navigation history',
    category: 'Navigation',
    priority: 50,
    allowInInputs: true,
    useKey: true,
  },
  'global.goForward': {
    keys: ['mod+]'],
    scope: 'global',
    description: 'Go forward in navigation history',
    category: 'Navigation',
    priority: 50,
    allowInInputs: true,
    useKey: true,
  },
  'global.goToRailItem': {
    keys: ['mod+1', 'mod+2', 'mod+3', 'mod+4', 'mod+5', 'mod+6', 'mod+7', 'mod+8', 'mod+9'],
    displayKeys: ['mod+1', 'mod+9'],
    // In a browser these keys switch tabs, so the rail only claims them in Electron.
    electronOnly: true,
    scope: 'global',
    allowInInputs: true,
    priority: 50,
    description: 'Jump to sidebar item 1-9',
    category: 'Navigation',
  },
  'global.openActivity': {
    keys: 'mod+shift+a',
    scope: 'global',
    description: 'Open the Activity tab',
    category: 'Navigation',
    priority: 50,
    allowInInputs: true,
  },
  'global.openThreads': {
    keys: 'mod+shift+t',
    // Browsers reserve this for "reopen closed tab".
    electronOnly: true,
    scope: 'global',
    description: 'Open the Threads view',
    category: 'Navigation',
    priority: 50,
    allowInInputs: true,
  },
  'global.openShortcutsHelp': {
    keys: 'mod+shift+/',
    scope: 'global',
    description: 'Show keyboard shortcuts help',
    category: 'Navigation',
    priority: 100,
    allowInInputs: true,
    useKey: true,
  },
  'global.toggleRightSidebar': {
    keys: 'mod+.',
    scope: 'global',
    description: 'Close thread panel',
    category: 'Navigation',
    priority: 50,
    allowInInputs: true,
    useKey: true,
  },
  'global.composeMessage': {
    keys: 'mod+n',
    // Browsers reserve this for a new window.
    electronOnly: true,
    scope: 'global',
    description: 'Compose a new message',
    category: 'Navigation',
    priority: 200,
    allowInInputs: true,
    preventDefault: true,
    useKey: true,
  },
  'recording.start': {
    keys: 'mod+alt+x',
    // Bound by the Electron main process (RECORDING_SHORTCUT), never by the
    // renderer — so the combo does not exist in a browser tab.
    electronOnly: true,
    scope: 'global',
    description: 'Start or stop recording',
    category: 'Recording',
    priority: 50,
    preventDefault: true,
  },

  'global.openPreferences': {
    keys: 'mod+comma',
    scope: 'global',
    description: 'Open preferences',
    category: 'Navigation',
    priority: 50,
    allowInInputs: true,
    preventDefault: true,
  },
  'global.setStatus': {
    keys: 'mod+shift+y',
    scope: 'global',
    description: 'Set a status',
    category: 'Navigation',
    priority: 50,
    allowInInputs: true,
    preventDefault: true,
  },

  'composer.voiceInput': {
    keys: 'mod+shift+m',
    scope: 'global',
    allowInInputs: true,
    priority: 100,
    description: 'Toggle voice input in composer',
    category: 'Composer',
    preventDefault: true,
  },
  'global.toggleBrowser': {
    keys: 'mod+shift+b',
    scope: 'global',
    description: 'Toggle between Xyne and the in-app browser',
    category: 'Navigation',
    priority: 50,
    allowInInputs: true,
    useKey: true,
  },
  // ===== SDLC HUB =====
  'sdlc.toggleSidebarDock': {
    keys: 'mod+\\',
    scope: 'global',
    description: 'Dock or undock the hub sidebar',
    category: 'SDLC',
    preventDefault: true,
  },
  'sdlc.focusSidebar': {
    keys: 'mod+shift+s',
    scope: 'global',
    description: 'Focus the hub sidebar',
    category: 'SDLC',
    preventDefault: true,
  },
  'sdlc.sidebarDown': {
    keys: ['down', 'j'],
    scope: 'sdlc-sidebar',
    description: 'Next item in the sidebar',
    category: 'SDLC',
    preventDefault: true,
  },
  'sdlc.sidebarUp': {
    keys: ['up', 'k'],
    scope: 'sdlc-sidebar',
    description: 'Previous item in the sidebar',
    category: 'SDLC',
    preventDefault: true,
  },
  'sdlc.focusTickets': {
    keys: 'mod+shift+k',
    scope: 'global',
    description: 'Focus the ticket list',
    category: 'SDLC',
    preventDefault: true,
  },
  'sdlc.focusFinder': {
    keys: 'mod+shift+e',
    scope: 'global',
    description: 'Focus the artifact browser',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.down': {
    keys: ['down', 'j'],
    scope: 'sdlc-finder',
    description: 'Next item',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.up': {
    keys: ['up', 'k'],
    scope: 'sdlc-finder',
    description: 'Previous item',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.into': {
    keys: ['right', 'l'],
    scope: 'sdlc-finder',
    description: 'Go into folder',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.out': {
    keys: ['left', 'h'],
    scope: 'sdlc-finder',
    description: 'Back to parent folder',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.open': {
    keys: 'enter',
    scope: 'sdlc-finder',
    description: 'Open without leaving this level',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.rename': {
    keys: 'r',
    scope: 'sdlc-finder',
    description: 'Rename folder',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.preview': {
    keys: 'shift+enter',
    scope: 'sdlc-finder',
    description: 'Preview artifact',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.closePreview': {
    keys: 'escape',
    scope: 'global',
    description: 'Close the artifact preview',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.openInWindow': {
    keys: 'mod+enter',
    scope: 'sdlc-finder',
    description: 'Open artifact in a new window',
    category: 'SDLC',
    preventDefault: true,
  },
  'finder.newFolder': {
    keys: 'n',
    scope: 'sdlc-finder',
    description: 'New folder here',
    category: 'SDLC',
  },
  'finder.newArtifact': {
    keys: 'shift+n',
    scope: 'sdlc-finder',
    description: 'New artifact here',
    category: 'SDLC',
  },
  'finder.discuss': {
    keys: 'd',
    scope: 'sdlc-finder',
    description: "Open the folder's conversations",
    category: 'SDLC',
  },
  'finder.trackDiscuss': {
    keys: 'shift+d',
    scope: 'sdlc-finder',
    description: "Open the track's conversations",
    category: 'SDLC',
  },
  'tickets.down': {
    keys: ['down', 'j'],
    scope: 'sdlc-tickets',
    description: 'Next ticket',
    category: 'SDLC',
    preventDefault: true,
  },
  'tickets.up': {
    keys: ['up', 'k'],
    scope: 'sdlc-tickets',
    description: 'Previous ticket',
    category: 'SDLC',
    preventDefault: true,
  },
  'tickets.open': {
    keys: 'enter',
    scope: 'sdlc-tickets',
    description: 'Open ticket',
    category: 'SDLC',
    preventDefault: true,
  },
  // ===== SIDEBAR NAVIGATION =====
  'sidebar.resizeLeft': {
    keys: '[',
    scope: 'global',
    description: 'Resize left sidebar (shrink)',
    category: 'Sidebar',
    allowInInputs: false,
    priority: 10,
    useKey: true,
  },
  'sidebar.resizeRight': {
    keys: ']',
    scope: 'global',
    description: 'Resize left sidebar (expand)',
    category: 'Sidebar',
    allowInInputs: false,
    priority: 10,
    useKey: true,
  },

  'sidebar.nextConversation': {
    keys: 'alt+down',
    scope: 'global',
    description: 'Go to next conversation in the sidebar',
    category: 'Sidebar',
    allowInInputs: true,
    priority: 20,
    preventDefault: true,
  },
  'sidebar.prevConversation': {
    keys: 'alt+up',
    scope: 'global',
    description: 'Go to previous conversation in the sidebar',
    category: 'Sidebar',
    allowInInputs: true,
    priority: 20,
    preventDefault: true,
  },
  'sidebar.nextUnreadConversation': {
    keys: 'alt+shift+down',
    scope: 'global',
    description: 'Go to next unread conversation in the sidebar',
    category: 'Sidebar',
    allowInInputs: true,
    priority: 20,
    preventDefault: true,
  },
  'sidebar.prevUnreadConversation': {
    keys: 'alt+shift+up',
    scope: 'global',
    description: 'Go to previous unread conversation in the sidebar',
    category: 'Sidebar',
    allowInInputs: true,
    priority: 20,
    preventDefault: true,
  },

  // ===== MESSAGE ACTIONS =====
  'message.edit': {
    keys: 'e',
    scope: 'channel',
    description: 'Edit message',
    category: 'Messages',
    allowInInputs: false,
    priority: 30,
  },
  'message.delete': {
    keys: ['delete', 'backspace'],
    scope: 'channel',
    description: 'Delete message',
    category: 'Messages',
    allowInInputs: false,
    priority: 30,
  },
  'message.pin': {
    keys: 'p',
    scope: 'channel',
    description: 'Pin message',
    category: 'Messages',
    allowInInputs: false,
    priority: 30,
  },
  'message.bookmark': {
    keys: ['b', 'a'],
    scope: 'channel',
    description: 'Bookmark message',
    category: 'Messages',
    allowInInputs: false,
    priority: 30,
  },
  'message.copyLink': {
    keys: 'l',
    scope: 'channel',
    description: 'Copy message link',
    category: 'Messages',
    allowInInputs: false,
    priority: 30,
  },
  'message.copyContent': {
    keys: 'mod+shift+c',
    scope: 'channel',
    description: 'Copy message content',
    category: 'Messages',
    allowInInputs: false,
    priority: 30,
  },

  // ===== COMPOSER SHORTCUTS =====
  'composer.attach': {
    // Not mod+u: that is TipTap's underline binding inside the composer.
    keys: 'mod+o',
    scope: 'composer',
    allowInInputs: true,
    description: 'Attach files',
    category: 'Composer',
  },
  'composer.cancelEdit': {
    keys: 'esc',
    scope: 'composer',
    priority: 40,
    allowInInputs: true,
    description: 'Cancel editing',
    category: 'Composer',
  },
  'composer.editLastMessage': {
    keys: 'mod+up',
    scope: 'composer',
    priority: 60,
    allowInInputs: true,
    description: 'Edit your last message',
    category: 'Composer',
  },

  // ===== HUDDLE SHORTCUTS =====
  'huddle.toggle': {
    keys: 'mod+shift+h',
    scope: 'global',
    description: 'Start, join, leave or end a huddle',
    category: 'Huddle',
    priority: 50,
  },
  'huddle.pushToTalk': {
    keys: 'space',
    scope: 'global',
    description: 'Push-to-talk (hold spacebar to temporarily unmute)',
    category: 'Huddle',
    priority: 200,
    allowInInputs: false,
  },
  'huddle.toggleMute': {
    keys: 'mod+d',
    scope: 'global',
    description: 'Toggle mute',
    category: 'Huddle',
    priority: 100,
    allowInInputs: true,
    preventDefault: true,
  },
  'huddle.toggleVideo': {
    keys: 'mod+e',
    scope: 'global',
    description: 'Toggle video',
    category: 'Huddle',
    priority: 100,
    allowInInputs: true,
    preventDefault: true,
  },

  // ===== CANVAS SHORTCUTS =====
  'canvas.save': {
    keys: 'mod+s',
    scope: 'canvas',
    allowInInputs: true,
    description: 'Save canvas',
    category: 'Canvas',
    priority: 100,
  },
  'canvas.search': {
    keys: 'mod+f',
    scope: 'canvas',
    allowInInputs: true,
    description: 'Search in canvas',
    category: 'Canvas',
    priority: 100,
  },

  // ===== VIEWER SHORTCUTS =====
  'viewer.video': {
    keys: ['space', 'm', 'f', 'left', 'right', 'up', 'down'],
    scope: 'viewer',
    description: 'Video viewer controls',
    category: 'Viewer',
  },
  'viewer.image.controls': {
    keys: ['mod+shift+equal', 'mod+add', 'mod+minus', 'mod+subtract', 'mod+0', 'mod+r'],
    scope: 'viewer',
    preventDefault: false,
    description: 'Image zoom and rotate',
    category: 'Viewer',
  },
  'viewer.image.pan': {
    keys: ['up', 'down', 'left', 'right'],
    scope: 'viewer',
    preventDefault: false,
  },
  // 'global.findInChannel' also binds mod+f, but the viewer pushes the 'viewer'
  // scope while open and resolveShortcut ranks scope above priority — so this
  // wins whenever a file preview is on screen, and channel find is untouched
  // otherwise. allowInInputs keeps mod+f working while the find input is focused
  // (it refocuses/selects), and preventDefault suppresses the browser's own find.
  'viewer.find': {
    keys: 'mod+f',
    scope: 'viewer',
    priority: 200,
    allowInInputs: true,
    preventDefault: true,
    description: 'Find in file',
    category: 'Viewer',
  },
  'viewer.findNext': {
    keys: 'mod+g',
    scope: 'viewer',
    priority: 200,
    allowInInputs: true,
    preventDefault: true,
    description: 'Find next match',
    category: 'Viewer',
  },
  'viewer.findPrevious': {
    keys: 'mod+shift+g',
    scope: 'viewer',
    priority: 200,
    allowInInputs: true,
    preventDefault: true,
    description: 'Find previous match',
    category: 'Viewer',
  },

  // ===== MODAL SHORTCUTS =====
  'modal.close': {
    keys: 'esc',
    scope: 'modal',
    priority: 100,
    allowInInputs: true,
    description: 'Close modal',
    category: 'Navigation',
  },

  // ===== COMMAND MENU =====
  'command.close': {
    keys: 'esc',
    scope: 'command',
    priority: 100,
    allowInInputs: true,
    description: 'Close command menu',
    category: 'Navigation',
  },
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof shortcuts;

/**
 * Get all shortcuts grouped by category
 */
export const getShortcutsByCategory = (): Record<
  string,
  Array<ShortcutDefinition & { id: ShortcutId }>
> => {
  const grouped: Record<string, Array<ShortcutDefinition & { id: ShortcutId }>> = {};

  (Object.entries(shortcuts) as Array<[ShortcutId, ShortcutDefinition]>).forEach(
    ([id, definition]) => {
      const category = definition.category || 'Other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push({ id, ...definition });
    },
  );

  return grouped;
};

/**
 * Get shortcut definition by ID
 */
export const getShortcut = (id: ShortcutId): ShortcutDefinition | undefined => {
  return shortcuts[id];
};

/**
 * Find conflicting shortcuts (same keys in same scope)
 */
export const findConflicts = (): Array<{ key: string; scope: string; ids: ShortcutId[] }> => {
  const conflicts: Array<{ key: string; scope: string; ids: ShortcutId[] }> = [];
  const registry = new Map<string, Map<string, ShortcutId[]>>();

  (Object.entries(shortcuts) as Array<[ShortcutId, ShortcutDefinition]>).forEach(
    ([id, definition]) => {
      const keys = Array.isArray(definition.keys) ? definition.keys : [definition.keys];
      const scope = definition.scope || 'global';

      keys.forEach(key => {
        if (!registry.has(key)) {
          registry.set(key, new Map());
        }
        const scopeMap = registry.get(key)!;
        if (!scopeMap.has(scope)) {
          scopeMap.set(scope, []);
        }
        scopeMap.get(scope)!.push(id);
      });
    },
  );

  registry.forEach((scopeMap, key) => {
    scopeMap.forEach((ids, scope) => {
      if (ids.length > 1) {
        conflicts.push({ key, scope, ids });
      }
    });
  });

  return conflicts;
};
