import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface DragDropFileContextType {
  // Use Record<string, File[]>
  droppedFiles: Record<string, File[]>;
  addDroppedFile: (id: string, file: File) => void;
  removeDroppedFile: (id: string, file: File) => void;
  clearDroppedFiles: (id: string) => void;
}

const DragDropFileContext = createContext<DragDropFileContextType | undefined>(undefined);

export const DragDropFileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // uisng object for storing the id
  const [filesMap, setFilesMap] = useState<Record<string, File[]>>({});

  const addDroppedFile = useCallback((id: string, file: File) => {
    if (!id) return;
    setFilesMap(prev => ({
      ...prev,
      [id]: [...(prev[id] || []), file],
    }));
  }, []);

  const removeDroppedFile = useCallback((id: string, file: File) => {
    if (!id) return;
    setFilesMap(prev => ({
      ...prev,
      [id]: (prev[id] || []).filter(f => f !== file),
    }));
  }, []);

  const clearDroppedFiles = useCallback((id: string) => {
    if (!id) return;
    setFilesMap(prev => ({
      ...prev,
      [id]: [],
    }));
  }, []);

  const value = useMemo(
    () => ({
      droppedFiles: filesMap,
      addDroppedFile,
      removeDroppedFile,
      clearDroppedFiles,
    }),
    [filesMap, addDroppedFile, removeDroppedFile, clearDroppedFiles],
  );

  return <DragDropFileContext.Provider value={value}>{children}</DragDropFileContext.Provider>;
};

export const useDragDropFiles = () => {
  const context = useContext(DragDropFileContext);
  if (!context) throw new Error('useDragDropFiles must be used within Provider');
  return context;
};
