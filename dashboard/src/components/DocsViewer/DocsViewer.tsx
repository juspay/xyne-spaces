import { ReactElement, useState, useCallback, useEffect, useRef } from 'react';
import {
  FileText,
  RefreshCw,
  ArrowLeft,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { API_BASE_URL } from '../../config';
import axios from 'axios';
import JSZip from 'jszip';
import { isElectronApp } from '../../utils/electronApp';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { logger } from '../../utils/logger';
import { useVSCode } from '../../contexts/VSCodeContext';
import { v4 as uuidv4 } from 'uuid';

interface DocsViewerProps {
  repoName: string;
  branchName: string;
  repoId?: string;
  repoUrl?: string;
  onClose?: () => void;
}

interface DocCheckResponse {
  exists: boolean;
  doc?: {
    title: string;
    repoId?: string;
    repoUrl?: string;
    baseBranch?: string;
  };
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    pdf: 'application/pdf',
    xml: 'application/xml',
    txt: 'text/plain',
    md: 'text/markdown',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Generate a unique session ID for this docs preview
function generateSessionId(): string {
  return `docs-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Clean up any orphaned docs-preview caches from previous sessions
async function cleanupOldDocsCaches(currentSessionId: string): Promise<void> {
  try {
    const cacheNames = await caches.keys();
    const docsPreviewCaches = cacheNames.filter(
      name => name.startsWith('docs-preview-') && name !== `docs-preview-${currentSessionId}`,
    );
    await Promise.all(docsPreviewCaches.map(name => caches.delete(name)));
  } catch {
    // Ignore cleanup errors
  }
}

const DocsViewer = ({
  repoName,
  branchName,
  repoId: _repoId,
  repoUrl,
  onClose,
}: DocsViewerProps): ReactElement => {
  const navigate = useNavigate();
  const { registerSession } = useVSCode();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [docTitle, setDocTitle] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [docRepoUrl, setDocRepoUrl] = useState<string | undefined>(repoUrl);
  const [docBaseBranch, setDocBaseBranch] = useState<string>('main');
  const sessionIdRef = useRef<string>(generateSessionId());
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Check if running in Electron
  const inElectron = isElectronApp();

  // Fetch doc metadata (title, baseBranch) from check endpoint
  useEffect(() => {
    const fetchDocInfo = async (): Promise<void> => {
      try {
        const checkUrl = `${API_BASE_URL}/docs/check/${repoName}/${branchName}`;
        // Note: Using direct axios call instead of apiInstance
        const headers: Record<string, string> = {};
        headers['x-request-id'] = uuidv4();
        if (logger.zeroClientID) {
          headers['x-client-id'] = logger.zeroClientID;
        }
        if (logger.zeroClientGroupID) {
          headers['x-zero-client-group-id'] = logger.zeroClientGroupID;
        }
        if (logger.emailId) {
          headers['x-user-email'] = logger.emailId;
        }

        const response = await axios.get<DocCheckResponse>(checkUrl, {
          withCredentials: true,
          headers,
        });
        if (response.data?.exists && response.data?.doc?.title) {
          setDocTitle(response.data.doc.title);
        }
        // Get repo URL from doc info if not provided
        if (response.data?.doc?.repoUrl && !docRepoUrl) {
          setDocRepoUrl(response.data.doc.repoUrl);
        }
        if (response.data?.doc?.baseBranch) {
          setDocBaseBranch(response.data.doc.baseBranch);
        }
      } catch {
        setDocTitle('');
      }
    };
    void fetchDocInfo();
  }, [repoName, branchName, docRepoUrl]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Handle Edit button click - clone repo, checkout branch, open VS Code
  const handleEdit = useCallback(async () => {
    if (!inElectron) {
      toast.error('Edit is only available in the desktop app');
      return;
    }

    if (!docRepoUrl) {
      toast.error('Repository URL not available for this document');
      return;
    }

    const api = window.electronAPI?.codeServer;
    if (!api) {
      toast.error('Code server not available');
      return;
    }

    setIsEditing(true);
    try {
      toast.info('Setting up workspace...', {
        description: `Cloning ${repoName} and checking out ${branchName}`,
      });

      // Use prepareForTicket to clone and checkout the branch
      const result = await api.prepareForTicket(docRepoUrl, docBaseBranch, branchName);

      if (!result.success) {
        throw new Error(result.error || 'Failed to prepare workspace');
      }

      // Get VS Code URL with the workspace folder
      const vsCodeUrl = await api.getUrlWithFolder(result.workspacePath);

      if (vsCodeUrl) {
        toast.success('Workspace ready!', {
          description: 'Opening VS Code with the document branch',
        });

        registerSession(result.workspacePath, vsCodeUrl, branchName, repoName);

        // Navigate to VS Code workspace screen
        void navigate('/vscode');
      } else {
        throw new Error('Failed to get VS Code URL');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error('Failed to open editor', {
        description: errorMessage,
      });
    } finally {
      setIsEditing(false);
    }
  }, [inElectron, docRepoUrl, docBaseBranch, repoName, branchName, navigate, registerSession]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return (): void => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  // Fetch zip, unzip, and store in service worker cache
  useEffect(() => {
    const loadDocs = async (): Promise<void> => {
      setIsLoading(true);
      setHasError(false);
      setPreviewUrl(null);

      // Generate new session ID for this load
      const sessionId = generateSessionId();
      sessionIdRef.current = sessionId;

      try {
        // Check if service worker is available (needed to intercept fetch requests)
        if (!navigator.serviceWorker) {
          throw new Error('Service workers not supported');
        }

        // Wait for service worker to be ready
        await navigator.serviceWorker.ready;

        await cleanupOldDocsCaches(sessionId);

        // Fetch the zip file - path includes org/repo and branch with slashes
        const zipUrl = `${API_BASE_URL}/docs/zip/${repoName}/${branchName}`;
        // Note: Using direct axios call instead of apiInstance
        const headers: Record<string, string> = {};
        headers['x-request-id'] = uuidv4();
        if (logger.zeroClientID) {
          headers['x-client-id'] = logger.zeroClientID;
        }
        if (logger.zeroClientGroupID) {
          headers['x-zero-client-group-id'] = logger.zeroClientGroupID;
        }
        if (logger.emailId) {
          headers['x-user-email'] = logger.emailId;
        }

        const response = await axios.get(zipUrl, {
          responseType: 'arraybuffer',
          withCredentials: true,
          headers,
        });

        // axios lowercases headers - check both cases
        const entryFile =
          (response.headers['x-entry-file'] as string) ||
          (response.headers['X-Entry-File'] as string) ||
          'index.html';

        // Unzip
        const zip = await JSZip.loadAsync(response.data as ArrayBuffer);

        // Store files directly in Cache API (no service worker message needed)
        const cacheName = `docs-preview-${sessionId}`;
        const cache = await caches.open(cacheName);

        for (const [filename, file] of Object.entries(zip.files)) {
          if (file.dir) continue;

          const mimeType = getMimeType(filename);
          const content = await file.async('arraybuffer');

          // Create headers using Headers object to avoid lint issues with header names
          const headers = new Headers();
          headers.set('Content-Type', mimeType);
          headers.set('Cache-Control', 'no-cache');

          // Create a response to cache
          const cacheResponse = new Response(content, { headers });

          // Store in cache with the preview URL path
          const cacheUrl = `/docs-preview/${sessionId}/${filename}`;
          await cache.put(cacheUrl, cacheResponse);
        }

        // Set the preview URL - the service worker will intercept and serve from cache
        const docsPreviewUrl = `/docs-preview/${sessionId}/${entryFile}`;
        setPreviewUrl(docsPreviewUrl);
        setIsLoading(false);
      } catch {
        setHasError(true);
        setIsLoading(false);
      }
    };

    void loadDocs();

    // Cleanup: clear docs cache when unmounting
    return (): void => {
      const sid = sessionIdRef.current;
      // Delete the cache for this session
      void caches.delete(`docs-preview-${sid}`);
    };
  }, [repoName, branchName, refreshKey]);

  const handleRefresh = useCallback(() => {
    setPreviewUrl(null);
    setRefreshKey(prev => prev + 1);
  }, []);

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);

    if (!docTitle && iframeRef.current) {
      try {
        const iframeDoc =
          iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
        if (iframeDoc) {
          const pageTitle = iframeDoc.title;
          if (pageTitle && pageTitle !== 'index' && pageTitle !== 'Index') {
            setDocTitle(pageTitle);
          }
        }
      } catch {
        // Cross-origin error - can't access iframe content, ignore
      }
    }
  }, [docTitle]);

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-white overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-50' : 'h-full w-full rounded-2xl'
      }`}
    >
      {/* Toolbar */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 ${
          isFullscreen ? '' : 'rounded-t-2xl'
        }`}
      >
        <div className='flex items-center gap-3'>
          {onClose && !isFullscreen && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onClose}
              className='h-8 w-8'
              title='Go back'
            >
              <ArrowLeft className='h-4 w-4' />
            </Button>
          )}
          <FileText className='h-5 w-5 text-blue-600' />
          <span className='text-sm font-medium text-gray-900 truncate max-w-md'>
            {docTitle || 'Documentation'}
          </span>
        </div>

        <div className='flex items-center gap-1'>
          {/* Edit button - only shown in Electron when repo URL is available */}
          {inElectron && docRepoUrl && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => void handleEdit()}
              className='h-8 gap-1.5 px-2'
              title='Edit this document'
              disabled={isEditing}
            >
              {isEditing ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Pencil className='h-4 w-4' />
              )}
              <span className='hidden sm:inline'>Edit</span>
            </Button>
          )}
          <Button
            variant='ghost'
            size='icon'
            onClick={handleRefresh}
            className='h-8 w-8'
            title='Refresh'
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={toggleFullscreen}
            className='h-8 w-8'
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className='h-4 w-4' /> : <Maximize2 className='h-4 w-4' />}
          </Button>
        </div>
      </div>

      {/* Content Area */}
      <div className='flex-1 relative' ref={previewContainerRef}>
        {isLoading && (
          <div className='absolute inset-0 flex items-center justify-center bg-white/80 z-10'>
            <div className='flex flex-col items-center gap-2'>
              <Loader2 className='h-8 w-8 animate-spin text-blue-600' />
              <span className='text-sm text-gray-500'>Loading documentation...</span>
            </div>
          </div>
        )}

        {hasError && (
          <div className='absolute inset-0 flex items-center justify-center bg-white z-10'>
            <div className='flex flex-col items-center gap-4 text-center p-4'>
              <div className='text-4xl'>😕</div>
              <h3 className='text-lg font-semibold text-gray-900'>Failed to load documentation</h3>
              <p className='text-sm text-gray-500 max-w-sm'>
                The documentation could not be loaded.
              </p>
              <Button variant='outline' onClick={handleRefresh}>
                Try Again
              </Button>
            </div>
          </div>
        )}

        {previewUrl && (
          <iframe
            ref={iframeRef}
            key={refreshKey}
            src={previewUrl}
            title={docTitle || 'Documentation'}
            className='w-full h-full border-0'
            onLoad={handleIframeLoad}
          />
        )}
      </div>
    </div>
  );
};

export default DocsViewer;
