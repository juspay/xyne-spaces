import { type ReactElement } from 'react';
import { AIShell } from '../../components/AIScreen/AIShell';
import DailyBriefScreen from '../DailyBriefScreen';
import { useAIChatHandoff } from './useAIChatHandoff';

const AIDailyBriefScreen = (): ReactElement => {
  const { onCreateChat, onSelectSession } = useAIChatHandoff();

  return (
    <AIShell onCreateChat={onCreateChat} onSelectSession={onSelectSession}>
      <DailyBriefScreen />
    </AIShell>
  );
};

export default AIDailyBriefScreen;
