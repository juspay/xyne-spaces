import { useParams, useSearchParams } from 'react-router-dom';
import { CallWindow } from './CallWindow';
import { CallWindowWarmUp } from './CallWindowWarmUp';
import { CALL_WINDOW_LAUNCH_PARAM } from '../../utils/electronApp';

export const IDLE_CALL_ID = 'idle';

export function CallWindowRoute(): React.ReactElement {
  const params = useParams<{ callId: string; callType: string }>();
  const [searchParams] = useSearchParams();
  const callId = params.callId ?? IDLE_CALL_ID;

  if (callId === IDLE_CALL_ID) {
    return (
      <div className='h-full w-full bg-background'>
        <CallWindowWarmUp />
      </div>
    );
  }

  return <CallWindow key={searchParams.get(CALL_WINDOW_LAUNCH_PARAM) ?? callId} />;
}
