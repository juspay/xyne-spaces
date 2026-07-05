import { useState } from 'react';
import type {
  ConflictResolution,
  StageFormFieldConflict,
  StageFormResolvedInputs,
} from '../StageFormFields/useStageForm';

type ConflictAction = 'save' | 'move';

type ConflictRunner = (overrides?: StageFormResolvedInputs) => Promise<boolean>;

interface UseStageFormConflictFlowParams {
  getContentConflicts: () => StageFormFieldConflict[];
  applyConflictResolution: (resolution: Map<string, ConflictResolution>) => StageFormResolvedInputs;
  performSave: ConflictRunner;
  performMove: ConflictRunner;
}

export interface StageFormConflictFlow {
  conflicts: StageFormFieldConflict[];
  resolution: Map<string, ConflictResolution>;
  isConfirming: boolean;
  run: (action: ConflictAction) => Promise<boolean>;
  onChange: (fieldId: string, choice: ConflictResolution) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

const defaultResolution = (
  list: readonly StageFormFieldConflict[],
): Map<string, ConflictResolution> => {
  const map = new Map<string, ConflictResolution>();
  list.forEach(conflict => {
    const edited =
      conflict.localDocChange !== undefined ||
      conflict.mine.length !== conflict.base.length ||
      conflict.mine.some((value, index) => value !== conflict.base[index]);
    map.set(conflict.fieldId, edited ? 'mine' : 'theirs');
  });
  return map;
};

export const useStageFormConflictFlow = ({
  getContentConflicts,
  applyConflictResolution,
  performSave,
  performMove,
}: UseStageFormConflictFlowParams): StageFormConflictFlow => {
  const [action, setAction] = useState<ConflictAction | null>(null);
  const [conflicts, setConflicts] = useState<StageFormFieldConflict[]>([]);
  const [resolution, setResolution] = useState<Map<string, ConflictResolution>>(new Map());
  const [isConfirming, setIsConfirming] = useState(false);

  const close = (): void => {
    setAction(null);
    setConflicts([]);
    setResolution(new Map());
  };

  const run = async (next: ConflictAction): Promise<boolean> => {
    const detected = getContentConflicts();
    if (detected.length === 0) {
      await (next === 'save' ? performSave() : performMove());
      return false;
    }
    setAction(next);
    setConflicts(detected);
    setResolution(defaultResolution(detected));
    return true;
  };

  const onChange = (fieldId: string, choice: ConflictResolution): void => {
    setResolution(prev => {
      const nextMap = new Map(prev);
      nextMap.set(fieldId, choice);
      return nextMap;
    });
  };

  const onConfirm = async (): Promise<void> => {
    if (!action) return;
    setIsConfirming(true);
    try {
      const resolved = applyConflictResolution(resolution);
      const success = action === 'save' ? await performSave(resolved) : await performMove(resolved);
      if (success) {
        close();
        return;
      }
      const detected = getContentConflicts();
      if (detected.length === 0) {
        close();
      } else {
        setConflicts(detected);
        setResolution(defaultResolution(detected));
      }
    } finally {
      setIsConfirming(false);
    }
  };

  return { conflicts, resolution, isConfirming, run, onChange, onConfirm, onCancel: close };
};
