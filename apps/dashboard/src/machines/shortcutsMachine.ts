import { setup, assign, createActor } from 'xstate';
import type { ShortcutScope } from '../shortcuts/shortcutsRegistry';

interface ShortcutsContext {
  scopeStack: ShortcutScope[];
  registeredKeys: string[];
}

type ShortcutsEvent =
  | { type: 'PUSH_SCOPE'; scope: ShortcutScope }
  | { type: 'POP_SCOPE'; scope: ShortcutScope }
  | { type: 'RESET_SCOPES'; scopes: ShortcutScope[] }
  | { type: 'UPDATE_KEYS'; keys: string[] };

const DEFAULT_SCOPE: ShortcutScope = 'global';

export const shortcutsMachine = setup({
  types: {
    context: {} as ShortcutsContext,
    events: {} as ShortcutsEvent,
  },
  actions: {
    pushScope: assign({
      scopeStack: ({ context, event }) => {
        if (event.type !== 'PUSH_SCOPE') return context.scopeStack;
        if (!event.scope || event.scope === DEFAULT_SCOPE) return context.scopeStack;
        return [...context.scopeStack, event.scope];
      },
    }),
    popScope: assign({
      scopeStack: ({ context, event }) => {
        if (event.type !== 'POP_SCOPE') return context.scopeStack;
        if (!event.scope || event.scope === DEFAULT_SCOPE) return context.scopeStack;

        const stack = [...context.scopeStack];
        const index = stack.lastIndexOf(event.scope);
        if (index === -1) return stack;

        stack.splice(index, 1);
        return stack.length > 0 ? stack : [DEFAULT_SCOPE];
      },
    }),
    resetScopes: assign({
      scopeStack: ({ event }) => {
        if (event.type !== 'RESET_SCOPES') return [DEFAULT_SCOPE];
        const scopes = event.scopes.filter(Boolean);
        return scopes.includes(DEFAULT_SCOPE) ? scopes : [DEFAULT_SCOPE, ...scopes];
      },
    }),
    updateKeys: assign({
      registeredKeys: ({ event }) => {
        if (event.type !== 'UPDATE_KEYS') return [];
        return event.keys;
      },
    }),
  },
}).createMachine({
  context: {
    scopeStack: [DEFAULT_SCOPE],
    registeredKeys: [],
  },
  on: {
    PUSH_SCOPE: { actions: 'pushScope' },
    POP_SCOPE: { actions: 'popScope' },
    RESET_SCOPES: { actions: 'resetScopes' },
    UPDATE_KEYS: { actions: 'updateKeys' },
  },
});

export const shortcutsActor = createActor(shortcutsMachine).start();
export const DEFAULT_SHORTCUT_SCOPE = DEFAULT_SCOPE;
