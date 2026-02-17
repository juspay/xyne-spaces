/**
 * Search Metrics Event Types
 *
 * These types define the structure of search analytics events
 * sent from the frontend to track user search behavior.
 */

/**
 * Common fields included in all search metric events
 * Note: timestamp, version, and event_name are handled by the logger automatically
 */
interface CommonEventFields {
  search_session_id: string;
  user_id: string;
}

/**
 * Event: search_session_start
 * Triggered when a new search session begins (Cmd+K or first character typed)
 */
export interface SearchSessionStartEvent extends CommonEventFields {
  tab: string;
}

/**
 * Event: search_impression
 * Triggered when search results are displayed to the user
 * Contains breakdown of results by document type
 */
export interface SearchImpressionEvent extends CommonEventFields {
  query_text: string;
  total_hits: number;
  latency_ms: number;
  /**
   * Breakdown of results by document type
   * Example: { "message": 15, "ticket": 5, "user": 0 }
   */
  facet_counts: Record<string, number>;
  is_zero_result: boolean;
  /**
   * How the search was triggered
   * - keyboard_shortcut: Cmd+K or Ctrl+K
   * - click: User clicked the search box
   * - auto_focus: Auto-focused on page load
   */
  search_trigger: 'keyboard_shortcut' | 'click' | 'auto_focus';
  /**
   * Context of where the search occurred
   * - global: Global search across all content
   * - channel: Search within a specific channel
   * - dm: Search within a direct message
   */
  search_location?: 'global' | 'channel' | 'dm';
  /**
   * Number of words in the query text
   */
  query_text_length: number;
  /**
   * Source of the query text
   * - KEYBOARD: Default state for manual typing
   * - CLIPBOARD_PASTE: Triggered when content enters via paste event (Cmd+V / Ctrl+V)
   */
  query_source: 'KEYBOARD' | 'CLIPBOARD_PASTE';
  /**
   * Whether the pasted content was modified after pasting
   * - true: User performed manual keystrokes (additions, deletions, backspaces) after paste
   * - false: Pasted content remains unmodified
   */
  is_modified: boolean;
  tab: string;
}

/**
 * Event: search_click
 * Triggered when a user clicks on a search result
 * Used to calculate CTR and MRR
 */
export interface SearchClickEvent extends CommonEventFields {
  query_text: string;
  clicked_doc_id: string;
  clicked_doc_type: string;
  rank_position: number; // Position in the results list (1-indexed)
  channel?: string; // Optional channel identifier (e.g., "slack", "jira")
  /**
   * How far the user scrolled before clicking (0-100 percentage)
   * Example: 25 means user scrolled 25% down the results list
   */
  scroll_depth?: number;
  /**
   * The URL or path the user navigated to after clicking
   * Example: "/channels/general/messages/123"
   */
  result_url?: string;
  /**
   * Number of words in the query text
   */
  exact_query_text_length: number;
  tab: string;
}

/**
 * Event: search_session_end
 * Triggered when a search session ends (user clicks result, clears search, or closes)
 * Used to track dwell time and user engagement with search results
 */
export interface SearchSessionEndEvent extends CommonEventFields {
  /**
   * The last query text in the session
   */
  query_text: string;
  /**
   * Total number of impressions (result displays) in this session
   */
  total_impressions: number;
  /**
   * Time spent viewing the last set of results before taking action (in milliseconds)
   * Measures how long user reviewed results before clicking or abandoning
   */
  dwell_time_ms: number;
  /**
   * Why the session ended
   * - click: User clicked on a search result
   * - abandon: User closed search without clicking (e.g., pressed Escape)
   * - clear: User cleared the search input
   * - blur: Search input lost focus
   */
  end_reason: 'click' | 'abandon' | 'clear' | 'blur';
  /**
   * Total duration of the entire search session from start to end (in milliseconds)
   */
  total_session_duration_ms: number;
  /**
   * Number of words in the query text
   */
  query_text_length: number;
  /**
   * Source of the query text
   * - KEYBOARD: Default state for manual typing
   * - CLIPBOARD_PASTE: Triggered when content enters via paste event (Cmd+V / Ctrl+V)
   */
  query_source: 'KEYBOARD' | 'CLIPBOARD_PASTE';
  /**
   * Whether the pasted content was modified after pasting
   * - true: User performed manual keystrokes (additions, deletions, backspaces) after paste
   * - false: Pasted content remains unmodified
   */
  is_modified: boolean;
  tab: string;
}

export interface SearchTabClickEvent extends CommonEventFields {
  tab: string;
}

/**
 * Union type of all possible search metric events
 */
export type SearchMetricEvent =
  | SearchSessionStartEvent
  | SearchImpressionEvent
  | SearchClickEvent
  | SearchSessionEndEvent
  | SearchTabClickEvent;
