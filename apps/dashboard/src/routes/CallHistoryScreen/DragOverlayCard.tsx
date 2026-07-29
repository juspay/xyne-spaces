import { ReactElement } from 'react';
import { type Call } from './callHistoryItem.utils';

interface DragOverlayCardProps {
  call: Call;
  formattedTime: string;
  width: number;
  height: number;
}

const DragOverlayCard = ({
  call,
  formattedTime,
  width,
  height,
}: DragOverlayCardProps): ReactElement => (
  <div
    className='rounded overflow-hidden border-l-[3px] shadow-xl pointer-events-none'
    style={{
      width,
      height,
      backgroundColor: '#0077FF1A',
      borderLeftColor: '#0077FF',
      opacity: 0.92,
    }}
  >
    <div className='px-1.5 py-1 h-full flex flex-col justify-start overflow-hidden'>
      <span
        className='truncate'
        style={{ color: '#092E58', fontSize: '12px', lineHeight: '18px', fontWeight: 500 }}
      >
        {call.title ?? 'Call'}
      </span>
      {height >= 40 && (
        <span
          className='mt-0.5 whitespace-nowrap'
          style={{ color: '#092E58', fontSize: '10px', lineHeight: '14px', opacity: 0.7 }}
        >
          {formattedTime}
        </span>
      )}
    </div>
  </div>
);

export default DragOverlayCard;
