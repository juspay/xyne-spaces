import { assign, createActor, setup } from 'xstate';

export type DocumentTitleEntityType =
  | 'channel'
  | 'dm'
  | 'ticket'
  | 'thread'
  | 'canvas'
  | 'project'
  | 'page';

export type DocumentTitleScope = 'main' | 'panel-webview';

export type DocumentTitleContribution = {
  id: string;
  priority: number;
  scope?: DocumentTitleScope;
  entity: {
    type: DocumentTitleEntityType;
    label: string;
  };
};

export type DocumentTitleContext = {
  contributions: Record<string, DocumentTitleContribution>;
  badgeCount: number;
  appName: string;
  scope: DocumentTitleScope;
};

type DocumentTitleEvent =
  | { type: 'UPSERT_CONTRIBUTION'; contribution: DocumentTitleContribution }
  | { type: 'REMOVE_CONTRIBUTION'; id: string }
  | { type: 'SET_BADGE_COUNT'; count: number }
  | { type: 'SET_SCOPE'; scope: DocumentTitleScope }
  | { type: 'RESET' };

export const DOCUMENT_TITLE_PRIORITIES = {
  page: 10,
  section: 30,
  entity: 50,
  detail: 70,
  blocking: 90,
} as const;

const normalizeLabel = (label: string): string => label.replace(/\s+/g, ' ').trim();

export const getWinningDocumentTitleContribution = (
  context: DocumentTitleContext,
): DocumentTitleContribution | undefined => {
  return Object.values(context.contributions)
    .filter(contribution => {
      return (
        (!contribution.scope || contribution.scope === context.scope) &&
        normalizeLabel(contribution.entity.label).length > 0
      );
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
};

export const formatDocumentTitle = (context: DocumentTitleContext): string => {
  const winningContribution = getWinningDocumentTitleContribution(context);
  const badge =
    context.badgeCount > 0 ? `(${context.badgeCount > 99 ? '99+' : context.badgeCount}) ` : '';

  if (!winningContribution) {
    return `${badge}${context.appName}`;
  }

  const label = normalizeLabel(winningContribution.entity.label);
  if (!label || label === context.appName) {
    return `${badge}${context.appName}`;
  }

  return `${badge}${label} · ${context.appName}`;
};

export const documentTitleMachine = setup({
  types: {
    context: {} as DocumentTitleContext,
    events: {} as DocumentTitleEvent,
  },
  actions: {
    upsertContribution: assign({
      contributions: ({ context, event }) => {
        if (event.type !== 'UPSERT_CONTRIBUTION') return context.contributions;
        return {
          ...context.contributions,
          [event.contribution.id]: event.contribution,
        };
      },
    }),
    removeContribution: assign({
      contributions: ({ context, event }) => {
        if (event.type !== 'REMOVE_CONTRIBUTION') return context.contributions;
        const next = { ...context.contributions };
        delete next[event.id];
        return next;
      },
    }),
    setBadgeCount: assign({
      badgeCount: ({ context, event }) => {
        if (event.type !== 'SET_BADGE_COUNT') return context.badgeCount;
        return Math.max(0, Math.floor(event.count));
      },
    }),
    setScope: assign({
      scope: ({ context, event }) => {
        if (event.type !== 'SET_SCOPE') return context.scope;
        return event.scope;
      },
    }),
    reset: assign({
      contributions: () => ({}),
      badgeCount: () => 0,
      scope: () => 'main' as DocumentTitleScope,
    }),
  },
}).createMachine({
  id: 'documentTitle',
  context: {
    contributions: {},
    badgeCount: 0,
    appName: 'Xyne Spaces',
    scope: 'main',
  },
  on: {
    UPSERT_CONTRIBUTION: { actions: 'upsertContribution' },
    REMOVE_CONTRIBUTION: { actions: 'removeContribution' },
    SET_BADGE_COUNT: { actions: 'setBadgeCount' },
    SET_SCOPE: { actions: 'setScope' },
    RESET: { actions: 'reset' },
  },
});

export const documentTitleActor = createActor(documentTitleMachine).start();
