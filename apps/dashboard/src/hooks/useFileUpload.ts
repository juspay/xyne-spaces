import { logger, Event as LogEvent } from '../utils/logger';
import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  progress: number;
  error?: string;
}

export interface UploadOptions {
  parentId?: string | null; // Folder ID where file should be uploaded
  collectionId?: string; // Collection ID (for backward compatibility)
}

/**
 * File upload hook
 * Handles file uploads with parentId-based folder navigation
 */
export function useFileUpload() {
  const [uploads, setUploads] = useState<Map<string, UploadedFile>>(new Map());

  const uploadFiles = useCallback(async (files: File[], options: UploadOptions = {}) => {
    const { parentId, collectionId } = options;

    for (const file of files) {
      const uploadId = uuidv4();
      const uploadedFile: UploadedFile = {
        id: uploadId,
        name: file.name,
        size: file.size,
        type: file.type,
        file,
        status: 'uploading',
        progress: 0,
      };

      // Add upload to state using functional update
      setUploads(prev => {
        const updated = new Map(prev);
        updated.set(uploadId, uploadedFile);
        return updated;
      });

      // Simulate upload progress
      for (let progress = 0; progress <= 100; progress += 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        setUploads(prev => {
          const updated = new Map(prev);
          const current = updated.get(uploadId);
          if (current) {
            updated.set(uploadId, { ...current, progress });
          }
          return updated;
        });
      }

      // Mark as processing
      setUploads(prev => {
        const updated = new Map(prev);
        const current = updated.get(uploadId);
        if (current) {
          updated.set(uploadId, { ...current, status: 'processing', progress: 100 });
        }
        return updated;
      });

      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Mark as ready
      setUploads(prev => {
        const updated = new Map(prev);
        const current = updated.get(uploadId);
        if (current) {
          updated.set(uploadId, { ...current, status: 'ready' });
        }
        return updated;
      });

      // Store file in localStorage for persistence (UI testing)
      try {
        // Read file content as base64 for storage
        const fileContent = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (reader.result) {
              resolve(reader.result as string);
            } else {
              reject(new Error('Failed to read file'));
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const storedFiles = JSON.parse(localStorage.getItem('kb_test_files') || '[]') as Array<{
          id: string;
          name: string;
          size: number;
          type: string;
          parentId?: string | null;
          collectionId?: string | undefined;
          uploadedAt: string;
          content: string; // Base64 data URL
        }>;

        const fileEntry = {
          id: uploadId,
          name: file.name,
          size: file.size,
          type: file.type,
          ...(parentId !== undefined && { parentId }),
          ...(collectionId && { collectionId }),
          uploadedAt: new Date().toISOString(),
          content: fileContent, // Store file content as base64 data URL
        };

        storedFiles.push(fileEntry);

        localStorage.setItem('kb_test_files', JSON.stringify(storedFiles));
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Failed to store file in localStorage:'),
          error: error,
        });
      }
    }
  }, []);

  const removeUpload = useCallback((uploadId: string) => {
    setUploads(prev => {
      const updated = new Map(prev);
      updated.delete(uploadId);
      return updated;
    });
  }, []);

  const getStoredFiles = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem('kb_test_files') || '[]') as Array<{
        id: string;
        name: string;
        size: number;
        type: string;
        parentId?: string | null;
        collectionId?: string;
        uploadedAt: string;
        content?: string; // Base64 data URL (optional for backward compatibility)
      }>;
    } catch {
      return [];
    }
  }, []);

  return {
    uploads: Array.from(uploads.values()),
    uploadFiles,
    removeUpload,
    getStoredFiles,
  };
}
