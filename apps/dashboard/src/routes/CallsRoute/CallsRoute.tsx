import type { ReactElement } from 'react';
import { useCallsVersion } from '../../hooks/useCallsVersion';
import CallHistoryScreen from '../CallHistoryScreen/CallHistoryScreen';
import CallHistoryV2Screen from '../CallHistoryV2Screen/CallHistoryV2Screen';

export default function CallsRoute(): ReactElement {
  const { callsVersion } = useCallsVersion();

  return callsVersion === 'v2' ? <CallHistoryV2Screen /> : <CallHistoryScreen />;
}
