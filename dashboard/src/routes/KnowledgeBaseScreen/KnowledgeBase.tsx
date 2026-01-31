import { ReactElement, useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries } from '../../zero/queries';
import {
  getKnowledgeDocuments,
  deleteKnowledgeDocument,
  KnowledgeDocument,
} from '../../services/Knowledge/knowledgeService';
import { SingleSelect } from '@juspay/blend-design-system';
import { toast } from 'sonner';
import {
  FileText,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  BookOpen,
  FolderOpen,
  GitBranch,
  Clock,
} from 'lucide-react';
import MarkdownPreview from '@uiw/react-markdown-preview';
import Dialog from '../../components/ui/Dialog';
import { useCachedQuery } from '../../hooks/useCachedQuery';

const PAGE_SIZE = 10;

const KnowledgeBaseScreen = (): ReactElement => {
  // Fetch projects using Zero
  const [projects] = useCachedQuery(queries.getAllProjects());

  // State
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);

  // Project options for dropdown
  const projectOptions = useMemo(
    () =>
      projects?.map(project => ({
        label: project.name,
        value: project.id,
      })) || [],
    [projects],
  );

  // Fetch documents for selected project
  const {
    data: documentsData,
    isLoading: isLoadingDocuments,
    refetch: refetchDocuments,
  } = useQuery({
    queryKey: ['knowledge-documents', selectedProjectId, currentPage],
    queryFn: async () => {
      if (!selectedProjectId) return { documents: [], total: 0 };
      const documents = await getKnowledgeDocuments(selectedProjectId, {
        limit: PAGE_SIZE,
        offset: (currentPage - 1) * PAGE_SIZE,
      });
      return { documents, total: documents.length };
    },
    enabled: !!selectedProjectId,
  });

  const documents = documentsData?.documents || [];
  const totalPages = Math.ceil((documentsData?.total || 0) / PAGE_SIZE) || 1;

  // Reset page when project changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedProjectId]);

  const handleDeleteDocument = async (documentId: string): Promise<void> => {
    setDeletingId(documentId);
    try {
      await deleteKnowledgeDocument(documentId);
      toast.success('Document deleted successfully');
      void refetchDocuments();
    } catch {
      toast.error('Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className='h-full bg-gray-50 flex flex-col rounded-lg shadow-[0_0_8px_0_rgba(0,0,0,0.15)] overflow-clip'>
      {/* Header */}
      <div className='bg-white border-b px-6 py-4'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <BookOpen size={24} className='text-blue-600' />
            <h1 className='text-xl font-semibold text-gray-900'>Knowledge Base</h1>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className='flex-1 overflow-auto p-6'>
        <div className='max-w-5xl mx-auto'>
          {/* Project Selector */}
          <div className='bg-white rounded-lg shadow-sm border p-4 mb-6'>
            <p className='block text-sm font-medium text-gray-700 mb-2'>Select Project</p>
            <div className='max-w-md'>
              <SingleSelect
                placeholder={
                  projectOptions.length > 0 ? 'Select a project' : 'No projects available'
                }
                items={[{ items: projectOptions }]}
                selected={selectedProjectId ?? ''}
                onSelect={selected => setSelectedProjectId(selected || null)}
              />
            </div>
          </div>

          {/* Documents Section */}
          {!selectedProjectId ? (
            // No project selected state
            <div className='bg-white rounded-lg shadow-sm border p-12 text-center'>
              <FolderOpen size={48} className='mx-auto text-gray-300 mb-4' />
              <h2 className='text-lg font-medium text-gray-900 mb-2'>Select a Project</h2>
              <p className='text-gray-500'>
                Choose a project from the dropdown above to view its knowledge documents.
              </p>
            </div>
          ) : isLoadingDocuments ? (
            // Loading state
            <div className='bg-white rounded-lg shadow-sm border p-12 text-center'>
              <Loader2 size={32} className='mx-auto text-blue-500 animate-spin mb-4' />
              <p className='text-gray-500'>Loading documents...</p>
            </div>
          ) : documents.length === 0 ? (
            // Empty state
            <div className='bg-white rounded-lg shadow-sm border p-12 text-center'>
              <FileText size={48} className='mx-auto text-gray-300 mb-4' />
              <h2 className='text-lg font-medium text-gray-900 mb-2'>No Documents Yet</h2>
              <p className='text-gray-500'>
                Knowledge documents approved for this project will appear here.
              </p>
            </div>
          ) : (
            // Documents list
            <div className='bg-white rounded-lg shadow-sm border overflow-hidden'>
              <div className='px-4 py-3 border-b bg-gray-50'>
                <h2 className='font-medium text-gray-900'>
                  Knowledge Documents ({documentsData?.total || 0})
                </h2>
              </div>

              <div className='divide-y'>
                {documents.map((doc: KnowledgeDocument) => (
                  <div
                    key={doc.id}
                    role='button'
                    tabIndex={0}
                    className='p-4 hover:bg-gray-50 transition-colors cursor-pointer'
                    onClick={() => setSelectedDocument(doc)}
                    onKeyDown={e => e.key === 'Enter' && setSelectedDocument(doc)}
                  >
                    <div className='flex items-start justify-between gap-4'>
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2 mb-1'>
                          <FileText size={16} className='text-blue-500 flex-shrink-0' />
                          <h3 className='font-medium text-gray-900 truncate'>{doc.title}</h3>
                        </div>
                        <p className='text-sm text-gray-500 line-clamp-2 mb-2'>
                          {doc.content.substring(0, 200)}...
                        </p>
                        <div className='flex items-center gap-4 text-xs text-gray-400'>
                          <span>Approved: {formatDate(doc.approvedAt)}</span>
                          {doc.repositoryUrl && (
                            <span className='truncate max-w-xs'>Repo: {doc.repositoryUrl}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => void handleDeleteDocument(doc.id)}
                        disabled={deletingId === doc.id}
                        className='p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50'
                        title='Delete document'
                      >
                        {deletingId === doc.id ? (
                          <Loader2 size={16} className='animate-spin' />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className='px-4 py-3 border-t bg-gray-50 flex items-center justify-between'>
                  <span className='text-sm text-gray-500'>
                    Page {currentPage} of {totalPages}
                  </span>
                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className='p-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed'
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className='p-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed'
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Document Viewer Modal */}

      <Dialog
        open={selectedDocument !== null}
        onOpenChange={() => setSelectedDocument(null)}
        className='max-w-3xl'
      >
        <div className='prose prose-sm w-full max-h-[70vh] overflow-auto max-w-3xl relative'>
          <div className='flex items-center justify-between gap-4 text-sm mb-4 p-4 border-b sticky top-0 bg-white rounded-t-lg'>
            <div className='flex items-center gap-2'>
              {selectedDocument?.repositoryUrl && (
                <div className='flex items-center gap-2'>
                  <span>
                    <GitBranch size={16} />
                  </span>
                  <span>Knowledge Base for:</span>
                  <span className='truncate font-medium bg-muted rounded-md px-2 py-1 text-sm'>
                    {selectedDocument?.repositoryUrl?.split('/').pop()?.replace('.git', '')}
                  </span>
                </div>
              )}
            </div>
            <div className='flex items-center gap-2 text-muted-foreground text-sm'>
              <Clock size={16} />
              <span>{formatDate(selectedDocument?.approvedAt || '')}</span>
            </div>
          </div>
          <div className='p-6'>
            <MarkdownPreview
              source={selectedDocument?.content || ''}
              style={{ backgroundColor: 'transparent', color: 'inherit' }}
              data-color-mode='light'
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default KnowledgeBaseScreen;
