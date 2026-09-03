import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  DataTable,
  ColumnDefinition,
  ColumnType,
  Tag,
  TagVariant,
  TagColor,
  TagSize,
  TagShape,
} from '@juspay/blend-design-system';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  useMemory,
  useUpdateMemory,
  useDeleteMemory,
  useDeleteBySessionIds,
} from '../../hooks/useMemory';
import { useAuthContextValues } from '../../hooks/useAuth';
import { useIsMemoryAdmin } from '../../hooks/usePermissions';
import type {
  MemoryDocument,
  DocType,
  MemoryUpdateRequest,
  MemoryFilters,
} from '../../types/memory';
import Dialog from '../ui/Dialog';

import { RenderMessageWithHTML } from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MemoryCompareView from './MemoryCompareView';

const PAGE_SIZE = 10;

const markdownPlugins = [remarkGfm];

/** Clean raw chatSummary strings before rendering as Markdown */
const sanitizeMarkdown = (raw: string): string => {
  // Convert literal \n into real newlines
  return raw.replace(/\\n/g, '\n');
};

const formatTimestamp = (timestamp: number): string => {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface MemoryTableProps {
  filters: MemoryFilters;
  enableCompare?: boolean;
}

const MemoryTable: React.FC<MemoryTableProps> = ({ filters, enableCompare = false }) => {
  const context = useAuthContextValues();
  const isMemoryAdmin = useIsMemoryAdmin();
  const [currentPage, setCurrentPage] = useState(1);
  const [allDocuments, setAllDocuments] = useState<MemoryDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<MemoryDocument | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<Set<string>>(new Set());
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [updatingDocId, setUpdatingDocId] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  const updateMutation = useUpdateMemory();
  const deleteMutation = useDeleteMemory();
  const deleteSessionMutation = useDeleteBySessionIds();

  const handleUpdateDocument = useCallback(
    (docId: string, fields: MemoryUpdateRequest) => {
      setUpdatingDocId(docId);
      updateMutation.mutate(
        { docId, fields },
        {
          onSettled: () => setUpdatingDocId(null),
        },
      );
    },
    [updateMutation],
  );

  const handleDeleteDocument = useCallback(
    (docId: string) => {
      setDeletingDocId(docId);
      deleteMutation.mutate(docId, {
        onSuccess: () => {
          // Remove from compare selection
          setSelectedForCompare(prev => {
            const next = new Set(prev);
            next.delete(docId);
            return next;
          });
        },
        onSettled: () => setDeletingDocId(null),
      });
    },
    [deleteMutation],
  );

  const offset = (currentPage - 1) * PAGE_SIZE;

  const tagsArray = filters.tagsFilter.trim()
    ? filters.tagsFilter
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
    : undefined;

  const { documents, totalCount, isLoading } = useMemory({
    query: filters.searchQuery.trim() || undefined,
    scope: filters.scope,
    limit: PAGE_SIZE,
    offset,
    docType: filters.docTypeFilter.length === 1 ? (filters.docTypeFilter[0] as DocType) : undefined,
    tags: tagsArray,
    repoUrl: filters.repoUrlFilter.trim() || undefined,
    commitId: filters.commitIdFilter.trim() || undefined,
    sessionId: filters.sessionIdFilter.trim() || undefined,
    filePointers: filters.filePointersFilter.trim() || undefined,
    ticketId: filters.ticketIdFilter.trim() || undefined,
    includeQuery: filters.includeQuery,
    includeSummary: filters.includeSummary,
    enabled: !!context.userID,
  });

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
    setAllDocuments([]);
  }, [
    filters.searchQuery,
    filters.scope,
    filters.docTypeFilter,
    filters.tagsFilter,
    filters.repoUrlFilter,
    filters.commitIdFilter,
    filters.sessionIdFilter,
    filters.filePointersFilter,
    filters.ticketIdFilter,
    filters.includeQuery,
    filters.includeSummary,
  ]);

  // Update documents when new data arrives
  useEffect(() => {
    if (documents.length > 0) {
      setAllDocuments(documents);
    }
  }, [documents]);

  const tableData: Record<string, unknown>[] = useMemo(() => {
    return allDocuments.map((doc, idx) => ({
      id: doc.docId,
      ...(enableCompare && {
        isSelected: selectedForCompare.has(doc.docId),
        rowIndex: offset + idx + 1,
      }),
      docType: doc.docType,
      userQuery: doc.userQuery || '—',
      rawContent: doc.rawContent || '',
      tags: doc.tags?.join(', ') || '—',
      repoUrl: doc.repoUrl || '—',
      ticketId: doc.ticketId || '—',
      sessionId: doc.sessionId || '—',
      commitId: doc.commitId || '—',
      agentUsed: doc.agentUsed || '—',
      filePointers: doc.filePointers?.join(', ') || '—',
      parentRef: doc.parentRef || '—',
      reviewStatus: doc.reviewStatus || '—',
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : '—',
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : '—',
    }));
  }, [allDocuments, selectedForCompare, enableCompare]);

  const toggleCompareSelection = useCallback((docId: string) => {
    setSelectedForCompare(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  }, []);

  const columns: ColumnDefinition<Record<string, unknown>>[] = [
    ...(enableCompare
      ? [
          {
            field: 'isSelected',
            header: '',
            type: ColumnType.TEXT,
            renderCell: (value: unknown, row: Record<string, unknown>) => {
              const docId = row['id'] as string;
              const checked = Boolean(value);
              const rowIndex = row['rowIndex'] as number;
              return (
                <div
                  role='button'
                  tabIndex={0}
                  className='group/sel flex items-center justify-center w-8 h-8 cursor-pointer'
                  onClick={e => {
                    e.stopPropagation();
                    toggleCompareSelection(docId);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleCompareSelection(docId);
                    }
                  }}
                  data-track-category='Memory'
                  data-track-name='ToggleCompareSelection'
                >
                  {/* Index: visible by default, hidden on hover (or when checked) */}
                  <span
                    className={`text-xs text-muted-foreground tabular-nums select-none ${
                      checked ? 'hidden' : 'group-hover/sel:hidden'
                    }`}
                  >
                    {rowIndex}
                  </span>
                  {/* Checkbox: hidden by default, visible on hover (or when checked) */}
                  <input
                    type='checkbox'
                    checked={checked}
                    onChange={() => {}}
                    className={`w-4 h-4 rounded border-border cursor-pointer accent-blue-500 ${
                      checked ? 'block' : 'hidden group-hover/sel:block'
                    }`}
                    data-track-category='Memory'
                    data-track-name='CompareCheckbox'
                  />
                </div>
              );
            },
          } as ColumnDefinition<Record<string, unknown>>,
        ]
      : []),
    {
      field: 'docType',
      header: 'Type',
      type: ColumnType.TEXT,
      renderCell: (value: unknown): React.ReactElement => {
        const docType = value as string;
        return (
          <Tag
            text={docType || 'N/A'}
            variant={TagVariant.SUBTLE}
            color={TagColor.NEUTRAL}
            size={TagSize.SM}
          />
        );
      },
    },
    {
      field: 'userQuery',
      header: 'User Query',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => (
        <div className='max-w-[250px] line-clamp-2 text-foreground text-sm'>
          <RenderMessageWithHTML message={String(value)} />
        </div>
      ),
    },
    {
      field: 'rawContent',
      header: 'Summary',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        let rawContent = '';
        if (typeof value === 'string') {
          rawContent = value;
        }

        // Strip markdown syntax for a plain-text one-liner in the table
        const plain = rawContent
          .replace(/\n/g, ' ')
          .replace(/[#*_`~>~-]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        return (
          <div className='max-w-[300px] truncate text-foreground/80 text-sm' title={plain}>
            {plain || '—'}
          </div>
        );
      },
    },
    {
      field: 'tags',
      header: 'Tags',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const tagsStr = String(value);
        if (tagsStr === '—') return <span className='text-muted-foreground'>—</span>;
        const tagList = tagsStr.split(', ');
        return (
          <div className='flex items-center gap-1 overflow-hidden max-w-[180px]'>
            <Tag
              text={tagList[0] ?? ''}
              variant={TagVariant.SUBTLE}
              color={TagColor.NEUTRAL}
              size={TagSize.SM}
              shape={TagShape.ROUNDED}
            />
            {tagList.length > 1 && (
              <span className='text-xs text-muted-foreground whitespace-nowrap'>
                +{tagList.length - 1}
              </span>
            )}
          </div>
        );
      },
    },
    {
      field: 'filePointers',
      header: 'Files',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const filesStr = String(value);
        if (filesStr === '—') return <span className='text-muted-foreground'>—</span>;
        const fileList = filesStr.split(', ');
        // Show just the filename from the path
        const firstName = fileList[0]?.split('/').pop() || fileList[0] || '';
        return (
          <div className='flex items-center gap-1 overflow-hidden max-w-[200px]'>
            <span className='text-xs font-mono truncate' title={fileList[0]}>
              {firstName}
            </span>
            {fileList.length > 1 && (
              <span className='text-xs text-muted-foreground whitespace-nowrap'>
                +{fileList.length - 1}
              </span>
            )}
          </div>
        );
      },
    },
    {
      field: 'repoUrl',
      header: 'Repo URL',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const url = String(value);
        if (url === '—') return <span className='text-muted-foreground'>—</span>;
        // Show just the repo name (last two path segments) for brevity
        const parts = url.replace(/\.git$/, '').split('/');
        const short = parts.slice(-2).join('/');
        return (
          <div className='max-w-[180px] truncate text-sm' title={url}>
            {short || url}
          </div>
        );
      },
    },
    {
      field: 'ticketId',
      header: 'Ticket',
      type: ColumnType.TEXT,
    },
    {
      field: 'sessionId',
      header: 'Session',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const val = String(value);
        if (val === '—') return <span className='text-muted-foreground'>—</span>;
        return (
          <div className='max-w-[120px] truncate font-mono text-xs' title={val}>
            {val.length > 12 ? `${val.slice(0, 12)}…` : val}
          </div>
        );
      },
    },
    {
      field: 'commitId',
      header: 'Commit',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const val = String(value);
        if (val === '—') return <span className='text-muted-foreground'>—</span>;
        return (
          <div className='font-mono text-xs' title={val}>
            {val.length > 8 ? val.slice(0, 8) : val}
          </div>
        );
      },
    },
    {
      field: 'agentUsed',
      header: 'Agent',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const val = String(value);
        if (val === '—') return <span className='text-muted-foreground'>—</span>;
        return (
          <Tag text={val} variant={TagVariant.SUBTLE} color={TagColor.NEUTRAL} size={TagSize.SM} />
        );
      },
    },
    {
      field: 'reviewStatus',
      header: 'Review Status',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const val = String(value);
        if (val === '—' || !val) return <span className='text-muted-foreground'>—</span>;
        const colorMap: Record<string, { bg: string; text: string }> = {
          pending: {
            bg: 'bg-yellow-100 dark:bg-yellow-950',
            text: 'text-yellow-700 dark:text-yellow-300',
          },
          verified: {
            bg: 'bg-green-100 dark:bg-green-950',
            text: 'text-green-700 dark:text-green-300',
          },
          rejected: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-300' },
        };
        const colors = colorMap[val] || { bg: 'bg-muted', text: 'text-muted-foreground' };
        return (
          <span className={`px-2 py-0.5 text-xs font-semibold rounded ${colors.bg} ${colors.text}`}>
            {val}
          </span>
        );
      },
    },
    {
      field: 'parentRef',
      header: 'Parent Ref',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const val = String(value);
        if (val === '—') return <span className='text-muted-foreground'>—</span>;
        return (
          <div className='max-w-[120px] truncate font-mono text-xs' title={val}>
            {val.length > 12 ? `${val.slice(0, 12)}…` : val}
          </div>
        );
      },
    },
    {
      field: 'createdAt',
      header: 'Created At',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const val = String(value);
        if (val === '—') return <span className='text-muted-foreground'>—</span>;
        return (
          <span className='text-sm'>
            {new Date(val).toLocaleString('en-US', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        );
      },
    },
    {
      field: 'updatedAt',
      header: 'Updated At',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => {
        const val = String(value);
        if (val === '—') return <span className='text-muted-foreground'>—</span>;
        return (
          <span className='text-sm'>
            {new Date(val).toLocaleString('en-US', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        );
      },
    },
  ];

  const handleRowClick = useCallback(
    (row: Record<string, unknown>): void => {
      const docId = row['id'] as string;
      const doc = allDocuments.find(d => d.docId === docId);
      if (doc) {
        setSelectedDocument(doc);
      }
    },
    [allDocuments],
  );

  const clearCompareSelection = useCallback(() => {
    setSelectedForCompare(new Set());
  }, []);

  const handleRemoveFromCompare = useCallback((docId: string) => {
    setSelectedForCompare(prev => {
      const next = new Set(prev);
      next.delete(docId);
      return next;
    });
  }, []);

  const compareDocuments = useMemo(() => {
    return allDocuments.filter(d => selectedForCompare.has(d.docId));
  }, [allDocuments, selectedForCompare]);

  return (
    <div>
      {/* Session delete toolbar — visible to MEMORY admins when a session filter is active */}
      {filters.sessionIdFilter.trim() && isMemoryAdmin && (
        <div className='flex items-center justify-between px-2 py-2 mb-2 rounded-md bg-muted/50 border border-border'>
          <span className='text-sm text-muted-foreground'>
            Showing session:{' '}
            <span className='font-mono text-xs text-foreground'>
              {filters.sessionIdFilter.trim()}
            </span>
          </span>
          <button
            onClick={() => {
              const sessionId = filters.sessionIdFilter.trim();
              deleteSessionMutation.mutate([sessionId], {
                onSuccess: () => {
                  toast.success('Session deleted from Vespa memory');
                },
                onError: () => toast.error('Failed to delete session'),
              });
            }}
            disabled={deleteSessionMutation.isPending}
            className='h-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            title='Delete all Vespa memory docs for this session'
            data-ph-capture-attribute-track-id='memory_delete_session'
            data-track-category='Memory'
            data-track-name='DeleteSession'
          >
            <Trash2 size={12} />
            {deleteSessionMutation.isPending ? 'Deleting…' : 'Delete Session'}
          </button>
        </div>
      )}

      <DataTable
        title=''
        showHeader={false}
        enableSearch={false}
        data={tableData}
        columns={columns}
        idField='id'
        isLoading={isLoading && allDocuments.length === 0}
        onRowClick={handleRowClick}
        serverSidePagination={true}
        pagination={{
          currentPage,
          pageSize: PAGE_SIZE,
          totalRows: totalCount || allDocuments.length,
          pageSizeOptions: [10],
        }}
        onPageChange={page => {
          setCurrentPage(page);
        }}
        onPageSizeChange={() => {}}
      />
      {isLoading && allDocuments.length > 0 && (
        <div className='flex justify-center py-4'>
          <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-muted-foreground'></div>
        </div>
      )}

      {/* Detail Modal */}
      <Dialog
        open={selectedDocument !== null}
        onOpenChange={() => setSelectedDocument(null)}
        className='max-w-3xl'
      >
        {selectedDocument && (
          <div className='max-h-[75vh] overflow-auto'>
            <div className='p-6 space-y-5'>
              {/* Header */}
              <div className='flex items-center gap-2'>
                <span
                  className={`px-2 py-0.5 text-xs font-semibold rounded ${
                    selectedDocument.docType === 'fact'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                      : 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                  }`}
                >
                  {selectedDocument.docType}
                </span>
              </div>

              {/* User Query */}
              {selectedDocument.userQuery && (
                <div>
                  <h3 className='text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider'>
                    User Query
                  </h3>
                  <div className='text-sm bg-muted/50 rounded px-3 py-2 border border-border'>
                    <RenderMessageWithHTML message={selectedDocument.userQuery} />
                  </div>
                </div>
              )}

              {/* Summary - Use rawContent */}
              <div>
                <h3 className='text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider'>
                  Summary
                </h3>
                <div className='text-sm text-foreground space-y-2'>
                  {selectedDocument.rawContent ? (
                    <div className='bot-markdown-content memory-markdown'>
                      <Markdown remarkPlugins={markdownPlugins}>
                        {sanitizeMarkdown(selectedDocument.rawContent)}
                      </Markdown>
                    </div>
                  ) : (
                    <p className='text-muted-foreground'>No summary available</p>
                  )}
                </div>
              </div>

              {/* File Pointers */}
              {selectedDocument.filePointers?.length > 0 && (
                <div>
                  <h3 className='text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider'>
                    File Pointers
                  </h3>
                  <div className='space-y-1'>
                    {selectedDocument.filePointers.map((file, idx) => (
                      <div
                        key={idx}
                        className='text-xs bg-muted/50 rounded px-2.5 py-1.5 border border-border font-mono text-foreground/80 truncate'
                        title={file}
                      >
                        {file}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tags */}
              {selectedDocument.tags?.length > 0 && (
                <div>
                  <h3 className='text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider'>
                    Tags
                  </h3>
                  <div className='flex flex-wrap gap-1.5'>
                    {selectedDocument.tags.map(tag => (
                      <span
                        key={tag}
                        className='text-xs bg-muted px-2 py-1 rounded text-muted-foreground'
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className='border-t pt-4'>
                <h3 className='text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider'>
                  Metadata
                </h3>
                <table className='w-full text-xs'>
                  <tbody className='divide-y divide-border'>
                    <tr>
                      <td className='py-1.5 pr-4 text-muted-foreground font-medium w-32'>Doc ID</td>
                      <td className='py-1.5 font-mono'>{selectedDocument.docId}</td>
                    </tr>
                    {selectedDocument.sessionId && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>
                          Session ID
                        </td>
                        <td className='py-1.5 font-mono'>{selectedDocument.sessionId}</td>
                      </tr>
                    )}
                    {selectedDocument.parentRef && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>
                          Parent Doc
                        </td>
                        <td className='py-1.5 font-mono'>{selectedDocument.parentRef}</td>
                      </tr>
                    )}
                    {selectedDocument.reviewStatus && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>
                          Review Status
                        </td>
                        <td className='py-1.5'>
                          {(() => {
                            const val = selectedDocument.reviewStatus;
                            const colorMap = {
                              pending: {
                                bg: 'bg-yellow-100 dark:bg-yellow-950',
                                text: 'text-yellow-700 dark:text-yellow-300',
                              },
                              verified: {
                                bg: 'bg-green-100 dark:bg-green-950',
                                text: 'text-green-700 dark:text-green-300',
                              },
                              rejected: {
                                bg: 'bg-red-100 dark:bg-red-950',
                                text: 'text-red-700 dark:text-red-300',
                              },
                            } as const;
                            const colors = (
                              colorMap as Record<string, { bg: string; text: string }>
                            )[val] || { bg: 'bg-muted', text: 'text-muted-foreground' };
                            return (
                              <span
                                className={`px-2 py-0.5 text-xs font-semibold rounded ${colors.bg} ${colors.text}`}
                              >
                                {val}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                    {selectedDocument.userId && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>User ID</td>
                        <td className='py-1.5'>{selectedDocument.userId}</td>
                      </tr>
                    )}
                    {selectedDocument.repoUrl && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>Repo URL</td>
                        <td className='py-1.5 break-all text-primary'>
                          {selectedDocument.repoUrl}
                        </td>
                      </tr>
                    )}
                    {selectedDocument.commitId && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>Commit ID</td>
                        <td className='py-1.5 font-mono'>{selectedDocument.commitId}</td>
                      </tr>
                    )}
                    {selectedDocument.ticketId && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>Ticket ID</td>
                        <td className='py-1.5'>{selectedDocument.ticketId}</td>
                      </tr>
                    )}
                    {selectedDocument.agentUsed && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>Agent</td>
                        <td className='py-1.5'>{selectedDocument.agentUsed}</td>
                      </tr>
                    )}
                    {selectedDocument.modelUsed?.length > 0 && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>Models</td>
                        <td className='py-1.5'>{selectedDocument.modelUsed.join(', ')}</td>
                      </tr>
                    )}
                    {selectedDocument.fileStoragePath && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>
                          Storage Path
                        </td>
                        <td className='py-1.5 font-mono break-all'>
                          {selectedDocument.fileStoragePath}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className='py-1.5 pr-4 text-muted-foreground font-medium'>Created</td>
                      <td className='py-1.5'>{formatTimestamp(selectedDocument.createdAt)}</td>
                    </tr>
                    <tr>
                      <td className='py-1.5 pr-4 text-muted-foreground font-medium'>Updated</td>
                      <td className='py-1.5'>{formatTimestamp(selectedDocument.updatedAt)}</td>
                    </tr>
                    {typeof selectedDocument.committedAt === 'number' &&
                      selectedDocument.committedAt > 0 && (
                        <tr>
                          <td className='py-1.5 pr-4 text-muted-foreground font-medium'>
                            Committed
                          </td>
                          <td className='py-1.5'>
                            {formatTimestamp(selectedDocument.committedAt)}
                          </td>
                        </tr>
                      )}
                    {selectedDocument.relevanceScore !== undefined && (
                      <tr>
                        <td className='py-1.5 pr-4 text-muted-foreground font-medium'>Relevance</td>
                        <td className='py-1.5'>{selectedDocument.relevanceScore.toFixed(4)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      {/* Floating Compare Bar */}
      {enableCompare && selectedForCompare.size > 0 && (
        <div className='fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-background border border-border rounded-lg shadow-lg px-5 py-3'>
          <span className='text-sm text-foreground font-medium'>
            {selectedForCompare.size} selected
          </span>
          <button
            onClick={() => setIsCompareOpen(true)}
            disabled={selectedForCompare.size < 2}
            className='px-4 py-1.5 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
            data-track-category='Memory'
            data-track-name='OpenCompareView'
          >
            Compare
          </button>
          <button
            onClick={clearCompareSelection}
            className='px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors'
            data-track-category='Memory'
            data-track-name='ClearCompareSelection'
          >
            Clear
          </button>
        </div>
      )}

      {/* Compare View */}
      {enableCompare && (
        <MemoryCompareView
          documents={compareDocuments}
          open={isCompareOpen}
          onOpenChange={setIsCompareOpen}
          onRemoveDocument={handleRemoveFromCompare}
          onUpdateDocument={handleUpdateDocument}
          onDeleteDocument={handleDeleteDocument}
          updatingDocId={updatingDocId}
          deletingDocId={deletingDocId}
        />
      )}
    </div>
  );
};

export default MemoryTable;
