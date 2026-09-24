export { ItemView, type ItemViewSlots, type ItemViewProps } from './ItemView';
export { EmbeddedBrowser, type EmbeddedBrowserProps } from './EmbeddedBrowser';
export { WorkspaceSurface, type WorkspaceSurfaceProps } from './WorkspaceSurface';
export { QuickSwitch, type QuickSwitchProps } from './QuickSwitch';
export {
  Centered,
  Spinner,
  SandboxedFrame,
  FileView,
  MarkdownView,
  HtmlDocView,
  useRemoteFile,
} from './primitives';
export {
  itemFromArtifact,
  itemFromSdlc,
  isBrowsableItem,
  isHtmlDocItem,
  type WorkspaceItem,
  type WorkspaceItemKind,
  type WorkspaceItemSource,
  type SdlcItemInput,
} from './itemDescriptor';
export {
  EMPTY_TABS,
  openTab,
  closeTab,
  activateTab,
  pruneTabs,
  moveTab,
  type TabState,
} from './tabState';
export { CommentsPanel, type CommentsPanelProps } from './CommentsPanel';
export {
  registerCommentStore,
  commentStoreFor,
  findAnchor,
  sortComments,
  type ItemComment,
  type NewItemComment,
  type CommentAnchor,
  type CommentStore,
  type AnchorMatch,
  notifyCommentsChanged,
  onCommentsChanged,
} from './itemComments';
export {
  registerAnchorRevealer,
  revealAnchor,
  requestComments,
  onCommentsRequested,
  type AnchorRevealer,
} from './anchorReveal';
export {
  publishOpenItems,
  readOpenItems,
  type OpenItemSummary,
  type OpenWorkspaceState,
} from './openItems';
export * from './annotate';
