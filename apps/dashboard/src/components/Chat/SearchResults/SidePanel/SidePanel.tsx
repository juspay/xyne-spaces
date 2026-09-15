import { ReactElement } from 'react';
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import { X } from 'lucide-react';
import ThreadMessages from '../../ThreadPannel';
import { UserProfile } from '../../../ui/UserProfile/UserProfile';
import ConversationPanelV2 from '../../ConversationPannel/ConversationPanelV2';
import CanvasScreen from '../../../Canvas/CanvasScreen';
import ActivitySupportTicket from '../../../Activity/ActivitySupportTicket/ActivitySupportTicket';
import { AttachmentPreviewPane } from '../../../FileViewer/AttachmentPreviewPane';
import { useAuth } from '../../../../hooks/useAuth';
import type {
  SidePanelState,
  ThreadPanelState,
  ProfilePanelState,
  ChannelPanelState,
  CanvasPanelState,
  AttachmentPanelState,
  DeskTicketPanelState,
} from './PanelTypes';

// ————————————————————————————————————————————————————————————————
// Public API
// ————————————————————————————————————————————————————————————————

// Every side-panel component is closable — the one shared prop across the whole family.
// Each specific panel adds its own `panel` variant on top (below).
interface BasePanelProps {
  onClose: () => void;
}

interface SearchResultsSidePanelProps extends BasePanelProps {
  panel: NonNullable<SidePanelState>;
}

// Renders the right-pane content for the selected panel, dispatching on its `kind`.
export function SearchResultsSidePanel({
  panel,
  onClose,
}: SearchResultsSidePanelProps): ReactElement {
  // Single cast at the dispatch boundary is the standard idiom for a registry over a
  // discriminated union — each renderer is typed to its own panel variant in PANEL_RENDERERS.
  const Renderer = PANEL_RENDERERS[panel.kind] as (
    props: SearchResultsSidePanelProps,
  ) => ReactElement;
  return (
    <div className='h-full flex flex-col min-h-0 bg-background'>
      <Renderer panel={panel} onClose={onClose} />
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// Registry (bindings)
// ————————————————————————————————————————————————————————————————

// Keys: SidePanelState's `kind`. Each entry is a component typed to its own named panel-props
// interface (defined directly above each component below) — no mapped types, no React.FC.
type PanelRegistry = {
  channel: (props: ChannelPanelProps) => ReactElement;
  thread: (props: ThreadPanelProps) => ReactElement;
  profile: (props: ProfilePanelProps) => ReactElement;
  canvas: (props: CanvasPanelProps) => ReactElement;
  attachment: (props: AttachmentPanelProps) => ReactElement;
  deskTicket: (props: DeskTicketPanelProps) => ReactElement;
};

// kind → renderer. New panel kinds plug in here (mirrors the SidePanelState union).
const PANEL_RENDERERS: PanelRegistry = {
  channel: ChannelPanel,
  thread: ThreadPanel,
  profile: ProfilePanel,
  canvas: CanvasPanel,
  attachment: AttachmentPanel,
  deskTicket: DeskTicketPanel,
};

// ————————————————————————————————————————————————————————————————
// Internal — panel renderer components
// ————————————————————————————————————————————————————————————————

interface PanelCloseHeaderProps extends BasePanelProps {
  label: string;
  trackName: string;
  title?: string;
}

// Shared close-header for panels whose content component has no close affordance
// of its own (profile / canvas / attachment). Channel and thread panels own their
// headers (via ConversationPanelV2 / ThreadMessages) and don't use this.
function PanelCloseHeader({
  label,
  trackName,
  onClose,
  title,
}: PanelCloseHeaderProps): ReactElement {
  return (
    <div className='flex items-center justify-between gap-2 p-2 border-b border-border shrink-0'>
      {title ? (
        <span className='truncate px-1 text-sm font-medium text-foreground'>{title}</span>
      ) : (
        <span />
      )}
      <button
        onClick={onClose}
        className='p-2 rounded-md hover:bg-accent shrink-0'
        aria-label={label}
        data-track-category='SEARCH_RESULTS'
        data-track-name={trackName}
      >
        <X size={18} />
      </button>
    </div>
  );
}

interface ChannelPanelProps extends BasePanelProps {
  panel: ChannelPanelState;
}

function ChannelPanel({ panel, onClose }: ChannelPanelProps): ReactElement {
  return (
    <ConversationPanelV2
      channelId={panel.channelId}
      previousChannelId={null}
      useLocalTabState
      {...(panel.conversationId !== undefined && {
        linkedConversationIdOverride: panel.conversationId,
      })}
      linkedItemCreatedAtOverride={panel.conversationCreatedAt ?? null}
      onClose={onClose}
    />
  );
}

interface ThreadPanelProps extends BasePanelProps {
  panel: ThreadPanelState;
}

function ThreadPanel({ panel, onClose }: ThreadPanelProps): ReactElement {
  const navigate = useNavigate();
  return (
    <ThreadMessages
      channelId={panel.thread.channelId}
      conversationId={panel.thread.conversationId}
      matchedMessageId={panel.thread.matchedMessageId ?? null}
      {...(panel.thread.ticketId && { ticketId: panel.thread.ticketId })}
      showChannelLink
      onChannelLinkClick={() =>
        void navigate(`/chat/dir/${panel.thread.channelId}#origin=${panel.thread.conversationId}`)
      }
      onClose={onClose}
    />
  );
}

interface ProfilePanelProps extends BasePanelProps {
  panel: ProfilePanelState;
}

function ProfilePanel({ panel, onClose }: ProfilePanelProps): ReactElement {
  const { user: currentUser } = useAuth();
  return (
    <>
      <PanelCloseHeader label='Close profile' trackName='CLOSE_PROFILE_PANEL' onClose={onClose} />
      <div className='flex-1 min-h-0 overflow-y-auto'>
        <UserProfile
          userId={panel.userId}
          isOwnProfile={currentUser?.id === panel.userId}
          className='border-0 rounded-none shadow-none'
        />
      </div>
    </>
  );
}

interface CanvasPanelProps extends BasePanelProps {
  panel: CanvasPanelState;
}

function CanvasPanel({ panel, onClose }: CanvasPanelProps): ReactElement {
  return (
    <>
      <PanelCloseHeader label='Close canvas' trackName='CLOSE_CANVAS_PANEL' onClose={onClose} />
      <div className='flex-1 min-h-0 overflow-hidden'>
        <CanvasScreen canvasId={panel.canvasId} />
      </div>
    </>
  );
}

interface AttachmentPanelProps extends BasePanelProps {
  panel: AttachmentPanelState;
}

function AttachmentPanel({ panel, onClose }: AttachmentPanelProps): ReactElement {
  return (
    <>
      <PanelCloseHeader
        label='Close attachment'
        trackName='CLOSE_ATTACHMENT_PANEL'
        title={panel.fileName}
        onClose={onClose}
      />
      <AttachmentPreviewPane
        attachmentId={panel.attachmentId}
        fileName={panel.fileName}
        mimeType={panel.mimeType}
        fileSize={panel.fileSize}
      />
    </>
  );
}

interface DeskTicketPanelProps extends BasePanelProps {
  panel: DeskTicketPanelState;
}

// Hosts the desk ticket the /chat/activity/ticket route renders, but in the pane. SupportTicketDetail is
// URL-driven, so we replay the ids into a synthetic child location: `<Routes location>` scopes its
// useParams/useSearchParams/location.state, while useNavigate keeps hitting the real router — so the rare
// in-ticket edit navigations (e.g. unmerge) open the full app instead of blanking the pane.
function DeskTicketPanel({ panel, onClose }: DeskTicketPanelProps): ReactElement {
  const { pathname } = useLocation();
  const ticketLocation = {
    pathname: `${pathname}/ticket/${panel.channelId}/${panel.ticketXyneId}`,
    search: panel.mailId ? `?mail=${panel.mailId}` : '',
    hash: '',
    state: { conversationId: panel.conversationId, ticketId: panel.ticketId },
    key: panel.ticketXyneId,
  };
  return (
    <>
      <PanelCloseHeader
        label='Close ticket'
        trackName='CLOSE_DESK_TICKET_PANEL'
        title={panel.title}
        onClose={onClose}
      />
      <div className='flex-1 min-h-0 overflow-hidden'>
        {/* RR's dev "descendant <Routes> … no trailing *" warning is a false positive here — the
            location is synthetic and never navigated to, so the child always matches. */}
        <Routes location={ticketLocation}>
          <Route
            path='ticket/:channelId/:ticketId'
            element={<ActivitySupportTicket showAdjacentNav={false} />}
          />
        </Routes>
      </div>
    </>
  );
}
