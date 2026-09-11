import { ReactElement } from 'react';
import { TicketStatusV2 } from '@xyne/shared';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';

// The only categories every board is guaranteed to have at least one stage of (enforced by
// the backend's board.update validation). PAUSED/CANCELLED old stages aren't guaranteed a
// same-category match on the source board, so they may map to a new stage of any category.
const COMPULSORY_STATUS_CATEGORIES = new Set<string>([
  TicketStatusV2.TODO,
  TicketStatusV2.STARTED,
  TicketStatusV2.COMPLETED,
]);

export interface StageRemapRow {
  oldStageId: string;
  oldStageName: string;
  ticketCount: number;
  defaultStatus: string;
}

export interface StageRemapNewStageOption {
  id: string;
  name: string;
  defaultStatus: string;
}

interface StageRemapTableProps {
  rows: StageRemapRow[];
  newStageOptions: StageRemapNewStageOption[];
  value: Record<string, string>;
  onChange: (oldStageId: string, newStageId: string) => void;
}

export const StageRemapTable = ({
  rows,
  newStageOptions,
  value,
  onChange,
}: StageRemapTableProps): ReactElement => {
  // A ticket may only land on a new stage of the SAME status category it's already in
  // (e.g. a ticket in a STARTED-category old stage may only be mapped to a STARTED-category
  // new stage) — so each row gets its own filtered option list, not the full new-stage set.
  // Exception: PAUSED/CANCELLED aren't guaranteed to exist on the source board (unlike
  // TODO/STARTED/COMPLETED, which every board must have), so those rows offer every new
  // stage regardless of category rather than potentially having nowhere to go at all.
  const optionsByStatus = (status: string): SelectorOption[] =>
    newStageOptions
      .filter(stage => !COMPULSORY_STATUS_CATEGORIES.has(status) || stage.defaultStatus === status)
      .map(stage => ({
        value: stage.id,
        label: stage.name,
        icon: null,
        subtitle: stage.defaultStatus,
      }));

  if (rows.length === 0) {
    return (
      <p className='text-sm text-muted-foreground py-3'>
        No tickets on this board need an explicit mapping.
      </p>
    );
  }

  return (
    <div className='border border-border rounded-md overflow-hidden'>
      <table className='w-full text-sm'>
        <thead className='bg-muted/40'>
          <tr>
            <th className='text-left px-3 py-2 font-medium text-muted-foreground'>Old stage</th>
            <th className='text-left px-3 py-2 font-medium text-muted-foreground'>Tickets</th>
            <th className='text-left px-3 py-2 font-medium text-muted-foreground'>New stage</th>
          </tr>
        </thead>
        <tbody className='divide-y divide-border'>
          {rows.map(row => {
            const options = optionsByStatus(row.defaultStatus);
            return (
              <tr key={row.oldStageId}>
                <td className='px-3 py-2 align-top'>
                  <div className='font-medium text-foreground'>{row.oldStageName}</div>
                  <div className='text-xs text-muted-foreground'>{row.defaultStatus}</div>
                </td>
                <td className='px-3 py-2 align-top text-muted-foreground'>{row.ticketCount}</td>
                <td className='px-3 py-2 align-top'>
                  {options.length === 0 ? (
                    <p className='text-xs text-destructive'>
                      No {row.defaultStatus} stage exists on the source board — this copy cannot
                      proceed until one does.
                    </p>
                  ) : (
                    <EntitySelector
                      options={options}
                      selectedValue={value[row.oldStageId] ?? null}
                      onSelect={newStageId => {
                        if (newStageId) onChange(row.oldStageId, newStageId);
                      }}
                      placeholder='Select new stage'
                      searchPlaceholder='Search stages...'
                      showSearch={true}
                      width='220px'
                      testId={`stage-remap-${row.oldStageId}`}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
