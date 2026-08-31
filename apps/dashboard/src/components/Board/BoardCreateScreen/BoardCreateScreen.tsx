import { ReactElement, useState, useMemo } from 'react';
import { ChevronLeft, Plus, Search } from 'lucide-react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUsers } from '../../../hooks/useUsers';
import { Dialog } from '../../ui/Dialog';
import { BoardForm } from '../BoardForm';
import { TicketPreviewPanel } from '../TicketPreviewPanel/TicketPreviewPanel';
import { TicketPreviewContent, CreateTicketModal } from '../TicketPreviewViews/TicketPreviewViews';
import { BoardTableRow } from '../BoardTableRow';
import type { BoardRow, User, FormMapping, FormContextMapping } from './BoardCreateScreen.types';
import { toast } from 'sonner';
import { FormContextType, TicketStatusV2, TicketPriority } from '@xyne/shared';
import { Button } from '../../ui/Button';
import { getUserDisplayName } from '../../../utils/userDisplayName';
interface BoardCreateScreenProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  onCreateNew?: () => void;
  onDuplicate?: (board: BoardRow) => void;
}

const BoardCreateScreen = ({
  projectId,
  isOpen,
  onClose,
  onSave,
  onCreateNew,
  onDuplicate,
}: BoardCreateScreenProps): ReactElement | null => {
  const [showBoardForm, setShowBoardForm] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<BoardRow | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewBoard, setPreviewBoard] = useState<BoardRow | null>(null);

  // Fetch boards in project (lightweight - no stages/relations)
  const [boardsInProject] = useCachedQuery(
    queries.boardsListByProject({ projectId: projectId || '' }),
    { enabled: !!projectId },
  );

  // Fetch all users to map IDs to names
  const allUsers = useUsers();

  // Fetch all forms with BOARD context type to get custom fields mapping
  const [allFormMappings] = useCachedQuery(
    queries.getFormsByContextType({ contextType: FormContextType.BOARD }),
  );

  // Transform boards to table rows
  const boardRows: (BoardRow & { customFieldNames?: string[] })[] = useMemo(() => {
    if (!boardsInProject || !Array.isArray(boardsInProject)) return [];

    // Create a map of userId -> userName for quick lookup
    const userMap = new Map<string, string>();
    if (allUsers && Array.isArray(allUsers)) {
      allUsers.forEach((user: User) => {
        if (user.id) {
          userMap.set(user.id, getUserDisplayName(user));
        }
      });
    }

    // Create a map of boardId -> custom field names from forms
    const boardFieldMap = new Map<string, string[]>();
    if (allFormMappings && Array.isArray(allFormMappings)) {
      allFormMappings.forEach(form => {
        const typedForm = form as unknown as FormMapping;
        if (typedForm.formContextMappings && Array.isArray(typedForm.formContextMappings)) {
          typedForm.formContextMappings.forEach((mapping: FormContextMapping) => {
            if (
              String(mapping.contextType) === String(FormContextType.BOARD) &&
              typeof mapping.contextId === 'string'
            ) {
              // Extract field names from form.formFields (matching BoardEdit/repo's formMapping.formFields)
              const fieldNames =
                typedForm.formFields?.map(field => field.fieldName).filter(Boolean) || [];
              boardFieldMap.set(mapping.contextId, fieldNames);
            }
          });
        }
      });
    }

    return boardsInProject.map(board => {
      const customFieldNames = boardFieldMap.get(board.id) || [];
      return {
        id: board.id,
        title: board.name,
        createdBy: userMap.get(board.createdBy) || board.createdBy || 'Unknown',
        createdByUserId: board.createdBy,
        automations: 0,
        customFields: customFieldNames.length,
        projectId: board.projectId,
        customFieldNames: customFieldNames.slice(0, 10), // Limit to 10 for display
      };
    });
  }, [boardsInProject, allUsers, allFormMappings]);

  // Filter boards based on search
  const filteredBoards = useMemo(() => {
    if (!searchQuery.trim()) return boardRows;
    const query = searchQuery.toLowerCase();
    return boardRows.filter(
      board =>
        board.title.toLowerCase().includes(query) ||
        (typeof board.createdBy === 'string'
          ? board.createdBy.toLowerCase().includes(query)
          : false),
    );
  }, [boardRows, searchQuery]);

  const handleDuplicateBoard = (board: BoardRow): void => {
    onDuplicate?.(board);
  };

  const handleCreateNew = (): void => {
    onCreateNew?.();
  };

  const handleBoardFormSubmit = (): void => {
    setIsSubmitting(true);
    try {
      toast.success('Board created successfully');
      setShowBoardForm(false);
      onSave?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create board');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = (): void => {
    setShowBoardForm(false);
    setSelectedBoard(null);
  };

  const handleClose = (): void => {
    setShowBoardForm(false);
    setSelectedBoard(null);
    setPreviewBoard(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-background flex flex-col w-[90vw] h-[85vh] rounded-lg shadow-xl overflow-hidden border border-border'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4'>
          {/* Left Section */}
          <div className='flex items-center gap-[4px]'>
            <Button
              onClick={handleClose}
              variant='ghost'
              size='iconSm'
              className='w-[16px] h-[16px] text-foreground hover:opacity-70'
              data-track-category='BOARD_CREATE'
              data-track-name='NAVIGATE_BACK'
            >
              <ChevronLeft size={16} />
            </Button>
            <span className='font-medium text-[14px] leading-[20px] text-foreground overflow-hidden text-ellipsis whitespace-nowrap'>
              Browse templates
            </span>
          </div>

          {/* Right Section */}
          <div className='flex items-center gap-3'>
            <Button
              variant='secondary'
              onClick={onClose}
              data-track-category='BOARD_CREATE'
              data-track-name='CLOSE_BOARD_CREATE'
            >
              Cancel
            </Button>
            <Button
              className='bg-[#6276BE] hover:bg-[#5060A0] text-white'
              onClick={handleCreateNew}
              data-track-category='BOARD_CREATE'
              data-track-name='CREATE_BOARD'
            >
              <Plus size={14} />
              Create Board
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className='flex-1 min-h-0 overflow-hidden flex'>
          {/* Left Panel - Templates & Boards */}
          <div className={`flex-1 min-h-0 overflow-y-auto ${previewBoard ? 'w-[50%]' : 'w-full'}`}>
            <div className='px-[16px] py-[12px] space-y-[24px]'>
              {/* Boards Section */}
              <div className='space-y-[12px]'>
                {/* Header row */}
                <div className='flex items-center justify-between px-[16px]'>
                  <h2 className='text-[16px] font-semibold leading-[24px] text-foreground'>
                    Create from boards
                  </h2>

                  <div className='relative'>
                    <Search
                      size={16}
                      className='absolute left-[12px] top-1/2 -translate-y-1/2 text-muted-foreground'
                    />
                    <input
                      type='text'
                      placeholder='Search boards...'
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className='pl-[36px] pr-[12px] py-[8px] text-[14px] text-foreground bg-background border border-border rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#6276be]'
                      data-track-category='BOARD_CREATE'
                      data-track-name='SEARCH_BOARDS'
                    />
                  </div>
                </div>

                {/* Boards Table */}
                <div className='px-[16px]'>
                  <div className='rounded-[8px] overflow-hidden bg-background'>
                    {/* Table Header */}
                    <div className='flex items-center gap-[24px] px-[16px] py-[12px] bg-background'>
                      <div className='flex-1 text-[14px] font-semibold min-w-0'>Board Title</div>
                      <div className='flex-1 text-[14px] font-semibold min-w-0'>Created by</div>
                      <div className='flex-1 text-[14px] font-semibold min-w-0'>Automations</div>
                      <div className='flex-1 text-[14px] font-semibold min-w-0'>Custom Fields</div>
                      <div className='w-[200px] flex-shrink-0 text-[14px] font-semibold'>
                        Actions
                      </div>
                    </div>

                    {/* Table Rows */}
                    {filteredBoards.length > 0 ? (
                      <div className='divide'>
                        {filteredBoards.map((board, index) => (
                          <BoardTableRow
                            key={board.id}
                            board={board}
                            onDuplicate={handleDuplicateBoard}
                            onPreview={board => {
                              setPreviewBoard(board);
                            }}
                            index={index}
                            selectedBoardId={previewBoard?.id}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className='px-[16px] py-[32px] text-center'>
                        <p className='text-[14px] text-muted-foreground'>
                          {searchQuery
                            ? 'No boards found matching your search.'
                            : 'No boards available.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel - Preview */}
          {previewBoard && (
            <TicketPreviewPanel
              onClose={() => setPreviewBoard(null)}
              trackCategory='BOARD_CREATE'
              ticketPreviewContent={
                <TicketPreviewContent
                  boardId={previewBoard.id}
                  ticket={{
                    title: `Sample ticket in ${previewBoard.title}`,
                    description:
                      'This is a sample ticket description showing how tickets will look in this board. Users can add detailed descriptions, attachments, and links here.',
                    status: 'Open',
                    statusV2: TicketStatusV2.TODO,
                    priority: TicketPriority.MEDIUM,
                    assignee: 'Neha Joshi',
                    assigneeAvatar: 'NJ',
                    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(
                      'en-US',
                      {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      },
                    ),
                    createdBy: 'Neha Joshi',
                    channel: 'Support',
                  }}
                />
              }
              createTicketContent={<CreateTicketModal boardId={previewBoard.id} />}
            />
          )}
        </div>

        {/* Board Form Dialog */}
        {showBoardForm && projectId && (
          <Dialog open={showBoardForm} onOpenChange={setShowBoardForm} title='Create Board'>
            <BoardForm
              board={
                selectedBoard && boardsInProject
                  ? boardsInProject.find(b => b.id === selectedBoard.id)
                  : undefined
              }
              onSubmit={handleBoardFormSubmit}
              onCancel={handleCancel}
              projectId={projectId}
              loading={isSubmitting}
            />
          </Dialog>
        )}
      </div>
    </div>
  );
};

BoardCreateScreen.displayName = 'BoardCreateScreen';

export default BoardCreateScreen;
