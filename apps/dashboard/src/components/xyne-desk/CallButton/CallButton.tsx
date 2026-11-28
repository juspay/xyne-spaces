import { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSoftphone, TELEPHONY_QUERY_KEYS } from '../../../services/clients/telephonyApi';
import { openFloatingDock } from '../CloudAgentDock/CloudAgentDock';
import Tooltip from '../../ui/Tooltip';
import { PhoneDefault } from '@xyne/icons';

/** Calls from an app-desk ticket go through the desk's own call connection. */
export const CallButton = ({ channelId }: { channelId: string }): ReactElement | null => {
  const { data } = useQuery({
    queryKey: TELEPHONY_QUERY_KEYS.softphone(channelId),
    queryFn: () => getSoftphone(channelId),
  });
  const deskConnection = data?.connections.find(
    connection => connection.id === data.deskConnectionId,
  );

  if (!data || !deskConnection) return null;

  return (
    <Tooltip side='bottom' delayDuration={300} content='Call customer and log it to this ticket'>
      <button
        type='button'
        className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-linear-to-r from-emerald-500 via-teal-500 to-cyan-500 text-white shadow-md shadow-emerald-500/20 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/30 focus:outline-hidden focus:ring-2 focus:ring-emerald-400/50'
        aria-label='Call customer'
        data-track-category='Support'
        data-track-name='OpenOzonetelForTicket'
        onClick={() => openFloatingDock(deskConnection, data.connections)}
      >
        <PhoneDefault size={16} className='shrink-0' />
      </button>
    </Tooltip>
  );
};
