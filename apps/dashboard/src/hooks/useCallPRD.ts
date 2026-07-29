import { useState, useEffect, useRef } from 'react';
import { useGeneratePRD } from './useGeneratePRD';

export interface PrdEntry {
  id: string;
  canvasId: string | null; // null while still generating
  title: string;
}

interface UseCallPRDReturn {
  prdEntries: PrdEntry[];
  handleGeneratePRD: (customPrompt?: string) => Promise<void>;
  isGeneratingPRD: boolean;
}

export function useCallPRD({
  externalId,
  messageId,
  persistedPrdCanvasIds,
  onTabCreate,
}: {
  externalId: string;
  messageId: string | null | undefined;
  persistedPrdCanvasIds: string[];
  onTabCreate: (tabId: string) => void;
}): UseCallPRDReturn {
  const [prdEntries, setPrdEntries] = useState<PrdEntry[]>([]);
  const prdCount = useRef(0);
  const seededRef = useRef(false);
  const { generatePRD, isLoading: isGeneratingPRD } = useGeneratePRD();

  // Seed persisted PRD tabs from the call_prd bot messages (loaded async via Zero).
  // Run once when the list first becomes non-empty; preserve any in-flight (canvasId === null)
  // entries the user just generated so they don't get wiped by the seed.
  useEffect(() => {
    if (seededRef.current) return;
    if (persistedPrdCanvasIds.length === 0) return;
    seededRef.current = true;
    setPrdEntries(prev => {
      const inProgress = prev.filter(e => e.canvasId === null);
      const persisted: PrdEntry[] = persistedPrdCanvasIds.map((canvasId, i) => ({
        id: `prd-persisted-${i}`,
        canvasId,
        title: `PRD ${i + 1}`,
      }));
      prdCount.current = persistedPrdCanvasIds.length + inProgress.length;
      return [...persisted, ...inProgress];
    });
  }, [persistedPrdCanvasIds]);

  const handleGeneratePRD = async (customPrompt?: string): Promise<void> => {
    prdCount.current += 1;
    const tabId = `prd-${Date.now()}`;
    const prdTitle = `PRD ${prdCount.current}`;

    setPrdEntries(prev => [...prev, { id: tabId, canvasId: null, title: prdTitle }]);
    onTabCreate(tabId);

    const result = await generatePRD(externalId, messageId ?? undefined, customPrompt);

    if (result.success && result.canvasUrl) {
      const canvasId = result.canvasUrl.split('/').pop() ?? null;
      setPrdEntries(prev => prev.map(e => (e.id === tabId ? { ...e, canvasId } : e)));
    } else {
      setPrdEntries(prev => prev.filter(e => e.id !== tabId));
      onTabCreate('summary');
    }
  };

  return { prdEntries, handleGeneratePRD, isGeneratingPRD };
}
