import React, { createContext, useContext } from 'react';

/**
 * The Contents panel's search box (KbContentsShell) lives beside whatever
 * screen is currently rendered as its children — the root collections table
 * (KnowledgeBaseV2Screen) among them. Without this, that query was local
 * `useState` inside KbContentsPanel: it filtered the left-hand tree/list but
 * had no way to reach the main pane, so typing a search left the right-side
 * table showing every collection unfiltered. Exposing the same (normalized,
 * trimmed, lowercased) query via context lets any child opt in to the same
 * filter instead of duplicating a second search box.
 */
const KbContentsSearchContext = createContext<string>('');

export const KbContentsSearchProvider: React.FC<{ query: string; children: React.ReactNode }> = ({
  query,
  children,
}) => <KbContentsSearchContext.Provider value={query}>{children}</KbContentsSearchContext.Provider>;

/** Normalized (trimmed + lowercased) Contents-panel search query. Empty string when not searching. */
export const useKbContentsSearchQuery = (): string => useContext(KbContentsSearchContext);
