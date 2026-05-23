import { queries } from '../../../../../zero/queries';
import { useCachedQuery } from '../../../../../hooks/useCachedQuery';
import { StagesSubmenu } from './StagesSubmenu';

interface StageFilterPopupProps {
  /** boardId for the channel — null when not yet known (e.g. empty channel). */
  boardId: string | null;
  selectedStages: string[];
  onChange: (stages: string[]) => void;
}

export function StageFilterPopup({ boardId, selectedStages, onChange }: StageFilterPopupProps) {
  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: boardId ?? '' }), {
    enabled: !!boardId,
  });
  return (
    <StagesSubmenu
      selectedStages={selectedStages}
      onChange={onChange}
      availableStages={
        stages?.map(s => ({
          name: s.name,
          status: s.defaultTicketStatusV2,
        })) ?? []
      }
    />
  );
}
